# Admin API — local vs production

## Customer request list visibility

The Worker requires `ADMIN_CUSTOMER_REQUEST_VISIBLE_FROM=2026-11-05T15:45:16.000Z`.
Configure this fixed cutoff in each Worker environment; it is not a frontend variable.
Use a valid UTC ISO timestamp with seconds and optional three-digit milliseconds.
Missing or invalid configuration makes the customer request list API return HTTP 503;
there is no fallback that exposes historical requests. Do not advance the cutoff on startup.
Within existing authorization, search, status and archive filters, the list includes requests
created at or after this timestamp, plus `cr-737b1d5a26c757f6588763e787854700`
and `77ece069-78e3-4fab-8a4d-ad118845dd47` regardless of creation time.
The SQL predicate applies to both paginated results and total counts. Detail and billing APIs
are unchanged. No database records are modified by this visibility rule.

## Summary

| Environment | `VITE_API_BASE_URL` | Admin API target | Auth |
|-------------|---------------------|------------------|------|
| Local Vite dev | empty | `localhost:5173/api/*` → proxy → `127.0.0.1:8787` (local D1) | Proxied local JWT (`ADMIN_LOCAL_DEV_JWT`) and/or local password bootstrap |
| Vercel production | Worker origin at build time | `https://diwali-api.<account>.workers.dev` | Password session cookie (HttpOnly) |

Production and local D1 are **never** shared. Rate imports applied with `wrangler d1 execute --local` affect local D1 only.

## Local development

1. `cd server && npm run dev` — Wrangler on port **8787**, local D1.
2. Repo root: copy `.env.example` → `.env.local`, keep `VITE_API_BASE_URL=` empty.
3. Local admin allowlist + JWT: `server/docs/LOCAL_ADMIN_DEV.md`.
4. Repo root: `npm run dev` — Vite on **5173**.
5. Open `http://localhost:5173/admin/products` after JWT is configured.

## Production (Vercel)

1. Vercel project variable **`VITE_API_BASE_URL`** = `https://diwali-api.naiduearle2662.workers.dev` (no trailing slash), **Production** (and Preview if needed). Redeploy after changes.
2. Worker variable **`CORS_ALLOWED_ORIGINS`** must include `https://diwali-stall.vercel.app` (and preview origins if used). See `server/wrangler.toml` / dashboard — not modified by app code.
3. Admin sign-in uses production D1 `admin_users` + password sessions only. Local dev JWT **does not** work on the deployed Worker hostname.

## Verification

- Local: Network tab shows `http://localhost:5173/api/admin/...`, not `workers.dev`.
- Production: Network tab shows Worker origin; cookies sent with `credentials: 'include'`.

See also: `server/docs/AUTH_PASSWORD.md`, `server/docs/LOCAL_ADMIN_DEV.md`.
