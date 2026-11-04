# Diwali project — technical handover

**Purpose:** Enable continued development in another environment without re-discovering architecture, season model, or deployment rules.
**Last prepared:** 2026-11-01 (read-only audit; no secrets included).

---

## 1. Architecture, tech stack, folder structure

### High-level architecture

| Layer | Technology | Role |
|-------|------------|------|
| **Storefront SPA** | React 19 + Vite 8 + React Router 7 + Tailwind 4 | Public catalogue, estimate/cart, customer request submission |
| **Admin SPA** | Same stack under `src/admin/` | Catalogue, Quick Bill, customer requests, users, platform season admin |
| **API** | Cloudflare Worker (`server/`) | HTTP API, auth, D1 access |
| **Database** | Cloudflare D1 (SQLite) | Single binding `DB` → database name `diwali-quotation` |
| **Images** | Cloudinary (signed uploads from Worker) | Product/family-pack images; local `/images/...` paths still supported |
| **Production hosting** | Vercel (frontend + `/api/*` proxy) → Worker origin | Same-origin cookies for admin session |

```
Browser (diwali-stall.vercel.app)
  ├─ /*           → Vercel static (Vite build)
  └─ /api/*       → rewrite → Cloudflare Worker (diwali-api)
Worker
  └─ D1 binding DB (diwali-quotation)
```

### Repository layout (top level)

| Path | Contents |
|------|----------|
| `src/` | Storefront pages, components, contexts, public API clients |
| `src/admin/` | Admin UI, routes, session, platform/season UI |
| `server/` | Worker entry, routes, services, migrations, tests, scripts |
| `server/database/migrations/` | D1 SQL migrations (Wrangler-managed `d1_migrations` table) |
| `server/docs/` | Auth, deploy, local dev runbooks |
| `public/` | Static assets (product/family-pack images for local paths) |
| `tests/` | Root-level frontend/unit tests |
| `vercel.json` | SPA fallback + Worker API proxy |
| `.env.example` | Frontend local env **names** (`VITE_*`, proxy JWT hint) |
| `server/.env.example` | Worker local env **names** (→ copy to `server/.dev.vars`) |

**Note:** `server/README.md` is partially stale (still mentions Access-only auth and “frontend does not call API”); the storefront **does** use `/api/public/*` via `CatalogueProductsContext`, `FamilyPacksContext`, and `Estimate.jsx`.

---

## 2. Git branch / commit

**Not available in this handover session** — no `git` commands were run per safety rules.

From the last known workspace snapshot: the repo is a **git repository** with **large uncommitted changes** (multi-season platform work, family-pack image renames, many new tests, temporary scripts under `server/scripts/_tmp-*`, SQL dumps). Treat the working tree as **in flux** until the team confirms branch name and commit on the new machine.

---

## 3. Completed features vs proposed / incomplete

### Implemented (production-oriented)

- **Public catalogue:** Paginated products and family packs from D1; gated by **platform-selected public catalogue season** (`platform_settings.public_catalogue_season_id`).
- **Customer requests:** Web estimate submission with idempotency, public reference (`DWL-…`), line validation against catalogue season; no private rates exposed.
- **Admin password auth:** Login/logout, session cookie `diwali_admin_session`, bootstrap owner, rate-limited attempts (`admin_login_attempts`).
- **Admin catalogue:** Categories and products CRUD (season-scoped), private (x4) and purchase rates, archive/restore, role-filtered pricing columns.
- **Family packs:** Admin CRUD, server-allocated `FP###` ids, public list/detail by slug.
- **Customer request admin:** List/detail, status, stall-bill workflow (manual source), assignment, finalize, customer-agreed → pending finalization (web).
- **Quotations:** Per-request active quotation, WhatsApp payload helpers, bargain/quick-bill audit fields, season-scoped access.
- **Quick Bill:** Preview/checkout, selling vs bargain pricing, **box vs loose-piece line pricing** (see §7), creates manual request + quotation + pending finalization.
- **Bill adjust:** Replace lines on pending manual bills (season-scoped).
- **Cloudinary:** Signed upload params for products and family packs.
- **Multi-season (implemented):** `business_seasons`, `season_members`, `season_id` on core business tables, admin season selector + `X-Admin-Season-Id`, archived season read-only guards.
- **Platform admin (implemented):** `platform_admins` registry, `/api/admin/platform/*` for seasons, cross-season members, public catalogue season setting; UI at `/admin/platform`.

### Proposed / not implemented

- **Multi-location business model:** Independent catalogue, pricing, stock, and family packs **per business location**; permanent vs seasonal location rules — see §11. **Not in schema** (no `location_id`; today’s `season_id` is a partial stand-in for catalogue scoping only).
- **Server-generated product IDs (future creates):** Products still require client-supplied `P###` on create; family packs already use server **`FP###`** allocation. **All existing product IDs and historical rows must be preserved.**
- **Central business sales analytics:** Location and consolidated reports — see §11 requirement **A**.
- **Full box/loose inventory and line accounting:** Quick Bill pricing for box/piece exists (§7); **separate persisted quantities, stock decrement, returns/adjustments inventory safety** — see §11 requirement **B**.
- **Per-location inventory ledger:** Opening/closing stock, purchases, adjustments — see §11 requirement **C**.
- **Season catalogue copy workflow:** Copy prior season to new location/season as **new IDs**, confirm prices, zero stock — not implemented.
- **Schema alignment:** Global PKs/uniques (`categories.slug`, `family_packs.slug`, rate indexes) conflict with true per-location catalogues — requires planned migrations (§12).

---

## 4. Database schema, migrations, constraints

### Migration inventory (20 files, apply in filename order)

Wrangler tracks applied files in **`d1_migrations`**. Local dev typically has all 20 applied (through **0019**).

| File | Summary |
|------|---------|
| `0001_initial_schema.sql` | Core tables: categories, products, admin_users, private_rates, customer_requests/items, quotations/items; money in paise |
| `0002_seed_categories.sql` | Seed category rows |
| `0003_products_company.sql` | `products.company` |
| `0004_products_selling_price_paise.sql` | Public selling price column |
| `0005_product_purchase_rates.sql` | Purchase rate history + partial unique “one current per product” |
| `0006_quotations_one_active_per_request.sql` | Partial unique: one non-void quotation per request |
| `0007_admin_password_auth.sql` | Password hash, roles, sessions, login attempts |
| `0008_admin_owner_bootstrap_lock.sql` | Singleton owner bootstrap gate |
| `0009_family_packs.sql` | Family packs, images, items; `family_pack_id` on request lines |
| `0010_customer_request_unit_price.sql` | `unit_price_paise` on request lines |
| `0010_products_final_price_paise.sql` | `final_price_paise` on products (Quick Bill / bargain) |
| `0011_admin_super_admin_role.sql` | Rebuild `admin_users` with `super_admin` role |
| `0012_customer_request_public_reference.sql` | `public_reference` + partial unique index |
| `0013_customer_request_delivery_fields.sql` | Delivery address/landmark/maps URL |
| `0014_products_pieces_per_pack_loose_sale.sql` | Loose sale support |
| `0015_quotations_quick_bill_audit.sql` | `pricing_mode`, selling/final/bargain/accepted amounts |
| `0016_customer_request_finalization_assignment.sql` | Stall queue: `finalization_status`, `assigned_to_email` |
| `0017_customer_request_workflow_audit.sql` | assigned/closed by/at audit columns |
| `0018_business_seasons_foundation.sql` | Seasons, platform_settings, season_members, **`season_id`** + indexes + backfill `season-2026` |
| `0019_platform_admins.sql` | `platform_admins` table |

### Tables (application)

`admin_users`, `admin_sessions`, `admin_login_attempts`, `admin_owner_bootstrap`, `platform_admins`, `business_seasons`, `platform_settings`, `season_members`, `categories`, `products`, `private_rates`, `product_purchase_rates`, `family_packs`, `family_pack_images`, `family_pack_items`, `customer_requests`, `customer_request_items`, `quotations`, `quotation_items`, `d1_migrations`.

### Important constraints

- **Product id format (app + routes):** `P` + digits (`/^P\d{3,}$/`) — not UUID.
- **Family pack id:** `FP###` (server-allocated on create).
- **Partial uniques:** One current private rate per `product_id`; one current purchase rate per `product_id`; one active quotation per `customer_request_id` (non-void); unique `public_reference` when not null.
- **Line math:** `quotation_items.line_total_paise = quantity * unit_rate_paise`.
- **Season columns:** `season_id` on categories, products, family_packs, customer_requests, quotations, private_rates, product_purchase_rates (FK to `business_seasons` where declared in 0018).
- **No `location_id` or `stall_id`** in schema today (location model is §11 **proposed**).

### Local DB commands (names only)

```bash
cd server
npm run db:migrate:local
npm run db:migrations:list:local
npx wrangler d1 execute diwali-quotation --local --command "SELECT name FROM d1_migrations ORDER BY name" --json
```

**Do not** run `--remote` or import scripts against production without the deploy runbook.

### Production Safety

**Deployment Approval Gate:** Never deploy frontend or backend changes, execute remote database migrations, or modify production data without explicit approval from the user. Always verify backups, review migrations, and complete local testing before requesting deployment approval.

---

## 5. API routes, services, frontend mapping

### Public routes (`server/src/index.js`)

| Method | Path | Service / handler | Frontend |
|--------|------|-------------------|----------|
| GET | `/health` | `routes/health.js` | — |
| GET | `/api/public/products` | `publicProducts.js` | `src/api/publicProducts.js`, `CatalogueProductsContext` |
| GET | `/api/public/products/:id` | `P\d+` only | Product detail flows |
| POST | `/api/public/customer-requests` | `publicCustomerRequests.js` | `Estimate.jsx` → `submitPublicCustomerRequest` |
| GET | `/api/public/family-packs` | `publicFamilyPacks.js` | `FamilyPacksContext`, packs pages |
| GET | `/api/public/family-packs/:slug` | `publicFamilyPacks.js` | `PackDetail.jsx` |

### Admin auth (unauthenticated subset)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/admin/auth/login` | Session cookie |
| POST | `/api/admin/auth/logout` | |
| POST | `/api/admin/auth/bootstrap-owner` | One-time + `ADMIN_BOOTSTRAP_SECRET` |

All other `/api/admin/*` → **`requireAdmin`** then season/platform guards.

### Admin business routes (season-scoped; header `X-Admin-Season-Id`)

| Area | Route prefix | Route module | Service layer | Admin pages |
|------|--------------|----------------|---------------|-------------|
| Session | `GET /api/admin/session` | `routes/admin.js` | `adminSeasonContext.js` | `AdminSessionContext`, layout |
| Catalogue | `/api/admin/categories`, `/api/admin/products` | `adminCatalogue.js` | `adminCategories.js`, `adminProducts.js`, rates services | Products, categories, create/edit product |
| Family packs | `/api/admin/family-packs` | `adminFamilyPacks.js` | `adminFamilyPacks.js` | Family pack list/edit |
| Customer requests | `/api/admin/customer-requests` | `adminCustomerRequests.js` | `adminCustomerRequests.js`, `adminCustomerRequestBillAdjust.js` | Requests list/detail |
| Quotations | `/api/admin/customer-requests/:id/quotation`, `/api/admin/quotations/...` | `adminQuotations.js` | `adminQuotations.js` | Request detail |
| Quick Bill | `/api/admin/quick-bill/preview`, `checkout` | `adminQuickBill.js` | `adminQuickBill.js` | `AdminQuickBillPage` |
| Users | `/api/admin/users`, assignees | `adminUsersRoutes.js` | `adminUsersManagement.js` | `AdminUsersPage` |
| Uploads | `POST /api/admin/uploads/sign` | `adminUploads.js` | Cloudinary sign | Product/family-pack forms |

### Platform admin routes (no season header; **`platform_admins`** only)

| Path | Module | UI |
|------|--------|-----|
| `/api/admin/platform/session` | `adminPlatformRoutes.js` | Platform gate |
| `/api/admin/platform/seasons` (+ CRUD, archive, members) | `adminPlatformSeasons.js`, `adminPlatformSeasonMembers.js` | `AdminPlatformDashboardPage` |
| `/api/admin/platform/settings/public-catalogue-season` | `adminPlatformPublicCatalogue.js` | Platform public catalogue section |

### Storefront routes (`src/App.jsx`)

| Path | Page |
|------|------|
| `/`, `/crackers`, `/crackers/:categorySlug` | Home, catalogue |
| `/packs`, `/packs/:packSlug` | Family packs |
| `/estimate`, `/estimate/history` | Estimate / history |
| `/admin/*` | `AdminRoutes.jsx` (see §1) |

---

## 6. Authentication, season context, authorization

### Authentication flow

1. **`requireAdmin`** (`middleware/requireAdmin.js`): password session cookie and/or configured Cloudflare Access JWT; loads **`AdminSeasonContext`** via `resolveAdminSeasonContext`.
2. **Session API** returns `activeSeasonId`, `seasonRole`, `memberships`, `platformAdmin`, archived flag — frontend must use **`seasonRole`**, not legacy `admin_users.role`, for permissions (`server/docs/AUTH_PASSWORD.md`).

### Active season selection

- Header **`X-Admin-Season-Id`**: must match a non-disabled `season_members` row for the user.
- **No header:** exactly **one** active membership → auto-select; **zero or many** → `activeSeasonId: null` (UI must prompt; **no silent default** to `season-2026` at runtime).
- **`DEFAULT_ADMIN_SEASON_ID`** (`season-2026`): migration backfill and tests only.

### Guards

- **`requireActiveSeason` / `requireSeasonMembership` / `requireWritableSeason`** (`middleware/adminSeasonGuards.js`): archived seasons → read-only for mutations.
- **`resolveSeasonScopedAuthorization`** (`lib/adminSeasonAuthorization.js`): capabilities from **`season_members.role`** (owner / super_admin / admin) — Quick Bill assign/finalize, sensitive pricing, product delete, season user management.
- **`requirePlatformAdmin`**: platform routes only; explicit `platform_admins` row (not implied by owner).

### Frontend wiring

- `src/admin/api/client.js` attaches `X-Admin-Season-Id` from `adminSeasonRequest.js` / session state.
- `AdminSeasonSelector.jsx`, `useAdminSeasonReadOnly.js`, `AdminArchivedSeasonBanner.jsx`.

---

## 7. Quick Bill, quotations, pricing, stock

### Quick Bill (`adminQuickBill.js`) — **implemented today**

- Resolves lines from **`products`** for **active admin season** (`season_id`).
- **Selling mode:** catalogue box selling price; optional **final** price when set.
- **Bargain mode:** audit subtotals, floor margin (`quickBillBargain.js`), optional accepted amount warnings; **`accepted_amount_paise`** on quotations when bargain checkout applies.
- **Box vs loose-piece sales (implemented in Quick Bill / bill-adjust validation):**
  - Request items accept **`unitType`** / **`unit_type`**: `'box'` | `'piece'` (`customerRequestValidation.js`, Quick Bill preview/checkout).
  - Enforces **`allow_loose_sale`** and configured **`pieces_per_pack`** before allowing piece lines.
  - Piece unit price derived from box selling/final price via **`floor(boxPaise / pieces_per_pack)`** (`adminQuickBill.js`).
  - Persisted request lines use a **single `quantity`** per row; loose lines are distinguished by **product name suffix** (e.g. loose-piece labeling in `mapQuickBillLinesForRequestInsert`), not separate box/piece quantity columns in D1.
- **Checkout:** `crypto.randomUUID()` request id → `createManualCustomerRequest` (`source: manual`, `season_id`) → pending finalization → `createOrGetQuotationForRequest` with quick-bill audit columns.
- **Stock (implemented):** Hard **`stock_status`** gate — rejects `soldout` / `sold-out` at line resolution (Quick Bill and public requests). **No quantity-based inventory decrement** and no “open box” tracking yet (§11 **B** / **C**).

### Public / request line resolution (`publicCustomerRequests.js`)

- Web requests: season from **`resolveActivePublicCatalogueSeasonId`** (platform setting + active season status).
- Manual/quick bill: season from admin active season.
- Products: active + not sold out; family packs via `publicFamilyPacks.js` for same season.

### Quotations (`adminQuotations.js`)

- Season-scoped fetch/update; one non-void quotation per request (DB partial unique).
- Customer-facing totals: `customerFacingQuotationTotal.js`; internal preview: `adminInternalPricingPreview.js`.
- WhatsApp message builders in admin lib tests.

### Pricing layers

| Layer | Storage | Visibility |
|-------|---------|------------|
| Public selling | `products.selling_price_paise` | Public API (must be > 0 to list) |
| Final (stall/bargain) | `products.final_price_paise` | Admin / Quick Bill |
| Private x4 | `private_rates` + season_id | Owner/super_admin admin views |
| Purchase | `product_purchase_rates` + season_id | Sensitive role admin |

### Stock

- **Implemented:** Single **`stock_status`** flag per **product row** (scoped by app to active **`season_id`**, not by physical location).
- **Not implemented:** Per-location quantity inventory, box/piece stock splits, or automatic decrement on finalize (see §11 **C**).

---

## 8. Local setup, env var names, build, tests

### Prerequisites

- Node **≥ 20.3** (Wrangler ~4.85).
- Two terminals typical: `server/` (`npm run dev`) + repo root (`npm run dev`).

### Setup steps

```bash
# Root
npm install
cp .env.example .env.local   # names only; set as needed

# Server
cd server
npm install
cp .env.example .dev.vars    # never commit .dev.vars
npm run db:migrate:local
npm run dev                  # Worker :8787 default
```

**Local admin options (see `server/docs/LOCAL_ADMIN_DEV.md`, `AUTH_PASSWORD.md`):**

- Password: bootstrap owner on **local D1** via `POST /api/admin/auth/bootstrap-owner`.
- Or local JWT proxy: `ADMIN_LOCAL_DEV_*` in `server/.dev.vars` + `ADMIN_LOCAL_DEV_JWT` in root `.env.local` + `npm run admin:local-jwt`.

### Environment variable names (never commit values)

**Root `.env.local` / Vite**

| Name | Purpose |
|------|---------|
| `VITE_API_BASE_URL` | Empty = same-origin/proxy; non-empty = direct Worker URL |
| `VITE_DEV_API_PROXY` | Optional wrangler dev URL for Vite proxy |
| `ADMIN_LOCAL_DEV_JWT` | Dev-only proxy injection (not `VITE_`) |

**Worker `server/.dev.vars` / Cloudflare Dashboard**

| Name | Purpose |
|------|---------|
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins (plain var) |
| `ADMIN_BOOTSTRAP_SECRET` | One-time owner bootstrap (secret) |
| `ADMIN_SESSION_TTL_SECONDS` | Optional session TTL |
| `ADMIN_SESSION_PEPPER` | Optional login rate-limit pepper |
| `ADMIN_LOCAL_DEV_AUTH` | Local JWT auth opt-in |
| `ADMIN_LOCAL_DEV_SECRET` | Local JWT signing secret |
| `ADMIN_LOCAL_DEV_EMAIL` | Local JWT email claim |
| `CLOUDINARY_CLOUD_NAME` | Upload signing |
| `CLOUDINARY_API_KEY` | Upload signing |
| `CLOUDINARY_API_SECRET` | Upload signing (Worker only) |
| `CF_ACCESS_TEAM_DOMAIN` | Optional legacy Access |
| `CF_ACCESS_AUD` | Optional legacy Access |
| `CLOUDFLARE_ACCOUNT_ID` | Optional CLI/scripts |
| `CLOUDFLARE_API_TOKEN` | Optional CLI/scripts |

### Build

```bash
npm run build          # root → dist/
cd server && npm run check   # Worker dry-run deploy
```

### Tests (targeted)

```bash
# Frontend unit tests (root)
npm test

# Server — applies local migrations first (pretest)
cd server
npm run test:unit          # Fast unit/integration without full D1 catalogue import
npm run test:integration   # Migrations, schema constraints, products/family packs D1
npm test                   # Full server test tree

# Examples
node --test server/tests/adminQuickBill.test.js
node --test server/tests/adminSeasonAuthorization.test.js
node --test server/tests/publicProductSeason.test.js
```

Local D1 state: `server/.wrangler/` (gitignored).

---

## 9. Known bugs, incomplete work, technical debt

| Item | Severity | Notes |
|------|----------|--------|
| **`computeQualifyingOrderTotalPaise`** | Medium | Product branch queries `products` **without `season_id`**; family packs use public catalogue season — possible wrong-season total for free-delivery threshold (`server/src/lib/qualifyingOrderTotal.js`). |
| **Global product id uniqueness on create** | Medium | `createAdminProduct` checks `id` globally; conflicts with **per-location catalogues** and season-copy-with-new-ids (§11). |
| **Global slug/id DB constraints** | Medium | `categories.slug` PK, `family_packs.slug` UNIQUE, rate partial uniques on `product_id` only — **location-independent** at DB layer; needs migration plan (§12). |
| **Quick Bill vs analytics/inventory model** | Medium | Box/piece **pricing** exists; no separate box/piece qty columns, no finalized-sales fact table, no inventory ledger (§11 **A–C**). |
| **Stale docs** | Low | `server/README.md` (Access-only, static catalogue); `PRODUCTION_DEPLOY.md` migration table stops at **0011** in places — verify remote list before deploy. |
| **Repo hygiene** | Low | Untracked temp scripts/SQL dumps under `server/scripts/`, `server/*.sql` — not part of runtime; review before commit. |
| **Manual requests without season** | Low | Legacy insert path if `seasonId` omitted on manual create — Quick Bill always passes season. |

---

## 10. Production deployment and safety restrictions

Documented in **`server/docs/PRODUCTION_DEPLOY.md`** and **`server/docs/AUTH_PASSWORD.md`**.

| Rule | Detail |
|------|--------|
| **Frontend** | Vercel; **`VITE_API_BASE_URL` empty** in production; `vercel.json` rewrites `/api/*` to Worker |
| **Worker** | `cd server && npm run deploy`; binding **`DB`**, name **`diwali-api`** |
| **Migrations** | `npx wrangler d1 migrations apply diwali-quotation --remote` only with backup + verified list |
| **Never on remote** | `catalogue:import:local`, `x4:rates:import:apply`, `purchase:rates:import:apply`, ad-hoc product replace scripts without review |
| **Secrets** | Bootstrap secret removed after owner created; Cloudinary secrets Worker-only |
| **CORS** | Must include production Vercel origin |
| **Public catalogue** | Only **`platform_settings.public_catalogue_season_id`** — no fallback season |

---

## 11. Confirmed business decisions — seasons, locations, catalogue, analytics

### Terminology

| Term | Meaning in product direction |
|------|------------------------------|
| **Business location** | A shop/site with its **own** catalogue, brands, prices, stock, and family packs. Primary isolation boundary for inventory and sales reporting. |
| **Season** (`business_seasons`) | **Implemented in code** as a time-bound operating period and admin permission scope. For **seasonal businesses**, each season maps to a **new physical operating location** (stall numbers may change year to year). For **permanent shops**, the **same location** continues across seasons with **continuing catalogue and inventory**. |
| **Stall** (colloquial) | Physical stall number at a venue — **may change each season** for seasonal businesses; **not** a substitute for “location” in data model. |

### Business types — **confirmed**

1. **Permanent shops:** Same **location**, **catalogue**, and **inventory** carry across annual seasons (season is primarily reporting/admin period, not a new shop).
2. **Seasonal businesses:** **New operating location each season**; physical stall identifiers may differ from prior seasons.
3. **Every location** has **independent** products, categories, brands (e.g. product `company`), quality attributes, prices, stock, and family packs — **no shared catalogue row** across locations.
4. **Previous-season catalogue copy:** Creates **new records with new IDs**; copy product **details**; **prices require explicit confirmation**; **stock starts at zero** (including family-pack composition targets).
5. **Historical integrity:** **Preserve all existing product IDs** and all historical requests, quotations, and lines — no re-keying legacy `P###` / `FP###` rows.
6. **Future IDs:** **Server-generated** product IDs for new creates (family packs already use server **`FP###`** allocation).

### Multi-season platform — **implemented** (preserve; extend, do not replace)

- **`business_seasons`**, **`season_members`**, **`platform_admins`**, **`platform_settings.public_catalogue_season_id`**.
- **`season_id`** on categories, products, family_packs, customer_requests, quotations, private_rates, product_purchase_rates.
- Admin **`X-Admin-Season-Id`**, archived read-only seasons, **`seasonRole`** authorization.
- **Gap vs confirmed model:** Code scopes catalogue by **`season_id`**, not **`location_id`**. Treat current `season_id` as a **stopgap** until location-scoped catalogues and inventory land; design migrations to **add location**, not rip out season membership.

### Multi-location catalogue & inventory — **proposed**

- Registry: **`business_locations`** (type: permanent vs seasonal), link seasonal locations to **`business_seasons`**, optional display stall label per season.
- **Membership:** location-scoped roles (mirror `season_members` pattern) or compound season+location context for admins.
- **Catalogue tables** gain **`location_id`** (or location-scoped PKs): categories, products, family_packs, rates — **unique slugs/ids per location**, not global.
- **Sales documents:** `customer_requests` / `quotations` (and line tables) reference **`location_id`** + season as needed for reporting.
- **Today’s “stall bill” workflow** (`source = manual`, finalization, assignment) remains the operational UX; it must become **location-aware**, not a shared season-wide queue across locations.

### Requirement A — Central business sales analytics — **proposed**

- **Per-location reports** and **consolidated business-wide** reports (owner/platform).
- **Best-sellers** and **slow movers**; breakdowns **by product, category, and brand**.
- Metrics: **units sold**, **sales revenue**, **date-range / monthly / season-wise** trends.
- **Count only finalized sales:** include requests/orders in a finalized state; **exclude** pending/cancelled requests and **void** quotations.
- Revenue must reflect **bill adjustments** and **accepted bargain amounts** (`accepted_amount_paise`, quotation audit fields) correctly.
- **Immutable historical facts** — finalized sales remain reportable after catalogue changes or new seasons (append-style facts or frozen line snapshots).

### Requirement B — Box and loose-piece sales — **partially implemented**

| Area | Status |
|------|--------|
| **`pieces_per_pack`**, **`allow_loose_sale`** on products | **Implemented** (migration 0014) |
| Quick Bill / adjust: **`unitType` box vs piece**, loose price from box price, block loose when disabled | **Implemented** (§7) |
| Separate **box qty** and **loose piece qty** per persisted line | **Proposed** — today single `quantity` + naming convention |
| **Equivalent total pieces** `(boxes × pieces_per_pack) + loose pieces` for reporting | **Proposed** |
| **Inventory decrement** for box vs piece, **open-box** handling | **Proposed** |
| **Returns / bill adjust** without corrupting inventory or double-counting analytics | **Proposed** — adjust replaces lines today; inventory/analytics rules not defined in DB |
| Reports: box sales, piece sales, combined equivalent **without double counting** | **Proposed** |

### Requirement C — Inventory — **proposed**

- **Independent inventory per business location** (not shared across locations).
- Ledger concepts: **opening stock**, **purchases / stock additions**, **box sales**, **loose sales**, **adjustments**, **closing stock**.
- **Permanent shops:** stock **carries across seasons** at the same location.
- **New seasonal locations:** **zero opening stock**, including after **catalogue copy** from a prior season (new product IDs, zero quantities).

---

## 12. Implementation phases and migration risks

Phases are **ordered**; later phases depend on location and line-item models. **Do not** conflate with existing Quick Bill box/piece **pricing** (already shipped — §7).

### Phase 0 — Correctness on current model (low migration risk)

- Fix **`qualifyingOrderTotal`** to scope products by public catalogue **`season_id`**.
- Document/reporting gaps explicitly in admin until analytics ship.

### Phase 1 — Product ID policy (minimal schema)

- **Server-generated** IDs for **new** products only; **`isValidProductId`** accepts legacy **`P###`** indefinitely.
- **No migration** required for ID format; **never rewrite** existing product or line references.

### Phase 2 — Location foundation (new tables, additive)

- **`business_locations`**, **`location_members`** (or equivalent), optional **`season_id`** FK for seasonal sites.
- Admin **location context** (header/session) alongside **season**; default rules: permanent = one location across seasons; seasonal = one location per season.
- **Migration risk:** Low for empty/new tables; **medium** for backfilling a default location on existing single-shop data (`season-2026` → default location row).

### Phase 3 — Per-location catalogue (high migration risk)

- Add **`location_id`** to catalogue entities; move toward **composite uniqueness** `(location_id, slug)` / `(location_id, product id)` rather than global PKs.
- **Catalogue copy** job: clone details → **new IDs**, **confirm prices** UI, **stock = 0**.
- **Migration risks:**
  - Rebuilding **`categories`** PK / **`products.category_slug` FK** — **high**; requires staged migration and FK to `(location_id, slug)` or surrogate category keys.
  - **`family_packs.slug` UNIQUE** globally — **high** when duplicating per location/season copy.
  - **`private_rates` / `product_purchase_rates` partial uniques** — **medium**; must include **`location_id`** (and/or product scoped to location).
  - Data backfill: map existing rows to **default location** before NOT NULL enforcement.

### Phase 4 — Sales lines, finalize facts, analytics (medium–high)

- Extend **`customer_request_items`** / **`quotation_items`** (or parallel **sales_line_facts**): **`box_quantity`**, **`loose_piece_quantity`**, unit prices, **`location_id`**, link to finalized request/quotation.
- **Finalized-sales rule engine** for reporting: status/finalization filters, exclude void quotes, use **accepted amounts** and post-adjustment lines.
- **Central analytics API** (location + consolidated); no equivalent exists today.
- **Migration risk:** **Medium** — additive columns + backfill heuristics for legacy lines (treat legacy `quantity` as box count or infer from name suffix); historical reports may need “pre-migration” flag.

### Phase 5 — Inventory ledger (medium–high)

- Quantity stock per **(location, product)**; movements for purchase, box sale, loose sale, adjust, return; **open box** state or equivalent-pieces accounting.
- Integrate **finalize**, **bill adjust**, and future **returns** so ledger and analytics stay consistent (Requirement **B** / **C**).
- **Permanent location:** carry closing → opening across seasons; **seasonal new location:** always zero after copy.
- **Migration risk:** **High** if replacing **`stock_status`** only — prefer **additive** quantity layer first; `stock_status` may remain a derived/sold-out flag.

### Phase 6 — Public storefront binding

- Public catalogue resolves **location** (and season) explicitly — likely via platform settings evolution, not only `public_catalogue_season_id`.
- Customer requests stamped with **location_id** for the catalogue they used.

### Migration risks (summary)

| Change | Risk | Notes |
|--------|------|--------|
| **0011-style table rebuild** | High | Any `admin_users`-style swap — full backup |
| **0018-style ADD COLUMN + backfill** | Low–medium | Pattern for `location_id`; nullable → backfill → NOT NULL |
| **Category/product PK / FK redesign** | **Critical** | Blocks true per-location catalogues; plan multi-step migration |
| **Sales fact + inventory tables** | Medium | Prefer new tables over rewriting quotation history |
| **Catalogue copy with new IDs** | Medium | Orphan risk if copy partial; must not mutate source season rows |
| **Remote apply without list/backup** | **Critical** | Local vs remote `d1_migrations` may differ |

### Before any remote migration

```bash
cd server
npx wrangler d1 migrations list diwali-quotation --remote
# Verified backup, then apply
```

---

## Quick reference

| Item | Value |
|------|--------|
| Worker name | `diwali-api` |
| D1 database name | `diwali-quotation` |
| Default backfill season id | `season-2026` |
| Product id pattern | `P` + 3+ digits |
| Family pack id pattern | `FP` + 3+ digits |
| Admin session cookie | `diwali_admin_session` |
| Season header | `X-Admin-Season-Id` |
| Production site (configured) | `https://diwali-stall.vercel.app` |

---

*End of handover. For day-to-day deploy steps, prefer `server/docs/PRODUCTION_DEPLOY.md` and `server/docs/AUTH_PASSWORD.md` over older README fragments.*
