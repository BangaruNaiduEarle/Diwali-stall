# Phase 2B — Catalogue import schema review

## Source: `src/data/products.js`

| Source field | D1 column | Notes |
|--------------|-----------|--------|
| `id` | `products.id` | Preserved exactly |
| `category` (label) | `products.category_slug` | Mapped via `src/data/categories.js` |
| `name` | `products.name` | |
| `pack` | `products.pack` | |
| `description` | `products.description` | |
| `featured` | `products.featured` | 0/1 |
| `stockStatus` | `products.stock_status` | |
| `active` | `products.active` | Archive = `active = 0` |
| Array index | `products.sort_order` | Preserves catalogue order |
| `images[]` | `products.images_json` | Paths unchanged; legacy single `image` merged if ever present |
| `company` | `products.company` | **Not in current source**; column added in `0003` for future rows |
| `price` | — | **Not imported** (stays in frontend bundle only) |
| `x4` | — | **Not imported** |

## Migration applied

- `0003_products_company.sql` — nullable `company TEXT` only (non-destructive).

## Import pipeline

1. `npm run catalogue:generate` — reads frontend module, writes reviewable `data/catalogue-import.json` + `reports/catalogue-import-report.json`.
2. `npm run catalogue:import:local` — idempotent UPSERT into local D1 via generated SQL.

Warnings (empty images, unknown categories, duplicate IDs) are reported in the JSON report, not silently fixed.
