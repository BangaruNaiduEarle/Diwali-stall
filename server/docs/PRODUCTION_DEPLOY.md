# Production deployment runbook

**Scope:** Operator steps for this repository. Does not deploy or change remote D1 by itself.

| Layer | In repo |
|-------|---------|
| Worker | `server/wrangler.toml` — `name = "diwali-api"`, D1 binding `DB` → `database_name = "diwali-quotation"`, `migrations_dir = "database/migrations"` |
| Frontend | Root `npm run build` → `dist`; `vercel.json` SPA rewrites; production API via `VITE_API_BASE_URL` |
| Admin auth | Password + session cookie — see [AUTH_PASSWORD.md](./AUTH_PASSWORD.md) (no Cloudflare Zero Trust required) |

---

## 1. Confirm D1 binding and migration state

**CLI** (from `server/`):

```bash
npx wrangler d1 migrations list diwali-quotation --remote
```

Ensure `wrangler.toml` `database_name` matches the D1 database that already holds catalogue and rates (Dashboard → D1 → **diwali-quotation**). Binding name must stay **`DB`**.

**Migration order** (Wrangler applies filenames in order; only pending files run):

`0001` … `0006` → **`0007_admin_password_auth.sql`** → **`0008_admin_owner_bootstrap_lock.sql`**

`0007` / `0008` are additive (admin auth tables/columns only). They do **not** re-import products or rates.

**Dashboard (optional):** D1 → **diwali-quotation** → verify it is the production database before applying.

---

## 2. Apply remote migrations safely

**CLI only** — do not run catalogue or rate import scripts against remote.

```bash
cd server
npx wrangler d1 migrations apply diwali-quotation --remote
```

Re-list until `0007` and `0008` show applied. **Do not run:** `catalogue:import:local`, `x4:rates:import:apply`, `purchase:rates:import:apply`, or `server/data/generated/*.sql` on remote.

Local equivalent (dev): `npm run db:migrate:local` / `npm run db:migrations:list:local`.

---

## 3. Worker variables and secrets

Read from Worker **`env`** at runtime (`parseCorsAllowedOrigins`, etc.). There is no `[vars]` block in `wrangler.toml` today — set production values via **Dashboard** or deploy flags.

### `CORS_ALLOWED_ORIGINS` — plain variable (not a secret)

Non-sensitive public origin list. Use **one** of:

**A. Dashboard (recommended):** Workers → **diwali-api** → Settings → **Variables and Secrets** → **Add variable** → name `CORS_ALLOWED_ORIGINS`, value:

```text
https://diwali-stall.vercel.app
```

(Add comma-separated preview origins if needed; exact scheme + host, no path, no trailing slash.)

**B. Deploy-time var (CLI):**

```bash
cd server
npm run deploy -- --var CORS_ALLOWED_ORIGINS:https://diwali-stall.vercel.app
```

**C. `wrangler.toml` (optional, commits the public URL):**

```toml
[vars]
CORS_ALLOWED_ORIGINS = "https://diwali-stall.vercel.app"
```

Do **not** use `wrangler secret put` for `CORS_ALLOWED_ORIGINS` unless you deliberately want it encrypted; the codebase treats it as a normal string env binding.

### `ADMIN_BOOTSTRAP_SECRET` — secret (one-time)

**CLI** (prompted; value not on command line):

```bash
cd server
npx wrangler secret put ADMIN_BOOTSTRAP_SECRET
```

Minimum **32** characters. Remove after bootstrap (step 6).

### Other production bindings

- **Do not set** `ADMIN_LOCAL_DEV_*` or `CF_ACCESS_*` in production if using password auth only.
- **Cloudinary** (admin image upload): `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — secrets via Dashboard or `wrangler secret put` (see `server/.env.example`).

---

## 4. Deploy Worker and note the URL

```bash
cd server
npm run deploy
```

(`package.json` → `wrangler deploy`.)

Wrangler prints the live URL, typically:

```text
https://diwali-api.<account-subdomain>.workers.dev
```

(`workers_dev = true` in `wrangler.toml`.) Copy that **origin** (no trailing slash) for Vercel and smoke tests.

**Dashboard:** Workers → **diwali-api** → overview URL if you prefer.

---

## 5. Bootstrap first owner (HTTPS, no secrets in shell history)

**Endpoint:** `POST https://<WORKER_ORIGIN>/api/admin/auth/bootstrap-owner`  
**JSON body:** `email`, `password` (≥ 12 chars), `bootstrapSecret` (matches Worker secret), optional `displayName`. Details: [AUTH_PASSWORD.md](./AUTH_PASSWORD.md).

### Windows PowerShell — safe pattern

1. Create **`bootstrap-body.json`** in a private folder using an editor (VS Code / Notepad). Do not paste secrets into the terminal or commit the file.
2. Prefer **UTF-8** without BOM (VS Code: “UTF-8”; avoid saving with wrong encoding for `curl`).
3. Send the request (only the **URL** appears in shell history):

```powershell
curl.exe -sS -X POST "https://<WORKER_ORIGIN>/api/admin/auth/bootstrap-owner" `
  -H "Content-Type: application/json" `
  --data-binary "@.\bootstrap-body.json"
```

4. Expect **`201`** on success; **`409`** if bootstrap already completed.
5. Delete the file: `Remove-Item -LiteralPath .\bootstrap-body.json -Force`

Alternative: Insomnia / Postman / Thunder Client over HTTPS (no shell history).

---

## 6. Delete bootstrap secret

**CLI:**

```bash
cd server
npx wrangler secret delete ADMIN_BOOTSTRAP_SECRET
```

**Dashboard:** Workers → **diwali-api** → Variables and Secrets → remove `ADMIN_BOOTSTRAP_SECRET`.

Further bootstrap calls return **503** or **409**; password login is unchanged.

---

## 7. Vercel — `VITE_API_BASE_URL`

Set at **build** time (`src/api/resolveApiUrl.js`). Leave **unset** locally (Vite proxies `/api/*`).

**Dashboard:** Project → Settings → Environment Variables → **`VITE_API_BASE_URL`** = Worker origin from step 4 (no trailing slash) → **Production** (and Preview if previews use the same API) → **Redeploy** production.

Build: root `npm run build`; output `dist` (standard Vercel Vite settings).

---

## 8. Smoke tests and cross-origin cookies

### Public / private separation

- Browser: `https://diwali-stall.vercel.app` — catalogue loads; network calls hit `VITE_API_BASE_URL/api/public/...`.
- Unauthenticated admin: `GET <WORKER>/api/admin/session` → **401**.
- Public JSON must not include purchase or X4 rate fields (see `tests/publicProductsSeparation.test.js`).

### Admin login (cross-site cookie)

Production layout: page origin **Vercel**, API origin **`*.workers.dev`**. Login `POST` returns `Set-Cookie: diwali_admin_session=…` with **`HttpOnly; Secure; SameSite=None`** on the **Worker** domain (`adminSessionCookie.js`). The admin client uses **`credentials: 'include'`** (`src/admin/api/client.js`).

**Practical browser checks:**

1. DevTools → **Network** → `auth/login` → response **Set-Cookie** and **201**.
2. Next request to Worker (e.g. `GET …/api/admin/session`) → request includes **Cookie**; **200** with email/role.
3. **Application → Cookies** → select the **Worker** origin (not Vercel) → session cookie present after login.
4. Sign out → cookie cleared; admin routes **401**.

**Cross-site limitation:** Some browsers restrict **third-party** cookies (Vercel page calling Worker API). If login succeeds but session stays **401**, check third-party cookie settings or try another browser; fixing that may require a same-site API hostname (out of scope for this repo’s default config).

**CORS:** From `https://diwali-stall.vercel.app`, responses must include `Access-Control-Allow-Origin: https://diwali-stall.vercel.app` and `Access-Control-Allow-Credentials: true` when `CORS_ALLOWED_ORIGINS` is set (`src/lib/cors.js`).

### Admin features

- `/admin/login` → `/admin` → sign out.
- Owner: `/admin/users` — create **admin** only (max **5** active including owner).
- Customer request → quotation; admin product/rate edits unchanged.

---

## Command vs dashboard

| Step | CLI | Dashboard |
|------|-----|-----------|
| Migration list/apply | `npx wrangler d1 migrations list/apply diwali-quotation --remote` | D1 (view); apply via CLI |
| CORS | `npm run deploy -- --var CORS_ALLOWED_ORIGINS:…` or `[vars]` in TOML | Workers → diwali-api → Variables |
| Bootstrap secret | `wrangler secret put/delete ADMIN_BOOTSTRAP_SECRET` | Workers → Secrets |
| Deploy Worker | `npm run deploy` | Workers → Deploy |
| Bootstrap HTTP | `curl.exe` + JSON file | API client |
| Frontend API URL | — | Vercel → Environment Variables + Redeploy |

---

## Related docs

- [AUTH_PASSWORD.md](./AUTH_PASSWORD.md) — login, user management, migrations note  
- [PHASE6_2_DEPLOY_CONNECTIVITY.md](./PHASE6_2_DEPLOY_CONNECTIVITY.md) — Vercel/Worker topology (updated for password auth)  
- `server/.env.example` — local `.dev.vars` only; never commit secrets  
