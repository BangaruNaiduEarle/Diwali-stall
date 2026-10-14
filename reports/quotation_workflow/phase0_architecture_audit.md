# Diwali Quotation Workflow — Phase 0 Architecture Audit

**Project:** `C:\naidu\Diwali`  
**Date:** 2026-10-14  
**Scope:** Read-only audit. No application, config, data, or image changes were made for this report.

---

## Executive summary

The Diwali site is a **frontend-only** React 19 + Vite 8 SPA with **no server, API, database, or authentication**. Product catalogue and customer-facing **selling prices** are compiled into the JavaScript bundle via `src/data/products.js`. Estimate/cart state lives in **browser `localStorage`**. WhatsApp “orders” are **client-generated `wa.me` links** with pre-filled text—including **per-line and total amounts** derived from public `product.price`.

A **secure** private `/admin/quotation` flow that keeps **owner rates out of public bundles** **cannot** be achieved with the current stack alone. The smallest compatible addition is a **small authenticated backend** (serverless or lightweight Node) plus **persistent storage** for owner rates and quotation snapshots, with the admin UI loading rates **only via authorized API calls**.

The agreed future public workflow (no customer-visible prices; WhatsApp carries IDs/names and quantities only) is **not implemented today** and will require deliberate public UI and message-format changes in a later phase—separate from but coordinated with admin tooling.

---

## 1. Framework, routes, hosting, and deployment model

| Aspect | Finding |
|--------|---------|
| **Framework** | React 19, JSX (no TypeScript), React Router DOM 7 |
| **Build tool** | Vite 8 (`vite.config.js`: `@vitejs/plugin-react`, `@tailwindcss/vite`) |
| **Styling** | Tailwind CSS v4 (`src/index.css` + component classes) |
| **Scripts** | `dev`, `build`, `preview`, `lint` (oxlint) — `package.json` |
| **Backend in repo** | None (no Express, no `api/` folder, no serverless handlers) |
| **Deployment config** | No `vercel.json`, Netlify, Docker, or GitHub Actions deploy workflows in repo |
| **Environment** | No `.env` files in repo; business constants in `src/data/siteConfig.js` |

### Routes (client-side only)

Defined in `src/App.jsx` under `BrowserRouter`:

| Path | Page |
|------|------|
| `/` | Home |
| `/crackers` | Catalogue |
| `/crackers/:categorySlug` | Category catalogue |
| `/estimate` | My estimate (multi-step flow) |
| `/location` | Location |
| `/faq` | FAQ |
| `/404` | Not found |
| `*` | Redirect to `/404` |

There is **no** `/admin` or `/admin/quotation` route today.

### Hosting / deployment model

- **Production artifact:** static files in `dist/` after `npm run build` (default Vite output).
- **Runtime:** static hosting (any CDN, object storage + CDN, or `vite preview` locally). SPA routing requires **fallback to `index.html`** for deep links (host-specific rewrite rule—not defined in repo).
- **Conclusion:** **Frontend-only.** All catalogue logic, pricing display, and WhatsApp message composition run in the browser.

---

## 2. Backend, API, database, authentication, authorization

| Capability | Present? | Details |
|------------|----------|---------|
| HTTP API | **No** | No `fetch()` to app-owned endpoints in `src/` |
| Database | **No** | No ORM, migrations, or SQL files |
| Auth (login, sessions, JWT) | **No** | Plan doc explicitly excluded auth for v1 |
| Authorization | **No** | All routes and data are equally public once deployed |
| Secrets management | **No** | WhatsApp number is public config in `siteConfig.js` |
| Rate limiting / CSRF | **N/A** | No mutating server endpoints |

External integrations are **link-out only** (Google Maps URLs, `https://wa.me/...`).

**Implication:** Security cannot rely on “hidden” React routes. Any code or data imported into the public Vite graph ships to every visitor.

---

## 3. Product data storage and public delivery

### Source of truth (customer catalogue)

- **File:** `src/data/products.js` (~161 active products in header comment; full array exported as `products`).
- **Generation:** Optional offline script `scripts/build-products.mjs` reads `diwali_product_master_final.csv` and writes `products.js` (not run at build time by default—file is committed).
- **Fields (representative):** `id`, `name`, `category`, `pack`, **`price`**, `description`, `featured`, `stockStatus`, `active`, `images[]`, and **`x4`** (present on many rows; **not referenced by any `src/` component**—only stored in the data file and bundled).

### How the frontend receives data

- **Static ES module import** at build time—no runtime API.
- Importers include: `CatalogueView.jsx`, `PopularProducts.jsx`, `ComboSection.jsx`, `CatalogueSection.jsx`, `estimateHelpers.js`, `categoryCounts.js`, etc.
- **Entire `products` array** is included in the client bundle (verified by architecture: single shared module, no code-splitting by sensitivity).

### Filtering / visibility

- `src/utils/filterProducts.js` (used by catalogue) filters by search, category slug, budget range, and **`active !== false`**.
- Sold-out handling: `stockStatus` via `isProductSoldOut()` in estimate helpers.

### Price exposure today

- **Product cards** (`ProductCard.jsx`): display `formatINR(product.price)`.
- **Estimate UI** (`EstimateItem.jsx`, summary panels, sticky bar): unit price, line math, subtotal.
- **WhatsApp message** (`buildWhatsAppEstimateMessage`): `{quantity} × {name} — {lineTotal}` and `Estimated Total: {subtotal}`.

This **conflicts with the agreed target** (public customers do not see prices) but matches **current production behavior**. Phase 0 does not change it.

---

## 4. Estimate/cart state and customer WhatsApp flow

### Estimate state

| Item | Implementation |
|------|----------------|
| Context | `src/context/EstimateContext.jsx` |
| Shape | `[{ productId: string, quantity: number }]` |
| Persistence | `localStorage` key `crackers_estimate` (`estimateHelpers.js`) |
| Max quantity | 99 per product (`ESTIMATE_MAX_QUANTITY`) |
| Pricing math | `lineTotal = product.price * quantity` in `getEstimateProducts()` |
| Product lookup | In-memory `Map` from static `products` |

Customer details (name, mobile, area, pickup date, note) use `CustomerDetailsContext` + `localStorage` key `crackers_customer_details`, with validation in `customerDetailsHelpers.js` (10-digit mobile, optional stall date from `siteConfig.stallDates`).

### WhatsApp message generation (exact flow)

1. User adds items on catalogue cards / detail sheet → `addToEstimate(product.id)`.
2. User opens `/estimate` → steps: **estimate → details → review**.
3. On review, if customer details valid, `getWhatsAppEstimateUrl(estimateItems, details)` builds URL.
4. **`buildWhatsAppEstimateMessage`** (`src/utils/whatsapp.js`):
   - Header: `DIWALI CRACKERS ESTIMATE REQUEST`
   - Optional customer block (name, mobile, area, pickup, note)
   - Section `Selected Products` with numbered lines:  
     `{n}. {qty} × {product.name} — {formatINR(lineTotal)}`
   - `Estimated Total: {formatINR(subtotal)}`
   - Footer: `Please confirm availability and final price.`
5. URL: `https://wa.me/{91+10-digit}?text={encodeURIComponent(message)}` via `getWhatsAppWaMeDigits()` from `siteConfig.whatsappNumber`.
6. User taps **Send request on WhatsApp** → opens WhatsApp with pre-filled text (no server webhook, no message logging in app).

Generic enquiry uses constant `WHATSAPP_ENQUIRY_MESSAGE` on Home/Hero/Footer links.

### Target workflow gap (for planning)

| Agreed target | Current state |
|---------------|---------------|
| Public: no prices | Prices shown on cards and estimate |
| Customer WA: names/IDs + qty only | WA includes INR line totals and total |
| Owner: private price list + quotation tool | No admin UI; public `price`/`x4` in bundle |

---

## 5. Can `/admin/quotation` be added on existing infrastructure?

### Adding the route only (React Router)

**Technically yes**—a new `Route path="admin/quotation"` could render an admin page in the same SPA.

**Secure for owner rates: no.** Reasons:

1. **Same bundle / same origin** — Unless admin is a separate build/deploy, Vite may still expose admin JS chunks to anyone who guesses chunk URLs.
2. **Any secret or rate table imported in client code** is recoverable from `dist/assets/*.js`.
3. **No auth layer** exists to restrict HTML/JS/assets at the edge.
4. **Obscurity** (omitting nav links) does not protect `/admin/quotation`.

### What “existing infrastructure” can support safely

| Approach | Fits current repo? | Protects owner rates? |
|----------|-------------------|------------------------|
| Static SPA + hidden route | Yes | **No** |
| Static SPA + edge basic auth (Cloudflare Access, Netlify password) on `/admin/*` | Yes (host config) | **Partial** — protects UI entry, not if rates are still in JS |
| Static public site + **separate admin deploy** + API | Yes (monorepo or second app) | **Yes**, if rates only on server |
| Public site unchanged + **local-only** admin (desktop script) | Yes | **Yes**, but not `/admin/quotation` on public URL |

**Verdict:** A **private quotation page on the public domain** is feasible as UX, but **rate privacy and real authorization require new server-side components**. Existing static hosting remains valid for the **public** site; admin should either use **edge-protected + API-backed** patterns or a **separate origin**.

---

## 6. Smallest secure addition (compatible with current project)

Recommended **minimal** stack extension (aligns with lightweight Vite/React project, avoids heavy rewrite):

1. **Authenticated API** (pick one):
   - **Cloudflare Workers + D1** (SQLite, good for small catalogue + quotations), or
   - **Supabase** (Postgres + Auth + RLS), or
   - **Single small Node service** (e.g. Hono/Fastify) on a low-cost host if team prefers familiar SQL files.

2. **Storage:**
   - Owner rate table (see §7)—**never** synced into `products.js` automatically from `price`/`x4`.
   - Quotation headers + line snapshots for audit/resend.

3. **Admin UI:**
   - Either **second Vite entry** (`admin.html` / separate `vite build` target) **or** lazy route **that only calls API** and never imports a rates module.
   - Deploy admin behind **edge access control** (e.g. Cloudflare Access, HTTP basic at CDN) **in addition to** app login.

4. **Public site (later phase):**
   - Split catalogue into **public product metadata** (id, name, category, images, active) vs **server-only rates**, **or** strip price from bundle and accept owner-only rate fetch is unnecessary on public pages if customers must not see prices at all.

**Smallest insecure shortcut (explicitly not recommended):** Excel/CSV rates on owner’s device + bookmarked admin page with rates pasted into `sessionStorage` — fails backup, multi-device, and audit requirements.

---

## 7. Recommended schema (private rates + quotations)

Use **product `id`** (e.g. `P001`) as the stable join key to the public catalogue. Do **not** treat `products.js` `price` or `x4` as owner rates.

### `owner_product_rates` (current effective rate list)

| Column | Type | Notes |
|--------|------|--------|
| `product_id` | TEXT PK (or FK) | Matches catalogue `id` |
| `unit_rate_paise` | INTEGER | Store money as integer (INR × 100) |
| `effective_from` | TIMESTAMPTZ | Optional versioning |
| `effective_to` | TIMESTAMPTZ NULL | NULL = current |
| `source` | TEXT | e.g. `manual`, `import-2026-10` |
| `updated_at` | TIMESTAMPTZ | |
| `updated_by` | TEXT | Owner identifier |

Optional: `owner_rate_history` with same fields + `rate_id` for audit trail instead of in-place overwrites.

### `quotations` (header)

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID | |
| `created_at` | TIMESTAMPTZ | |
| `status` | ENUM/TEXT | `draft`, `sent`, `accepted`, `void` |
| `customer_name` | TEXT NULL | |
| `customer_phone` | TEXT NULL | Normalized 10-digit |
| `customer_note` | TEXT NULL | |
| `currency` | TEXT | Default `INR` |
| `subtotal_paise` | INTEGER | Sum of lines at snapshot |
| `adjustment_paise` | INTEGER | Optional discount/round-off |
| `total_paise` | INTEGER | |
| `wa_message_text` | TEXT | **Snapshot** of message sent/planned |
| `created_by` | TEXT | Owner session identity |

### `quotation_line_items`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID | |
| `quotation_id` | UUID FK | |
| `line_number` | INTEGER | Display order |
| `product_id` | TEXT | Catalogue id at time of quote |
| `product_name` | TEXT | **Snapshot** (names can change) |
| `quantity` | INTEGER | 1–99 (match public cap) |
| `unit_rate_paise` | INTEGER | **Snapshot** from owner list at quote time |
| `line_total_paise` | INTEGER | `quantity * unit_rate_paise` |

**Indexes:** `owner_product_rates(product_id)`, `quotations(created_at DESC)`, `quotation_line_items(quotation_id)`.

---

## 8. Security requirements

### Authentication

- **Owner-only** access to admin UI and all rate/quotation APIs.
- Prefer **short-lived session** (HTTP-only secure cookie) or **Supabase Auth** / similar—not a shared password in client code.
- **Multi-factor** or **identity provider** (Google workspace) if available on chosen host.

### API authorization

- Every `/api/admin/*` (or equivalent) request: validate session server-side.
- **Deny by default**; no public read of rates.
- Separate **public** endpoints (if any) must expose **zero** pricing fields.

### Rate privacy

- Owner rates live **only** in database / server env—not in `products.js`, not in public `dist/`.
- Verify with build audit: grep `dist/assets/*.js` for rate literals after public build.
- Do not log full rate tables in client analytics.

### Input validation

- **Server-side:** product ids must exist in catalogue manifest (server-held copy or synced id list); quantity bounds; string length limits (reuse customer detail max lengths as reference).
- **Quotation create:** recompute line totals server-side from stored rates—never trust client-submitted totals.
- **WhatsApp message:** sanitize newlines/length; cap message size for WA URL limits (~2000 chars practical).

### Quotation snapshots

- Persist **unit rate, name, quantity, line total** at creation time so later catalogue or rate changes do not rewrite history.
- Store **`wa_message_text`** when owner sends/previews final quote.

### Transport and headers

- HTTPS only; `Secure` cookies; CSP on admin deploy as feasible.

---

## 9. Backup, migration, and rollback

### Current project practices (observed)

- Multiple backups under `reports/` (`products.js.backup.*`, baselines JSON).
- Reconciliation reports (`x4_*`, image audit CSVs).
- Git tracks source; large binary images in `public/`.

### Recommended for quotation workflow

| Asset | Backup approach |
|-------|-----------------|
| **Owner rates** | DB automated backups (host-native); periodic CSV export to encrypted store |
| **Quotations** | Same DB backups; optional daily export |
| **Public catalogue** | Continue git + tagged releases; keep CSV master as source |
| **Secrets** | Host secret manager only; never commit |

### Migration

1. Import owner rate sheet → `owner_product_rates` with validation against catalogue ids (report unmatched ids).
2. **Do not** auto-map from `price` or `x4` without explicit owner sign-off (per project constraint).
3. Version catalogue separately; quotation lines snapshot names/rates.

### Rollback

- **Public site:** redeploy previous `dist` or git tag (no DB dependency today).
- **After API introduced:** backward-compatible API versioning; restore DB snapshot; feature flags for “priceless public UI” vs legacy.

---

## 10. Phased implementation and test plan

### Proposed phases

| Phase | Focus | Touches public site? |
|-------|--------|----------------------|
| **0** | Architecture audit (this document) | No |
| **1** | Backend skeleton + auth + rate CRUD API | No UI change |
| **2** | Admin `/admin/quotation` UI (rates + line builder + totals + WA preview) | Admin deploy only |
| **3** | Quotation persistence + snapshots + history list | Admin |
| **4** | Public “no price” UX + customer WA format (ids/names, qty only) | **Yes** — coordinated release |
| **5** | Optional: parse inbound customer WA templates / clipboard assist for owner | Admin |

Keep **public price removal** and **admin quotation** separable in development, but **release** so customers never see public prices while owner rates leak via old bundles (force cache-bust / single deploy window).

### Security tests

- [ ] Unauthenticated API returns 401/403 for all admin endpoints.
- [ ] Public `dist` bundle contains no owner rate values (automated grep on CI).
- [ ] Direct navigation to `/admin/quotation` without session shows login—not tool UI.
- [ ] Session fixation / logout clears access.
- [ ] IDOR: cannot read another owner’s quotations (if multi-tenant ever added).

### Regression tests (public site)

- [ ] Catalogue browse/search/filter/pagination unchanged (except price visibility when Phase 4 lands).
- [ ] Estimate add/remove/qty caps/localStorage persistence.
- [ ] Customer WA link encodes expected message (golden string tests in `whatsapp.js`).
- [ ] `npm run build` and smoke test on `/crackers`, `/estimate`.
- [ ] Mobile 360/390 layouts (existing UI audit patterns).

### Functional tests (admin)

- [ ] Rate import for sample products; missing id handling.
- [ ] Quotation total matches sum of server-computed lines.
- [ ] Snapshot immutability when catalogue name/rate changes later.
- [ ] WA message copy matches preview.

---

## Safest implementation path (recommendation)

1. **Keep the public Diwali site static** (current Vite build) for catalogue, images, and estimate UX.
2. **Introduce a minimal authenticated backend** with DB tables in §7; seed rates from an **owner-approved CSV**, not from `products.js` `price`/`x4`.
3. **Ship admin as API-backed UI** on a **protected path or subdomain**, with CDN/edge access control plus server session.
4. **Split public catalogue data** in a later phase so the customer bundle excludes `price` (and remove `x4` from public export entirely—it is already unused in UI but still shipped).
5. **Change WhatsApp customer message** in the same release as price hiding—product id + name + quantity only.
6. **Owner quotation tool** computes totals from private rates and generates a **separate** WhatsApp message to the customer (or copy buffer)—distinct from the customer-initiated request template.

This path preserves today’s hosting model for the mass-traffic public site while meeting rate confidentiality and audit needs.

---

## Decisions requiring confirmation

1. **Hosting choice** for API + DB (Cloudflare Workers+D1 vs Supabase vs small VPS)—affects auth and cost.
2. **Admin URL model:** same origin (`/admin/*`) vs subdomain (`admin.example.com`) vs separate deploy.
3. **Owner authentication method:** password, magic link, or Google/Microsoft SSO.
4. **Rate maintenance UX:** spreadsheet import only, inline grid edit, or both.
5. **Quotation retention:** long-term DB history vs ephemeral drafts only.
6. **Customer WhatsApp format:** include `product_id` (e.g. `P001`) always, or name-only with id on ambiguity.
7. **Relationship between customer request and owner quote:** reply manually vs store `quotation_id` linking inbound WA text.
8. **Timeline for removing public prices** relative to admin readiness (big-bang vs staged).
9. **Whether `x4` remains in repo at all** for public builds (recommend moving to owner-only import source, not customer bundle).
10. **Single owner vs future staff accounts** (impacts auth schema now).

---

## Appendix: key file reference

| Concern | Path |
|---------|------|
| Routes | `src/App.jsx` |
| Products data | `src/data/products.js`, `scripts/build-products.mjs` |
| Estimate state | `src/context/EstimateContext.jsx`, `src/utils/estimateHelpers.js` |
| Customer details | `src/context/CustomerDetailsContext.jsx`, `src/utils/customerDetailsHelpers.js` |
| WhatsApp | `src/utils/whatsapp.js`, `src/data/siteConfig.js` |
| Estimate page flow | `src/pages/Estimate.jsx` |
| Original “no backend” plan | `DIWALI_CRACKERS_WEBSITE_PLAN.md` |

---

*End of Phase 0 audit.*
