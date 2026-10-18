# Phase 6.2 — Vercel + Workers connectivity

**Scope:** Split hosting (Vercel SPA + Cloudflare Worker API). Full operator steps: **[PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md)**.

## Topology

| Layer | Target | Notes |
|-------|--------|--------|
| Storefront + admin UI | Vercel (static Vite build) | `vercel.json` rewrites all routes to `index.html` for React Router |
| API | Cloudflare Worker + D1 | `server/wrangler.toml` — `name = "diwali-api"`, binding `DB` → `diwali-quotation` |

When the SPA and API are on **different origins**, set **`VITE_API_BASE_URL`** (Vercel build) and **`CORS_ALLOWED_ORIGINS`** (Worker **variable**, not a secret). When they share one origin, leave both unset.

## Vercel (frontend)

1. Build command: `npm run build` (repo root).
2. Output directory: `dist`.
3. Environment variable at **build** time:
   - `VITE_API_BASE_URL` = Worker URL without trailing slash (e.g. `https://diwali-api.<subdomain>.workers.dev` after deploy).
4. Production site: `https://diwali-stall.vercel.app` — include this exact origin in Worker CORS when using split hosting.

## Cloudflare Worker (backend)

1. Set **`CORS_ALLOWED_ORIGINS`** as a **plain Worker variable** (Dashboard or `npm run deploy -- --var CORS_ALLOWED_ORIGINS:https://diwali-stall.vercel.app`). Comma-separate preview origins if needed.
2. Do **not** use `*`. Origins must match exactly (scheme + host + port; no path).
3. Allowed request headers include: `Content-Type`, `Idempotency-Key`, `Cookie` (see `server/src/lib/cors.js`).
4. CORS is **not** authentication; `/api/admin/*` requires a valid **session cookie** (password login) or optional legacy Access JWT if configured.

## Admin session across origins

- Admin client uses `credentials: 'include'` (`src/admin/api/client.js`).
- Login sets **`diwali_admin_session`** on the **Worker** origin (`HttpOnly`, `Secure`, `SameSite=None` on HTTPS).
- Cross-site cookie behavior depends on the browser; see **§8** in [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md).

## Local development (unchanged)

- Root `npm run dev` — Vite proxies `/api/admin` and `/api/public` to `VITE_DEV_API_PROXY` or `http://127.0.0.1:8787`.
- Keep `VITE_API_BASE_URL` empty locally so requests stay same-origin to the dev server proxy.
- Optional cross-origin test: set `VITE_API_BASE_URL` and add `http://localhost:5173` to Worker `CORS_ALLOWED_ORIGINS`.

## Verification (local)

```bash
cd server && npm run test:unit    # includes tests/cors.test.js
cd server && npm run test:integration
cd .. && npm run build
```

## Out of scope

- Deploy to Vercel or Cloudflare
- Remote D1 migrations or writes
- Changing pricing, catalogue, or customer-request rules
