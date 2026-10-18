# Diwali server (Cloudflare Workers + D1)

Local API for the public catalogue, authenticated admin product/category management, and **signed Cloudinary upload params**. **Admin UI, image upload to Cloudinary, quotation APIs, and production D1 are not implemented.**

The frontend in the repo root does **not** call this API yet. Customer pages still use `src/data/products.js`.

## Prerequisites

- Node.js **20.3+** (Wrangler is pinned to `~4.85.0`; Wrangler 4.90+ needs Node 22)
- For local D1 tests: Wrangler local state under `server/.wrangler/` (gitignored)
- For deploy later: a Cloudflare account, a real D1 `database_id`, and Cloudflare Access (not used in this phase)

## Setup

```bash
cd server
npm install
```

Copy `.env.example` → `.dev.vars` for local `wrangler dev`. Never commit `.dev.vars`.

`.dev.vars` may include Cloudflare Access and Cloudinary bindings (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). The Worker reads them as `env.*`. **Never put the API secret in frontend code or API responses.**

`wrangler.toml` currently uses a **placeholder** `database_id`. Do not run `wrangler d1 create` or remote execute in this phase.

## Authentication (admin only)

Every request whose path starts with `/api/admin` is authenticated **before** any admin handler runs (`requireAdmin` in `src/index.js`).

1. Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`, or `CF_Authorization` cookie)
2. Email claim must exist in D1 `admin_users` (allowlist; no self-registration)

There is no in-app password and no production bypass. Details: `docs/AUTH.md`.  
**No Cloudflare account yet?** Loopback-only local JWT for `wrangler dev`: `docs/LOCAL_ADMIN_DEV.md`.

| Condition | Status | `error` |
|-----------|--------|---------|
| `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD` missing | 503 | `auth_not_configured` |
| Missing or invalid JWT | 401 | `unauthorized` |
| Valid JWT, email not in `admin_users` | 403 | `forbidden` |
| Access OK but D1 binding missing | 503 | `database_unavailable` |

Public routes do not require Access.

## Public API

Public JSON **never** includes `private_rates`, `unit_rate_paise`, `price`, `x4`, `company`, or `active`.

Approved product fields: `id`, `categorySlug`, `categoryLabel`, `name`, `pack`, `description`, `featured`, `stockStatus`, `sortOrder`, `images`.

Only rows with `active = 1` are returned. Archived products are omitted.

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/health` | Public | `{ ok, service, phase }` — no D1 |
| GET | `/api/public/products` | Public | Paginated list (see below) |
| GET | `/api/public/products/:id` | Public | `:id` must match `P` + digits (e.g. `P001`). 400 invalid id, 404 missing/archived |

### `GET /api/public/products` pagination

Query: `limit`, `offset`. Response: `{ products: [...] }` — **no `total` count**.

| Param | Default | Clamp |
|-------|---------|--------|
| `limit` | **50** | 1–**100** (omitted, `0`, or non-numeric → 50) |
| `offset` | **0** | `>= 0` (negative → 0) |

Order: `sort_order ASC`, then `id ASC` (catalogue import order).

The imported catalogue has **161** active products. Default `limit=50` does **not** return the full set. Clients should page until a response has fewer rows than `limit`:

```http
GET /api/public/products?limit=100&offset=0
GET /api/public/products?limit=100&offset=100
```

That is enough for 161 rows (`100` + `61`). Do not raise the max limit without an explicit API change.

List cache: `Cache-Control: public, max-age=60`. Missing D1 binding: 503 `database_unavailable`.

## Admin API

All of the following sit behind the `/api/admin` gate above. Responses use `Cache-Control: no-store`.

### Session

| Method | Path | Success |
|--------|------|---------|
| GET | `/api/admin/session` | `{ ok, email, message }` |

### Categories

| Method | Path | Body / query | Success |
|--------|------|----------------|---------|
| GET | `/api/admin/categories` | — | `{ categories }` (all rows, no pagination) |
| POST | `/api/admin/categories` | `{ slug, label, sortOrder? }` | 201 `{ category }` |
| PATCH | `/api/admin/categories/:slug` | `{ label?, sortOrder? }` | `{ category }` or 404 |

### Products

| Method | Path | Body / query | Success |
|--------|------|----------------|---------|
| GET | `/api/admin/products` | `includeArchived=1` optional; `limit`, `offset` | `{ products }` |
| POST | `/api/admin/products` | `{ id, categorySlug, name, pack?, description?, featured?, stockStatus?, active?, sortOrder?, images?, company? }` | 201 `{ product }` |
| GET | `/api/admin/products/:id` | `:id` = `P` + digits | `{ product }` or 404 (includes archived) |
| PATCH | `/api/admin/products/:id` | Partial of create fields (no `id` change) | `{ product }` or 404 |
| POST | `/api/admin/products/:id/archive` | — | `{ product }` with `active: false` |
| POST | `/api/admin/products/:id/restore` | — | `{ product }` with `active: true` |

Admin product pagination: default **limit 100**, max **200**, default **offset 0**. Without `includeArchived=1`, only `active = 1`.

**Archive / restore:** products are never deleted by these routes. Archive sets `active = 0` (hidden from public list and from admin list unless `includeArchived=1`). Restore sets `active = 1`.

Unknown `/api/admin/...` paths: 404 after auth succeeds.

Admin product JSON may include `company` and `active`. It still does **not** join `private_rates`. There is no rates or quotation HTTP API.

Product `images` may be:

- local paths starting with `/images/` (existing catalogue), or
- HTTPS Cloudinary delivery URLs on `res.cloudinary.com` / `res-N.cloudinary.com` with `/image/upload/`

`http://`, other hosts, `javascript:`, `data:`, and credentialed URLs are rejected.

### Signed Cloudinary upload

| Method | Path | Body | Success |
|--------|------|------|---------|
| POST | `/api/admin/uploads/sign` | `{ productId, slot? }` | `{ cloudName, apiKey, timestamp, signature, folder, publicId }` |

- Same Access JWT + `admin_users` gate as every other `/api/admin/*` route.
- `productId` must be `P` + digits. `slot` is 1–20 (default **1**).
- **Folder and public ID are generated on the server** (`diwali/products` + `{productId}/{slot}`). Client `folder` / `publicId` fields are ignored.
- Response **never** includes `CLOUDINARY_API_SECRET`.
- Missing Cloudinary env: **503** `cloudinary_not_configured`.
- Browser then `POST`s the file to `https://api.cloudinary.com/v1_1/<cloudName>/image/upload` with `file`, `api_key`, `timestamp`, `signature`, `folder`, `public_id` (the returned `publicId`), and `overwrite=true`. After Cloudinary returns `secure_url`, `PATCH /api/admin/products/:id` with that HTTPS URL in `images`.

This phase does **not** upload files, rewrite catalogue rows, or provide an admin UI.

### Local Cloudinary `.dev.vars`

```bash
cd server
cp .env.example .dev.vars
# Edit .dev.vars with real CLOUDINARY_* values (never commit).
npm run dev
```

`POST /api/admin/uploads/sign` still requires Access to be configured; without Access env it returns **503** `auth_not_configured` before Cloudinary is used.

## Catalogue import (local D1 only)

Does **not** write `price` or `x4` into D1 or `private_rates`. Mapping: `docs/PHASE2B_CATALOGUE.md`.

1. `npm run catalogue:generate` — reads `src/data/products.js`, writes `data/catalogue-import.json` and `reports/catalogue-import-report.json`
2. `npm run catalogue:import:local` — UPSERT into **local** D1 (also writes `data/generated/catalogue-upsert.sql`)

Never run import against a remote database in this phase.

### Cloudinary migration audit (Phase 3C, read-only)

```bash
npm run catalogue:cloudinary:audit
```

Default **dry-run**: reads `src/data/products.js`, matches `/images/...` paths exactly under `public/`, writes:

- `reports/cloudinary-migration-audit.json` — summary, missing paths, empty arrays, unreferenced disk files, shared references
- `reports/cloudinary-migration-manifest.json` — deduped `uploadTasks` (one per local path) + per-product `entries` (shared slots reuse canonical `cloudinaryPublicId`)
- `reports/cloudinary-migration-review.json` / `.md` — human review: per-product rows, shared-path context, missing-path **candidates only** (no auto-mapping). Generate with `npm run catalogue:cloudinary:review`.

No uploads, network calls, or D1 writes. Shared catalogue paths produce **one** upload task; only the canonical product slot is `eligibleForAutomatedUpload`.

### Cloudinary upload runner (Phase 3D)

See [docs/PHASE3D_CLOUDINARY_UPLOAD.md](docs/PHASE3D_CLOUDINARY_UPLOAD.md).

```bash
npm run catalogue:cloudinary:upload          # dry-run (default)
npm run catalogue:cloudinary:upload:execute  # real uploads — explicit opt-in
```

Writes `data/generated/cloudinary-upload-mapping.json` and `reports/cloudinary-migration-upload-report.json`. Does **not** update D1.

## Commands

| Script | Mutates local D1? | Mutates generated import files? | Purpose |
|--------|-------------------|----------------------------------|---------|
| `npm run dev` | No (unless you call mutating APIs) | No | Local Worker |
| `npm run check` | No | No | `wrangler deploy --dry-run` (bundle only, no deploy) |
| `npm run db:migrate:local` | **Yes** (schema) | No | Apply migrations to local D1 |
| `npm run db:migrations:list:local` | No | No | List local migration status |
| `npm run catalogue:generate` | No | **Yes** (JSON + report) | Build import artifact from `products.js` |
| `npm run catalogue:import:local` | **Yes** (product UPSERT/prune) | **Yes** (SQL file) | Load catalogue into local D1 |
| `npm run catalogue:cloudinary:audit` | No | **Yes** (audit + manifest JSON) | Read-only image path audit for Cloudinary migration |
| `npm run catalogue:cloudinary:upload` | No | **Yes** (upload report JSON only) | Dry-run upload plan from manifest |
| `npm run catalogue:cloudinary:upload:execute` | No | **Yes** (mapping + report) | Signed Cloudinary uploads (requires `.dev.vars`) |
| `npm run test:unit` | No | No | In-process tests (auth, public SQL, pagination, Cloudinary sign, image URL validation, money) |
| `npm run test:integration` | **Yes** (pretest migrate; import/schema/admin fixtures) | **Yes** (catalogue import test regenerates JSON/SQL) | Local D1 tests |
| `npm test` | **Yes** (pretest migrate; integration files also mutate) | **Yes** if catalogue import tests run | All tests, sequential (`--test-concurrency=1`) |
| `npm run deploy` | Remote — **do not use in this phase** | — | Production deploy |

`npm test` pretest only applies **local** migrations. It does **not** run catalogue generate/import unless the catalogue import test file runs.

Frontend: from repo root, `npm run build` / `npm run dev` (independent of this package).

## Out of scope (later phases)

- Migrating D1 `images_json` from the upload mapping
- Admin UI
- Quotation / private-rate HTTP APIs
- Frontend migration off `products.js`
- Remote D1 create, migrate, or deploy
- Destroying Cloudinary assets
