# Local admin authentication (development only)

Use this when you **do not** have Cloudflare Access configured yet but need to exercise `/api/admin/*`, the admin UI, and signed Cloudinary uploads against **`wrangler dev`** and local D1.

Production and deployed Workers must use **Cloudflare Access JWT + `admin_users` allowlist** only. Local dev auth is **fail-closed** everywhere else.

## Security boundaries

| Control | Purpose |
|---------|---------|
| `ADMIN_LOCAL_DEV_AUTH=1` | Explicit opt-in (default off) |
| `ADMIN_LOCAL_DEV_SECRET` (≥ 32 chars) | HS256 signing key; **only** in `server/.dev.vars` |
| Loopback hostname only | Request URL must be `localhost`, `127.0.0.1`, or `[::1]` |
| No `[vars]` in `wrangler.toml` | Local secrets must not ship with deploy |
| D1 `admin_users` | Same allowlist as production; email comes from verified JWT only |
| Cloudflare Access when configured | Valid Access JWT uses CF path; **invalid Access JWT is never downgraded** to local JWT |

**Never** put `ADMIN_LOCAL_DEV_SECRET` or `ADMIN_LOCAL_DEV_JWT` in `VITE_*` variables (browser-visible).

## One-time setup

1. Apply local D1 migrations and seed an allowlist row:

```sql
INSERT INTO admin_users (id, email, display_name)
VALUES ('owner', 'you@example.com', 'Owner');
```

2. Add to **`server/.dev.vars`** (gitignored):

```bash
ADMIN_LOCAL_DEV_AUTH=1
ADMIN_LOCAL_DEV_SECRET=<run: openssl rand -hex 32>
ADMIN_LOCAL_DEV_EMAIL=you@example.com
```

Use the **same email** as in `admin_users`.

3. Keep Cloudinary vars in `.dev.vars` if you test uploads.

## Issue a short-lived JWT

From `server/`:

```bash
npm run admin:local-jwt
```

- Prints the JWT on **stdout** (safe to paste into env files).
- Prints expiry metadata on **stderr** only.
- Does **not** print `ADMIN_LOCAL_DEV_SECRET`.

Default lifetime: **8 hours** (`--ttl=seconds`, `--email=` optional).

## Test the Worker directly

Terminal 1:

```bash
cd server
npm run dev
```

Terminal 2:

```bash
TOKEN=$(npm run admin:local-jwt 2>/dev/null | tail -n 1)
curl -s -H "Cf-Access-Jwt-Assertion: $TOKEN" http://127.0.0.1:8787/api/admin/session
```

Expect `{ "ok": true, "email": "..." }`.

**Hostname note:** Wrangler dev serves on `127.0.0.1`; the Worker checks the **request URL hostname**. Calls must target loopback (not `https://example.com`).

## Admin UI via Vite (recommended local workflow)

Keep **`VITE_API_BASE_URL` empty** in repo root `.env.local` so the SPA uses the Vite proxy (local D1). Do **not** put production Worker URLs here unless you intentionally want local UI → production D1.

1. Create **repo root** `.env.local` (gitignored via `*.local`), **not** `server/.env.local`:

```bash
VITE_API_BASE_URL=
ADMIN_LOCAL_DEV_JWT=<paste output of npm run admin:local-jwt>
```

Vite loads this via `loadEnv` in `vite.config.js` for the dev proxy only (never bundled to the browser). **Never** prefix the JWT with `VITE_`.

2. Terminal 1: `cd server && npm run dev`  
3. Terminal 2: repo root `npm run dev`  
4. Open `http://localhost:5173/admin/products` (or `/admin` — session is checked via proxied JWT).

Vite’s dev server adds `Cf-Access-Jwt-Assertion` on proxied `/api/admin` requests using **`ADMIN_LOCAL_DEV_JWT`** (Node-side only, not bundled).

With `changeOrigin: true`, the Worker sees `http://127.0.0.1:8787/...` — loopback gate passes.

### Local login page vs JWT

- **JWT (default):** No password required. Refresh the token every ~8 hours (`npm run admin:local-jwt`), update `.env.local`, restart Vite.
- **Password form:** Uses **local D1** only. Production passwords are separate. Requires `ADMIN_BOOTSTRAP_SECRET` in `server/.dev.vars` and one `POST /api/admin/auth/bootstrap-owner` against `http://127.0.0.1:8787` (see AUTH_PASSWORD.md).

The login route redirects to Admin products automatically when `/api/admin/session` already succeeds (valid proxied JWT).

## Disable local dev auth

- Remove `ADMIN_LOCAL_DEV_AUTH` or set it to `0`.
- Remove `ADMIN_LOCAL_DEV_SECRET` from `.dev.vars`.
- Remove `ADMIN_LOCAL_DEV_JWT` from `.env.local`.

Without Cloudflare Access env vars, admin routes return **503** `auth_not_configured` again.

## When you add Cloudflare Access later

Set in `.dev.vars` or production secrets:

- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`

Then **only** real Access JWTs authenticate admin routes. Local HS256 tokens are **not** accepted while Access is configured, even on localhost.

See [AUTH.md](./AUTH.md) for production Access setup.
