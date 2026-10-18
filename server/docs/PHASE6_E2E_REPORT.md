# Phase 6 — Local end-to-end verification report

**Date:** 2026-10-15 (local)  
**Scope:** Local D1 + `wrangler dev` on loopback only. No deploy, no remote D1.

## Commands executed

| Command | Result |
|---------|--------|
| `cd server && npm run test:unit` | **160** tests, **0** fail |
| `cd server && npm run test:integration` | **20** tests, **0** fail |
| `cd .. && npm run build` | **Success** (Vite production build) |
| `cd server && node scripts/phase6-local-e2e-verify.mjs` | **17/17** checks passed |
| `node scripts/verify-purchase-rates-apply.mjs` | (prior) purchase **70**, X4 **138** |

Worker base URL for live HTTP checks: `http://127.0.0.1:8789` (from running `npm run dev`).

## D1 pricing baseline (read-only counts)

- Current purchase rates (`product_purchase_rates`, `effective_to IS NULL`): **70**
- Current X4 selling rates (`private_rates`, `effective_to IS NULL`): **138**
- Duplicate current purchase rows: **0**

## Automated coverage by area

| Area | How verified |
|------|----------------|
| Purchase vs X4 independence | Unit: `adminProductRateEdit.test.js`, `adminPhase52.test.js`; Live: no-op PUT purchase / PUT X4 on P001 |
| Customer request submit + idempotency | Unit: `publicCustomerRequests.test.js`; Live: Phase 6 script |
| Admin queue, detail, status | Unit: `adminCustomerRequests.test.js`; Live: list, detail (`request.items`), PATCH → `quoted` |
| Quotation create / retry / regenerate | Unit: `adminPhase5.test.js`, `adminPhase52.test.js`; Live: create, idempotent POST, regenerate |
| Integer paise totals | Unit: `money.test.js`, quotation tests; Live: `lineTotal === qty × unit` |
| Single active quotation | Integration: partial unique index; Live: retry returns same quotation id |
| WhatsApp preview | Live: GET `/api/admin/quotations/:id/whatsapp` — snapshot message length + quotation id (no PII in logs) |
| Public API privacy | Unit: `publicProductsSeparation.test.js`; Live: JSON key scan; build: no `private_rates` / `"x4":` in `dist/assets` |
| Admin auth | Unit: `adminRoutesAuth.test.js`, `adminLocalDevAuth.test.js`; Live: 401 without JWT, session OK with local JWT |
| Atomic D1 batches | Integration: `d1WranglerTxAtomic.test.js` |

## Files added/changed for Phase 6

- `server/scripts/phase6-local-e2e-verify.mjs` — loopback HTTP + D1 count checks (no secrets in output)
- `server/reports/phase6-local-e2e-verify.json` — machine-readable check log
- `server/docs/PHASE6_E2E_REPORT.md` — this document

No application feature code or schema changes were required for Phase 6.

## Failures fixed during Phase 6

- E2E script initially probed `/api/health`; worker exposes **`GET /health`**. Fixed in script.
- Admin request detail wraps payload as `{ request: { items: [...] } }`. Script updated accordingly.

## Remaining risks / manual browser checks

1. **Browser UI** — Confirm admin edit form labels, missing-rate filters, and save flow with `Cf-Access-Jwt-Assertion` (or Vite proxy to Worker). Not run headless in this phase.
2. **Phase 6 fixture data** — Script creates one `cr-*` request (mobile `9000000001`), quotation, and sets status `quoted`. Safe to leave or mark `closed` later; not bulk-deleted.
3. **68 review mappings** — Still no purchase/X4 bulk import; manual entry only via admin edit.
4. **Public catalogue** — Still static `src/data/products.js`; D1 edits do not change storefront prices.
5. **Production auth** — Cloudflare Access + `admin_users` not exercised locally beyond fail-closed tests.

## Local manual test checklist

1. Terminal A: `cd server && npm run dev` (note port, e.g. 8789).
2. Terminal B: `cd server && npm run admin:local-jwt` → set header in browser devtools or REST client (**do not commit JWT**).
3. Vite: `npm run dev` at repo root; open `/admin/products`.
4. Search `P010` (review mapping); edit purchase and/or X4; save one field at a time.
5. Public site: confirm list prices unchanged after D1 rate edits.
6. Submit a test customer request from the catalogue UI; process in admin queue.

## Out of scope (confirmed not done)

- Deploy to Vercel / Cloudflare
- Remote D1 or `--remote` migrations
- Bulk import of 68 review products
- Changes to public catalogue prices
