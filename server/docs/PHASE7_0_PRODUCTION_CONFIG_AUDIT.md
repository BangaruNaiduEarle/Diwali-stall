# Phase 7.0 — Production configuration audit (Cloudflare Workers + D1)

**Date:** 2026-10-16  
**Scope:** Read-only audit of repository config. **No deploy, no remote D1 writes, no migration apply, no secret values recorded.**

Status legend: **READY** | **NEEDS VALUE** | **NEEDS DECISION** | **BLOCKED**

---

## Executive summary

| Area | Status |
|------|--------|
| Worker entry + Wrangler scaffold | **READY** (placeholder D1 id) |
| Migrations (6 files) | **READY** for empty remote DB |
| Local migrations applied | **READY** — all 6 on local D1 |
| Wrangler account login | **BLOCKED** — `wrangler whoami` → not authenticated |
| Remote D1 database | **BLOCKED** — `database_id` is placeholder zeros |
| Production admin auth | **NEEDS VALUE** — Cloudflare Access + `admin_users` row |
| Catalogue / products in D1 | **NEEDS DECISION** — no committed remote import script |
| Purchase / X4 rate backfill | **NEEDS DECISION** — apply scripts are **local D1 only** |
| CORS (Vercel → Worker) | **NEEDS VALUE** — `CORS_ALLOWED_ORIGINS` |
| Cloudinary admin uploads | **NEEDS VALUE** — three `CLOUDINARY_*` bindings |
| Frontend API URL | **NEEDS VALUE** — Vercel `VITE_API_BASE_URL` at build time |

---

## 1. Wrangler configuration

**File:** `server/wrangler.toml` (no `wrangler.jsonc` in repo)

| Setting | Value | Status |
|---------|--------|--------|
| Worker `name` | `diwali-api` | **READY** |
| `main` | `src/index.js` | **READY** |
| `compatibility_date` | `2025-04-01` | **READY** |
| Compatibility flags | *(none)* | **READY** |
| `workers_dev` | `true` | **READY** — enables `https://diwali-api.<subdomain>.workers.dev` after deploy |
| D1 binding | `DB` → `diwali-quotation` | **READY** name |
| `database_id` | `00000000-0000-0000-0000-000000000000` | **BLOCKED** — must replace after `wrangler d1 create` |
| `migrations_dir` | `database/migrations` | **READY** |
| `[env.*]` / staging | *(none)* | **NEEDS DECISION** — single default env only today |
| Routes / custom domain | *(none)* | **READY** for workers.dev-only plan |
| Cron triggers | *(none)* | **READY** |
| Static assets binding | *(none)* | **READY** — API-only Worker |
| `[vars]` in TOML | *(none)* | **READY** — secrets/env via dashboard or `wrangler secret` (good for prod) |
| Observability | `enabled = true` | **READY** |

---

## 2. Migration inventory

Applied locally (read from `d1_migrations` via `wrangler d1 execute … --local`, 2026-10-16):

| Order | File | Purpose | Safe on empty remote DB |
|------:|------|---------|-------------------------|
| 1 | `0001_initial_schema.sql` | Core tables: categories, products, admin_users, private_rates, customer_requests, quotations, etc. | **Yes** |
| 2 | `0002_seed_categories.sql` | Inserts 10 category rows (matches `src/data/categories.js`) | **Yes** |
| 3 | `0003_products_company.sql` | `ALTER products ADD company` | **Yes** |
| 4 | `0004_products_selling_price_paise.sql` | Optional admin/D1 list price column (not public API storefront) | **Yes** |
| 5 | `0005_product_purchase_rates.sql` | `product_purchase_rates` table | **Yes** |
| 6 | `0006_quotations_one_active_per_request.sql` | Partial unique index on quotations | **Yes** |

**Not in migrations:** product rows, `admin_users` rows, purchase rates, X4 (`private_rates`), or customer test data.

**Dependencies:** `0001` before all others; `0002` before catalogue import (products FK → `categories.slug`); rate imports require existing `products.id`.

**Do not run in this audit:** `wrangler d1 migrations apply … --remote` (operator step after real `database_id`).

---

## 3. Environment variables and secrets

Bindings are read from Worker `env` (Wrangler secrets, dashboard vars, or `.dev.vars` in local dev only).

### Required for production operation

| Name | Type | Used by | Status |
|------|------|---------|--------|
| `DB` | D1 binding | All API routes | **BLOCKED** until real `database_id` in TOML |
| `CF_ACCESS_TEAM_DOMAIN` | Var or secret | Admin JWT validation (`accessJwt.js`) | **NEEDS VALUE** |
| `CF_ACCESS_AUD` | Var or secret | Admin JWT validation | **NEEDS VALUE** |

Without both Access vars, `/api/admin/*` returns **503** `auth_not_configured` on non-loopback hosts (including workers.dev). Public routes still work if `DB` is bound.

### Required for split-origin frontend (Vercel + workers.dev)

| Name | Where set | Status |
|------|-----------|--------|
| `CORS_ALLOWED_ORIGINS` | Worker env | **NEEDS VALUE** — comma-separated Vercel production (and preview if used) origins, no paths |
| `VITE_API_BASE_URL` | Vercel build env | **NEEDS VALUE** — e.g. `https://diwali-api.<account>.workers.dev` (no trailing slash) |

If unset, Worker sends no CORS headers; browser cross-origin calls from Vercel will fail.

### Required for admin Cloudinary signed upload

| Name | Type | Status |
|------|------|--------|
| `CLOUDINARY_CLOUD_NAME` | Var/secret | **NEEDS VALUE** |
| `CLOUDINARY_API_KEY` | Var/secret | **NEEDS VALUE** |
| `CLOUDINARY_API_SECRET` | **Secret** (never client) | **NEEDS VALUE** |

Without these, `POST /api/admin/uploads/sign` returns **503** `cloudinary_not_configured`. Storefront catalogue images remain local `/images/…` in `src/data/products.js`.

### Public customer requests

| Name | Status |
|------|--------|
| *(none beyond `DB`)* | **READY** — `POST /api/public/customer-requests` needs D1 only |

### Optional / local-only — must NOT enable in production

| Name | Production risk | Status |
|------|-----------------|--------|
| `ADMIN_LOCAL_DEV_AUTH` | If `1` + secret on Worker **and** host were loopback only — not workers.dev | **READY** if omitted on deploy |
| `ADMIN_LOCAL_DEV_SECRET` | HS256 bypass if misconfigured | **READY** if omitted |
| `ADMIN_LOCAL_DEV_EMAIL` | Local JWT claim only | **READY** if omitted |

**Verified in code:** `isLocalAdminDevAuthEnabled()` requires loopback hostname (`localhost`, `127.0.0.1`, `[::1]`). **workers.dev requests never use local dev JWT**, even if secrets were mistakenly uploaded. Production admin **must** use Cloudflare Access when deployed.

When Access **is** configured, invalid Access JWTs are **not** downgraded to local JWT (`adminAuth.js`).

### Documented in `.env.example` but not Worker runtime

| Name | Purpose |
|------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | CLI / dashboard |
| `CLOUDFLARE_API_TOKEN` | CI or local Wrangler auth |

### Root `.env.local` (Vite only)

| Name | Purpose | Production |
|------|---------|------------|
| `ADMIN_LOCAL_DEV_JWT` | Dev proxy `Cf-Access-Jwt-Assertion` | **Do not** use on Vercel |
| `VITE_DEV_API_PROXY` | Local Wrangler port | N/A on Vercel |

---

## 4. Database bootstrap (remote)

### After remote migrations

| Step | Content | Status |
|------|---------|--------|
| Categories | Already from `0002_seed_categories.sql` | **READY** after migrate |
| Products (~160) | Not in migrations | **NEEDS DECISION** |
| `admin_users` | Manual SQL | **NEEDS VALUE** |
| Purchase rates / X4 | Optional Excel imports | **NEEDS DECISION** |
| Customer requests | Created at runtime via API | **READY** — do **not** copy local test rows |

### Product catalogue import

| Artifact | Path |
|----------|------|
| Generated import JSON | `server/data/catalogue-import.json` |
| Generated UPSERT SQL | `server/data/generated/catalogue-upsert.sql` |
| Generator | `npm run catalogue:generate` |
| Local apply | `npm run catalogue:import:local` (**local D1 only**) |

**Remote apply (operator, not automated in repo):** after `database_id` is set, typical pattern:

```bash
cd server
npm run catalogue:generate   # if refreshing from src/data/products.js
npx wrangler d1 execute diwali-quotation --remote --file=./data/generated/catalogue-upsert.sql
```

Review `reports/catalogue-import-report.json` before executing. **Do not** import public `price` from frontend into D1 as X4 (see `PHASE2B_CATALOGUE.md`).

### Purchase and X4 rates

| Script | Remote support |
|--------|----------------|
| `import-purchase-rates.mjs --apply` | **Local only** (`wrangler d1 execute … --local`) |
| `import-x4-private-rates.mjs --apply` | **Local only**; docs note remote uses different API |

**NEEDS DECISION:** How to load approved purchase/X4 rows on remote (manual SQL batches from `server/data/generated/*.sql`, dashboard execute, or a future remote-safe script). **Do not** bulk-import 68 manual-review mappings without owner approval.

### Owner allowlist (`admin_users`)

No migration seed. One-time after remote DB exists:

```sql
INSERT INTO admin_users (id, email, display_name)
VALUES ('owner', '<access-policy-email>', 'Owner');
```

Email must match Cloudflare Access identity claim exactly (see `docs/AUTH.md`).

---

## 5. Production admin authentication

| Component | Status |
|-----------|--------|
| Access application protecting Worker URL (and/or admin UI on Vercel) | **NEEDS VALUE** |
| Policy allowing owner email(s) | **NEEDS VALUE** |
| `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` on Worker | **NEEDS VALUE** |
| Row in `admin_users` | **NEEDS VALUE** |
| D1 allowlist check after JWT | **READY** (`adminAllowlist.js`) |

**Onboarding procedure (recommended):**

1. Create Zero Trust Access application for `https://diwali-api.<subdomain>.workers.dev/api/admin/*` (and optionally Vercel `/admin/*` or whole site).
2. Copy **AUD** tag → `CF_ACCESS_AUD`; team subdomain → `CF_ACCESS_TEAM_DOMAIN`.
3. Deploy Worker with secrets (no `ADMIN_LOCAL_DEV_*`).
4. Insert owner into remote `admin_users`.
5. Verify `GET /api/admin/session` with Access session (browser or `Cf-Access-Jwt-Assertion`).

---

## 6. Cloudinary (production)

| Item | Status |
|------|--------|
| Sign endpoint | **READY** — `POST /api/admin/uploads/sign`, admin-gated |
| Secret handling | **READY** — API secret only in Worker env; not in Vite bundle |
| Mapping file | `server/data/generated/cloudinary-upload-mapping.json` (local migration artefact) | **NEEDS DECISION** — whether remote D1 `images_json` uses Cloudinary URLs vs local paths |
| Storefront | Static local paths in `src/data/products.js` | **READY** unchanged |

See `docs/PHASE3D_CLOUDINARY_UPLOAD.md` and Phase 6.3 image audit (3 missing local files, 49 empty arrays).

---

## 7. Deployment commands (placeholders)

Run from `C:\naidu\Diwali\server` after Cloudflare account is ready.

```bash
# 1) Authenticate CLI
npx wrangler login
npx wrangler whoami

# 2) Create remote D1 (once)
npx wrangler d1 create diwali-quotation
# → copy database_id into wrangler.toml (replace placeholder)

# 3) List / verify binding
npx wrangler d1 list
npx wrangler d1 info diwali-quotation

# 4) Migration status (remote) — read-only check
npx wrangler d1 migrations list diwali-quotation --remote

# 5) Apply migrations (operator — NOT run in Phase 7.0 audit)
npx wrangler d1 migrations apply diwali-quotation --remote

# 6) Bootstrap data (operator)
npx wrangler d1 execute diwali-quotation --remote --command "INSERT INTO admin_users ..."
npx wrangler d1 execute diwali-quotation --remote --file=./data/generated/catalogue-upsert.sql

# 7) Worker secrets (examples — use real values interactively)
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
npx wrangler secret put CORS_ALLOWED_ORIGINS
npx wrangler secret put CLOUDINARY_CLOUD_NAME
npx wrangler secret put CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET

# 8) Dry-run bundle
npm run check

# 9) Deploy Worker
npm run deploy
# Public URL: https://diwali-api.<your-subdomain>.workers.dev
```

**Vercel (frontend, separate step):**

- Build: `npm run build`, output `dist`
- Set `VITE_API_BASE_URL=https://diwali-api.<subdomain>.workers.dev`
- `vercel.json` SPA rewrites: **READY** in repo root

**Health check after deploy:** `GET https://diwali-api.<subdomain>.workers.dev/health`

---

## 8. Risks and blockers

| ID | Classification | Description |
|----|----------------|-------------|
| P7-1 | **BLOCKED** | Wrangler CLI not logged in (verified this audit) |
| P7-2 | **BLOCKED** | Placeholder `database_id` — remote D1 not wired |
| P7-3 | **NEEDS VALUE** | Cloudflare Access app + AUD + team domain |
| P7-4 | **NEEDS VALUE** | `admin_users` owner email row on remote |
| P7-5 | **NEEDS DECISION** | Remote catalogue import procedure (SQL file vs new script) |
| P7-6 | **NEEDS DECISION** | Remote purchase/X4 rate loading (local scripts only today) |
| P7-7 | **NEEDS VALUE** | `CORS_ALLOWED_ORIGINS` + Vercel `VITE_API_BASE_URL` |
| P7-8 | **NEEDS VALUE** | Cloudinary secrets if admin image upload required day one |
| P7-9 | **NEEDS DECISION** | Access scope: API-only vs Vercel admin UI + API cross-origin cookies |
| P7-10 | Info | Local D1 contains test customer requests / extra rate rows — **do not** clone to production |
| P7-11 | Info | Phase 6 E2E script hard-codes rate counts (70/138); local DB may differ — not a deploy blocker |

---

## 9. Recommended deployment sequence

1. **BLOCKED → READY:** `wrangler login`; create D1; update `database_id` in `wrangler.toml` (commit only the id, not secrets).
2. **Remote schema:** `migrations apply --remote` (operator).
3. **Bootstrap:** `admin_users` INSERT; catalogue UPSERT SQL; optional approved rate SQL (no 68-review bulk without sign-off).
4. **Secrets:** Access vars, CORS, Cloudinary (if needed). **Omit** all `ADMIN_LOCAL_DEV_*`.
5. **Access policies:** Match Worker (and Vercel if admin UI on Vercel) URLs.
6. **`npm run check`** then **`npm run deploy`** → note workers.dev URL.
7. **Vercel:** set `VITE_API_BASE_URL`, deploy frontend, verify deep links and Estimate → POST customer-requests.
8. **Smoke:** `GET /health`, public products, authenticated admin session, one test customer request (then mark void/closed if desired).

---

## 10. Files inspected

- `server/wrangler.toml`
- `server/package.json`
- `server/.env.example`
- `server/database/migrations/*.sql`, `database/migrations/README.md`
- `server/docs/AUTH.md`, `LOCAL_ADMIN_DEV.md`, `PHASE2B_CATALOGUE.md`, `PHASE6_2_DEPLOY_CONNECTIVITY.md`, `PHASE6_3_QA_REPORT.md`
- `server/src/middleware/adminAuth.js`, `localAdminDevAuth.js`, `server/src/lib/cors.js`, `cloudinarySign.js`
- `server/scripts/import-catalogue-local.mjs`, `import-x4-private-rates.mjs`
- Root `vercel.json`, `.env.example`
- Read-only: `wrangler whoami`, `wrangler d1 migrations list --local`, `d1_migrations` query on local DB

**No application code or pricing changes in Phase 7.0.**
