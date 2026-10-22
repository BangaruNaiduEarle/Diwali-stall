# Production deployment runbook

**Scope:** Operator steps for this repository. Does not deploy or change remote D1 by itself.

| Layer | In repo |
|-------|---------|
| Worker | `server/wrangler.toml` — `name = "diwali-api"`, D1 binding `DB` → `database_name = "diwali-quotation"`, `migrations_dir = "database/migrations"` |
| Frontend | Root `npm run build` → `dist`; `vercel.json` **API proxy + SPA** rewrites; **`VITE_API_BASE_URL` empty** in Production |
| Admin auth | Password + session cookie — see [AUTH_PASSWORD.md](./AUTH_PASSWORD.md) (no Cloudflare Zero Trust required) |

---

## 1. Confirm D1 binding and migration state

**CLI** (from `server/`):

```bash
npx wrangler d1 migrations list diwali-quotation --remote
```

Ensure `wrangler.toml` `database_name` matches the D1 database that already holds catalogue and rates (Dashboard → D1 → **diwali-quotation**). Binding name must stay **`DB`**.

**Migration order** (Wrangler applies filenames in order; only pending files run):

`0001` … `0006` → **`0007_admin_password_auth.sql`** → **`0008_admin_owner_bootstrap_lock.sql`** → **`0009_family_packs.sql`** → **`0010_customer_request_unit_price.sql`** → **`0011_admin_super_admin_role.sql`**

| Migration | Effect on populated DB |
|-----------|-------------------------|
| `0007` / `0008` | Additive admin auth tables/columns only. |
| `0009` | Additive family-pack tables and indexes. |
| `0010` | Additive column on `customer_request_items` (`unit_price_paise`). |
| `0011` | Rebuilds `admin_users` with `super_admin` role CHECK — copies rows via `INSERT … SELECT`; brief table swap. **Requires verified backup first.** |

**Before any remote apply:** run `npx wrangler d1 migrations list diwali-quotation --remote` and confirm which files are already applied. Export a **verified D1 backup** (see rollback section) before applying **`0011`**. Do **not** assume local and remote migration state match.

**Dashboard (optional):** D1 → **diwali-quotation** → verify it is the production database before applying.

---

## 2. Apply remote migrations safely

**CLI only** — do not run catalogue or rate import scripts against remote.

```bash
cd server
npx wrangler d1 migrations apply diwali-quotation --remote
```

Re-list until **`0011`** (and all prior pending files) show applied. **Do not run:** `catalogue:import:local`, `x4:rates:import:apply`, `purchase:rates:import:apply`, or `server/data/generated/*.sql` on remote.

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

## 7. Vercel — same-origin `/api` proxy (required for admin cookies)

Root **`vercel.json`** must list **two** rewrites **in this order**:

1. **`/api/:path*`** → **`https://diwali-api.naiduearle2662.workers.dev/api/:path*`** (external proxy; preserves POST/OPTIONS and other methods).
2. **`/(.*)`** → **`/index.html`** (SPA deep links only).

**`VITE_API_BASE_URL`:** leave **unset or empty** for Production (and Preview if using the same proxy). The browser must call **`https://diwali-stall.vercel.app/api/...`**, not `*.workers.dev` directly (`src/api/resolveApiUrl.js`).

If Production still has `VITE_API_BASE_URL` pointing at the Worker, **remove it and redeploy** — otherwise session cookies remain cross-site and browsers will not send `diwali_admin_session` on `/api/admin/session`.

Build: root `npm run build`; output `dist` (standard Vercel Vite settings). **Commit and deploy `vercel.json`** with the API rewrite — a frontend-only redeploy without it leaves `/api/*` on the SPA fallback.

### Troubleshooting: `POST /api/admin/auth/login` → **405 Method Not Allowed**

| Signal | Meaning |
|--------|---------|
| Response header `Content-Disposition: inline; filename="index.html"` | Request never reached the Worker; Vercel served the static SPA shell. |
| `GET /api/public/products` returns HTML, not JSON | Same — missing or inactive `/api` rewrite. |

**Fix:** Ensure the deployed commit includes the **`/api/:path*`** rewrite (see repo `vercel.json`). Redeploy from the repo root (not a subdirectory). In Vercel → **Project → Settings → Routing**, remove conflicting **Project Routing Rules** that rewrite `/api/*` to `/index.html`. There are **no** `/api` serverless functions in this repo.

**After fix:** `curl -sI https://diwali-stall.vercel.app/api/public/products` should show **`Content-Type: application/json`** (Worker), not `text/html`.

---

## 8. Smoke tests and admin session cookies

### Public / private separation

- Browser: `https://diwali-stall.vercel.app` — catalogue loads; network calls hit **`/api/public/...`** on the **same origin** (Vercel proxy → Worker).
- Unauthenticated admin: `GET /api/admin/session` → **401**.
- Public JSON must not include purchase or X4 rate fields (see `tests/publicProductsSeparation.test.js`).

### Admin login (first-party cookie via proxy)

1. DevTools → **Network** → `POST /api/admin/auth/login` (URL on **vercel.app**, not workers.dev) → **200** and **Set-Cookie: diwali_admin_session=…** (`SameSite=Lax` when proxied).
2. `GET /api/admin/session` → request includes **Cookie** → **200** with email/role.
3. **Application → Cookies** → **`https://diwali-stall.vercel.app`** → session cookie present after login.
4. Sign out → cookie cleared; admin routes **401**.

Direct Worker calls from Postman still work with cookies on the Worker origin; browser production must use the Vercel `/api` proxy.

### Admin features

- `/admin/login` → `/admin` → sign out.
- Owner: `/admin/users` — create **admin** only (max **5** active including owner).
- Customer request → quotation; admin product/rate edits unchanged.
- `/admin/family-packs` — CRUD, images (Cloudinary folder `diwali/family-packs`), public `/packs` from `GET /api/public/family-packs`.

**Family pack uploads:** Same Worker secrets as product uploads (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). Without them, `POST /api/admin/uploads/sign` returns **503** and the admin form shows the error (no fake success).

**Inactive packs:** Hidden from public APIs; existing estimate lines keep **name/price snapshots** in localStorage until the customer removes them. Customer requests revalidate availability server-side.

---

## Command vs dashboard

| Step | CLI | Dashboard |
|------|-----|-----------|
| Migration list/apply | `npx wrangler d1 migrations list/apply diwali-quotation --remote` | D1 (view); apply via CLI |
| CORS | `npm run deploy -- --var CORS_ALLOWED_ORIGINS:…` or `[vars]` in TOML | Workers → diwali-api → Variables |
| Bootstrap secret | `wrangler secret put/delete ADMIN_BOOTSTRAP_SECRET` | Workers → Secrets |
| Deploy Worker | `npm run deploy` | Workers → Deploy |
| Bootstrap HTTP | `curl.exe` + JSON file | API client |
| Frontend API URL + proxy | Commit root `vercel.json` (API rewrite) | Vercel → Env (clear `VITE_API_BASE_URL`) + Redeploy |

---

## Related docs

- [AUTH_PASSWORD.md](./AUTH_PASSWORD.md) — login, user management, migrations note  
- [PHASE6_2_DEPLOY_CONNECTIVITY.md](./PHASE6_2_DEPLOY_CONNECTIVITY.md) — Vercel/Worker topology (updated for password auth)  
- `server/.env.example` — local `.dev.vars` only; never commit secrets  
