# Pricing storage model (Phase 5.2)

## Business columns (Excel bills)

| Excel column | Meaning | D1 storage |
|--------------|---------|------------|
| **Rate** (col 6) | Supplier purchase/cost per unit | `product_purchase_rates.unit_rate_paise` (current row: `effective_to IS NULL`) |
| **X4** (col 7) | Intended public selling price per unit | `private_rates.unit_rate_paise` (historical name; **not** purchase cost) |

## What is not source of truth (yet)

- **`src/data/products.js` `price`** — public catalogue display only; not updated by admin D1 edits.
- **`products.selling_price_paise`** — optional nullable column; unused for quotations; may be used in a future sync strategy.

## Quotations

Customer line unit rates are read **only** from current `private_rates` (X4 selling). Purchase rates never affect quotation totals.

## Admin reference

`server/reports/phase51-rate-x4-reconciliation.json` supplies mapping status metadata (admin-only API fields). It does not auto-write rates to D1.

## History

Both rate tables close the previous current row (`effective_to`) and insert a new row on admin update.

## Phase 5.3 purchase backfill (admin-only)

- Source: Excel column **6 (Rate)** at coordinates from verified phase52 mappings only.
- Dry-run: `npm run purchase:rates:dry-run` → `server/reports/purchase-rates-dry-run.json`
- Apply (local D1, explicit flag): `npm run purchase:rates:import:apply` after reviewing the dry-run.
- Does not touch `private_rates`, public catalogue JS, or `products.selling_price_paise`.
