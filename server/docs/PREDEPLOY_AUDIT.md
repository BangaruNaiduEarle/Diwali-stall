# Diwali Stall — Phase 6 pre-deployment audit

**Date:** 2026-10-16 (local only)  
**Scope:** End-to-end review of customer journey, public/admin APIs, pricing separation, Cloudinary, security, tests, and deployment readiness. **No deploy, no remote D1, no production writes.**

Legend: **Verified** = code inspection and/or automated run in this session. **Not verified** = requires manual browser or production config not exercised here.

---

## Executive summary

| Area | Status |
|------|--------|
| Backend customer requests + idempotency | **Verified** (unit tests + Phase 6 live script) |
| Admin queue, quotations, WhatsApp preview | **Verified** (unit tests + Phase 6 live script) |
| Pricing separation (purchase vs X4 vs public catalogue) | **Verified** (code + tests + build scan) |
| Storefront estimate → D1 persistence | **Gap — not implemented in UI** |
| Vercel SPA fallback | **Missing `vercel.json`** |
| Cross-origin API (Vercel + Worker split) | **CORS not implemented** |
| Public catalogue data source | **Static `src/data/products.js`** (not live public API) |

**Primary deployment blocker:** The My Estimate review action opens WhatsApp only; it does **not** call `POST /api/public/customer-requests`, so real customers will not appear in the admin queue unless requests are created another way (API/script).

---

## A. Customer journey (as implemented)

| Step | Expected flow | Actual result |
|------|----------------|---------------|
| 1. Homepage + catalogue | Browse `/`, `/crackers` | **Verified:** `CatalogueView.jsx` loads static `products` from `src/data/products.js`. No `GET /api/public/products` usage under `src/`. |
| 2. Category + product selection | Add qty from category/detail | **Verified:** `EstimateContext` persists `{ productId, quantity }` in local storage via `estimateHelpers`. |
| 3–4. Family packs | Pack contents merged into estimate | **Verified:** `PackDetail.jsx` → `applyPackToEstimate` in `crackerPacks.js` sets quantities per pack line (individual product IDs). |
| 5. Estimate page | `/estimate` multi-step UI | **Verified:** Steps `estimate` → `details` → `review`; customer fields via `CustomerDetailsContext`. |
| 6. Customer fields | name, mobile, area, pickup, note | **Verified:** `CustomerDetailsForm` + `validateCustomerDetails` (frontend). Backend mirrors rules in `customerRequestValidation.js`. |
| 7. “Final Estimate” / send | User expectation: submit + notify | **Verified:** UI label is **“Send estimate on WhatsApp”** (`Estimate.jsx`), not “Final Estimate”. |
| 8. Button behavior | API + WhatsApp + state | **Verified:** **WhatsApp only.** `getWhatsAppEstimateUrl` → `wa.me` (`utils/whatsapp.js`). No `fetch` to public API anywhere in `src/`. No loading/success/failure for backend. |
| 9. D1 row on success | Request in local D1 | **Not satisfied from UI.** **Verified** via `POST /api/public/customer-requests` in `publicCustomerRequests.test.js` and `phase6-local-e2e-verify.mjs` only. |
| 10–11. Admin queue + detail | Same request visible | **Verified for API-created requests** (Phase 6 script, admin unit tests). **Not reachable from storefront send button today.** |
| 12. Quotation + WhatsApp preview | Admin workflow | **Verified** (Phase 6: create quotation, GET WhatsApp message; admin UI in `AdminCustomerRequestDetailPage.jsx`). |

### WhatsApp message content (storefront)

**Verified:** `buildWhatsAppEstimateMessage` lists product names and quantities plus customer details; **no prices** in the message (aligns with review-step copy).

### Estimate persistence after refresh

**Verified:** Estimate and customer details remain in **browser local storage**; sending WhatsApp does not clear the estimate (no post-send hook).

---

## B. Customer request API behavior

**Endpoint:** `POST /api/public/customer-requests` (`server/src/routes/publicCustomerRequests.js`)

| Check | Result |
|-------|--------|
| Required fields + mobile (10 digits) + qty 1–99 | **Verified** — `validateCustomerRequestBody` |
| Rejects client price fields | **Verified** — `FORBIDDEN_BODY_KEYS` / `FORBIDDEN_ITEM_KEYS` in `customerRequestValidation.js`; server resolves product names from D1 |
| Idempotency-Key | **Verified** — SHA-256 → `cr-{hex}`; replay returns `200` + `idempotentReplay: true` |
| Duplicate on double-submit (UI) | **N/A for current UI** (no API call). Backend idempotency works when header is sent. |
| Loading / success / failure UX | **Not implemented** on Estimate page |
| False success if API fails | **N/A** (no API). WhatsApp link succeeds even if backend were down. |
| Payload from Estimate form | **Not wired** — would need mapping: `customer.{name,mobile,area,pickupPreference,note}`, `items[].{productId,quantity}` |

**Local dev networking:** Vite proxies **only** `/api/admin` (`vite.config.js`). Public POST must hit Worker directly (e.g. `http://127.0.0.1:8789`) or gain a proxy / `VITE_*` base URL if integrated later.

---

## C. Admin workflow

| Check | Result |
|-------|--------|
| List, filters, pagination, detail, status PATCH | **Verified** — `adminCustomerRequests.test.js`; UI `AdminCustomerRequestsPage.jsx`, `AdminCustomerRequestDetailPage.jsx` |
| Local admin auth | **Verified** — Vite injects `Cf-Access-Jwt-Assertion` from `ADMIN_LOCAL_DEV_JWT`; Worker `requireAdmin` on all `/api/admin/*` |
| Unauthenticated admin | **Verified** — `adminRoutesAuth.test.js`, Phase 6 live 401 |
| Purchase vs X4 edit independence | **Verified** — `adminProductRateEdit.test.js`, `adminPhase52.test.js` |
| Quotation create / regenerate | **Verified** — `adminPhase5.test.js`, Phase 6 live |
| Missing X4 rates | **Verified** — quotation creation fails with validation error listing `missingRates` (`adminQuotations.js`); lines without rate are not silently priced |
| One active quotation per request | **Verified** — migration `0006_quotations_one_active_per_request.sql`, integration + Phase 6 retry |
| WhatsApp preview | **Verified** — uses saved `wa_message_text` snapshot; admin `fetchQuotationWhatsApp` |
| Status transitions | **Verified** — `validateCustomerRequestStatusTransition` in admin service/tests |

**Not verified in browser:** Full admin UI click-through (labels, filters, image upload). See manual checklist below.

---

## D. Pricing rules (preservation audit)

| Rule | Result |
|------|--------|
| Excel Rate → `product_purchase_rates` | **Verified** — docs + admin purchase-rate routes/services |
| Excel X4 → `private_rates` | **Verified** — `GET_X4_SELLING_RATE_SQL` in quotations |
| Never X4 = Rate × 4 | **Verified** — no such calculation in `server/` (grep) |
| Public storefront prices | **Verified** — `src/data/products.js` only; catalogue UI does not read D1 selling fields |
| 68 review products not bulk-imported | **Verified** — no apply script run in this audit |
| Public API excludes private rates | **Verified** — `publicProducts.js` SQL audited; `publicProductsSeparation.test.js` |
| `GET /api/public/products` does not query `private_rates` | **Verified** — service SQL |
| Vite bundle leak scan | **Verified** — `dist/assets`: no matches for `private_rates`, `"x4"`, `unit_rate_paise`, `CLOUDINARY_API_SECRET` |

**Note:** Listed **public** prices still exist inside `products.js` in the frontend bundle (by design). They are **not** the same as private X4 quotation rates.

---

## E. Cloudinary audit

### Where URLs come from

| Surface | Source | Verified |
|---------|--------|----------|
| Storefront products | `/images/...` paths in `src/data/products.js` | Yes |
| Family pack hero images | `familyPackImages.js` → `/images/family-packs/*` | Yes |
| D1 `products.images_json` | Populated from import/migration; public API returns `images` array | Yes (service) |
| Admin product images | Signed upload via `POST /api/admin/uploads/sign` + browser upload to Cloudinary API | Yes (admin-only code under `src/admin/lib/cloudinaryUpload.js`) |

Migration artefact `server/data/generated/cloudinary-upload-mapping.json` maps local catalogue paths → `https://res.cloudinary.com/.../diwali/products/...` URLs. **Storefront data file was not bulk-replaced** with those URLs in this audit.

### Rendering / fallback

**Verified:** `ProductImageCarousel.jsx` — explicit URLs, ID-based fallback slots (`productImage.js`), “Photo coming soon” on error/empty; supports HTTPS Cloudinary URLs if present in product data.

### Issues (from Phase 3C review, not re-run on disk)

From `server/reports/cloudinary-migration-review.md` (2026-10-14):

- **3 missing local files** for catalogue paths (e.g. `COLOUR_KOTI_DLX.webp`, `GANGA_JAMUNA_AJN.webp`, `GC_SPECIAL_AJN.webp`).
- **49 products** with empty `images[]`.
- **1 shared path** across two products (intentional dedupe for Cloudinary upload).

**Not verified this session:** Re-audit every file on disk under `public/images/products/`.

### Secrets exposure

| Location | Finding |
|----------|---------|
| `server/.dev.vars` / Worker env | API secret server-side only — **do not commit** |
| Frontend / `dist` | **Verified:** no `CLOUDINARY_API_SECRET`; no `cloudinary.com` string in production `dist` grep (admin upload is code-split; Cloudinary host may appear only when admin chunk loads — acceptable) |
| Sign endpoint response | **Verified by design** — tests/docs: response includes signature + cloud name + api key, **not** secret |

Upload feature exists **for admin catalogue management only**, not for customers.

---

## F. Security and deployment readiness

| Topic | Finding |
|-------|---------|
| Admin API protection | **Verified** — all `/api/admin/*` gated by `requireAdmin` before handlers (`index.js`) |
| Public pricing leak via API | **Verified** — public product + customer-request paths do not read rate tables |
| CORS | **Verified gap** — `requestContext.js` is a no-op; **no CORS headers**. Same-origin or Access-protected single host is assumed. Split Vercel + Workers needs explicit CORS or reverse proxy. |
| `VITE_API_BASE_URL` | Admin client uses it (`admin/api/client.js`); empty → relative `/api/admin` (works with Vite proxy locally, not on Vercel alone) |
| Error/log PII | **Spot-check:** Phase 6 script avoids logging phone numbers; review production logging separately |
| SPA deep links | React Router routes exist for `/estimate`, `/crackers/:slug`, `/admin/*` (`App.jsx`, `AdminRoutes.jsx`) |
| Vercel SPA fallback | **Verified missing** — no `vercel.json` in repo; direct refresh on deep routes will 404 on static host unless configured in Vercel dashboard or added file |

**Health check:** Worker exposes `GET /health` (not under `/api`).

---

## G. Tests and commands

### Commands run (2026-10-16)

| Command | Result |
|---------|--------|
| `cd server && npm run test:unit` | **160** tests, **0** fail |
| `cd server && npm run test:integration` | **20** tests, **0** fail |
| `cd .. && npm run build` | **Success** (~1.8s) |
| `node --test tests/imageValidation.test.js tests/cloudinarySign.test.js tests/cloudinaryMigrationPathSafety.test.js` | **19** pass, **0** fail |
| `PHASE6_BASE_URL=http://127.0.0.1:8789 node scripts/phase6-local-e2e-verify.mjs` | **17/17** passed (Worker dev on 8789) |

Prior Phase 6 report: `server/docs/PHASE6_E2E_REPORT.md`, `server/reports/phase6-local-e2e-verify.json`.

### Files inspected (representative)

**Storefront:** `src/pages/Estimate.jsx`, `src/utils/whatsapp.js`, `src/context/EstimateContext.jsx`, `src/components/CatalogueView.jsx`, `src/App.jsx`, `vite.config.js`, `src/data/products.js`, `src/utils/productImage.js`, `src/components/ProductImageCarousel.jsx`, pack utilities/pages.

**Backend:** `server/src/index.js`, `server/src/routes/publicCustomerRequests.js`, `server/src/routes/publicProducts.js`, `server/src/services/publicCustomerRequests.js`, `server/src/services/publicProducts.js`, `server/src/services/adminQuotations.js`, `server/src/lib/customerRequestValidation.js`, `server/src/middleware/requestContext.js`, `server/src/middleware/requireAdmin.js`.

**Admin UI:** `src/admin/api/client.js`, `src/admin/api/adminApi.js`, customer-request pages.

**Reports:** `server/reports/cloudinary-migration-review.md`, `server/data/generated/cloudinary-upload-mapping.json`.

**Files changed for this audit:** `server/docs/PREDEPLOY_AUDIT.md` (this document only).

---

## Confirmed defects and minimal fixes

| ID | Severity | Issue | Minimal fix (not applied in audit) |
|----|----------|-------|-------------------------------------|
| D1 | **Blocker** | Estimate send does not POST customer request | On review step: `POST /api/public/customer-requests` with `Idempotency-Key` (e.g. hash of cart + mobile + day), then open WhatsApp; show loading/error; optional clear-on-success |
| D2 | **Blocker** | No Vercel SPA rewrites in repo | Add `vercel.json` `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }` or equivalent dashboard config |
| D3 | **Blocker** (if split host) | No CORS on Worker | Add explicit CORS for approved origins on public + admin preflight, or serve SPA and API on one domain |
| D4 | **High** (local DX) | No Vite proxy for `/api/public` | Proxy or `VITE_PUBLIC_API_BASE_URL` when wiring D1 |
| D5 | **Medium** | 3 missing product image files per migration review | Add/rename files or approved `products.js` path updates |
| D6 | **Low** | Phase 6 manual checklist item “submit from catalogue UI” | Impossible until D1 fixed; use API/script for admin QA |

No unrelated refactors recommended.

---

## Manual browser checks still required

1. Storefront: full journey homepage → category → estimate → WhatsApp opens with correct text (no backend row).
2. After D1 fix: same journey + Network tab shows 201/200 on customer-requests + admin queue entry.
3. Admin: `/admin/customer-requests` and `/admin/products/:id/edit` with local JWT / proxy; purchase vs X4 save.
4. Deep-link refresh on Vercel **staging** once `vercel.json` or dashboard rewrites exist.
5. Spot-check broken images for P010, P124, P006/P063 paths from migration review.
6. Cloudflare Access + production JWT path (not local dev header only).

---

## Remaining deployment blockers

1. **Storefront not persisting customer requests** (D1).  
2. **Vercel SPA fallback** not in repository (D2).  
3. **API URL + CORS strategy** for production topology (D3–D4).  
4. **Operational:** Cloudflare Worker env vars, D1 migrations on deploy environment, Access allowlist, Cloudinary credentials on Worker only.  
5. **Content:** Missing local images and empty image arrays (D5) — UX, not API security.

---

## Assumptions / not completed

- Did not run headless browser automation for this audit.  
- Did not re-run Cloudinary migration audit/upload scripts against disk.  
- Did not inspect remote D1 or production Cloudflare/Vercel settings.  
- Did not modify `src/data/products.js` prices or import review-rate mappings.

For automated backend confidence, use: `cd server && npm run phase6:verify:local` with `npm run dev` running and `PHASE6_BASE_URL` set to the printed port.
