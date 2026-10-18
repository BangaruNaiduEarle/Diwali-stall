# Phase 6.3 — Cloudinary re-audit & browser QA report

**Date:** 2026-10-16 (local only)  
**No deploy, no remote D1, no catalogue price or rate imports, no Cloudinary URL bulk-replace.**

---

## 1. Automated checks

| Check | Command / tool | Result |
|-------|----------------|--------|
| Cloudinary catalogue vs disk | `cd server && node scripts/cloudinary-migration-review.mjs` | **Regenerated** `server/reports/cloudinary-migration-review.{json,md}` (2026-10-16) |
| Family pack data integrity | `npm run packs:verify` | **Pass** |
| Family pack image files | `node scripts/verify-family-pack-images.mjs` | **7/7 paths exist** on disk |
| Image validation | `node --test tests/imageValidation.test.js` | **Pass** (part of 19-test bundle) |
| Cloudinary sign | `tests/cloudinarySign.test.js` | **Pass** |
| Migration path safety | `tests/cloudinaryMigrationPathSafety.test.js` | **Pass** |
| Image / Cloudinary bundle | 3 files above | **19 pass, 0 fail** |
| Unit tests | `cd server && npm run test:unit` | **178 pass, 0 fail** |
| Integration tests | `cd server && npm run test:integration` | **20 pass, 0 fail** |
| Production build | `npm run build` | **Success** |
| Public bundle secrets / private rates | `grep` on `dist/` | **No** `CLOUDINARY_API_SECRET`, `private_rates`, or private rate field names |
| Phase 6 HTTP workflow | `PHASE6_BASE_URL=http://127.0.0.1:8787 node scripts/phase6-local-e2e-verify.mjs` | **15/17 pass** — see note below |

### Phase 6 E2E note (local D1 drift)

Two checks failed on **hard-coded row counts** only:

- `d1_purchase_rate_count_70` — local DB has **71** current purchase rates (expected 70).
- `d1_x4_current_count_138` — local DB has **139** current X4 rates (expected 138).

All **HTTP workflow checks passed**, including: public customer request create + idempotent replay, admin queue/detail, quotation create/retry/regenerate, WhatsApp preview endpoint, admin auth, public API privacy, purchase/X4 edit independence, status PATCH.

This reflects **local D1 state** (prior imports/tests), not a regression in Phase 6.1/6.2 code. Update script baselines or reset local D1 only if you need a green 17/17 count gate.

---

## 2. Product image re-audit (`src/data/products.js`)

Summary from fresh `cloudinary-migration-review.json`:

| Metric | Count |
|--------|------:|
| Products | 160 |
| Image references in catalogue | 118 |
| Unique referenced paths | 117 |
| **Missing files** (exact path under `public/`) | **3** |
| **Empty `images: []`** | **49** |
| Unreferenced files on disk | 8 |
| Shared path across products | 1 |

### Missing paths (no replacement applied)

| Path | Product(s) |
|------|------------|
| `/images/products/images-mobile-webp/COLOUR_KOTI_DLX.webp` | P010 |
| `/images/products/images-mobile-webp/GANGA_JAMUNA_AJN.webp` | P124 |
| `/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp` | P006, P063 (shared) |

Candidates and related paths are listed in `server/reports/cloudinary-migration-review.md` — **not auto-mapped**.

### Duplicate / shared reference

- **GC_SPECIAL_AJN.webp** — same path on P006 and P063; file **missing** (see above).

### Empty image arrays

**49 products** — full list in `cloudinary-migration-review.md` § “Empty image arrays”. Storefront uses ID-based fallback / “Photo coming soon” via `ProductImageCarousel` + `productImage.js`.

### Unreferenced disk files (8)

Not referenced in `products.js` (assign only with explicit approval):

- `/images/products/images-mobile-webp/100_MEGA_DLX_IN.webp`
- `/images/products/images-mobile-webp/2_SOUND_BOMB_DETAIL.webp`
- `/images/products/images-mobile-webp/3.5_LAXMI_front.webp`
- `/images/products/images-mobile-webp/COLOUR_KOTI_DLX_AJN.webp`
- `/images/products/images-mobile-webp/GC_SPECIAL_AJN.jpg`
- `/images/products/images-mobile-webp/MMS_DLX.webp`
- `/images/products/images-mobile-webp/MMS_GB.webp`
- `/images/products/images-mobile-webp/MMS_GB_IN.webp`

### Family packs (`familyPackImages.js`)

All **7** configured paths present under `public/images/family-packs/`.

### Storefront vs Cloudinary URLs

- **Catalogue data** (`src/data/products.js`): **local `/images/...` paths only** — no `res.cloudinary.com` in data files.
- **D1 / admin**: may store Cloudinary URLs after upload; mapping artefact `server/data/generated/cloudinary-upload-mapping.json` exists for migration.
- **Admin upload**: signed params via `POST /api/admin/uploads/sign` (`adminUploads.js` + `cloudinarySign.js`); browser upload in `src/admin/lib/cloudinaryUpload.js` — **API secret stays on Worker**.

---

## 3. Manual browser checks (performed)

Environment: **Vite dev** `http://localhost:5173` (with `/api/*` proxy + local admin JWT via `.env.local`), Worker **`http://127.0.0.1:8787`**.

| Check | Result |
|-------|--------|
| Direct load `/estimate` | **Pass** — “My estimate” page renders |
| Direct load `/crackers/gift-boxes` | **Pass** — category catalogue, product cards |
| Direct load `/admin/products` | **Pass** — session verified, product table, pagination, search, missing-rate filters |
| Missing purchase rate filter | **Pass** — list narrows (e.g. 161 → **92** products) |
| Direct load `/admin/customer-requests` | **Pass** — queue with multiple requests, status filter |
| Production build preview `/estimate` | **Pass** — `vite preview` @ `:4173`, direct URL loads SPA (empty estimate) |

### Not performed in browser (this session)

| Check | Status |
|-------|--------|
| Full Estimate → **Send estimate on WhatsApp** → confirm `POST /api/public/customer-requests` in Network tab | **Not run** — API path covered by Phase 6 script (15/17 HTTP checks) |
| Open request → create quotation → **Prepare WhatsApp message** UI | **Not run** — covered by Phase 6 script (`whatsapp_preview_snapshot`) |
| Admin product **edit/save** (purchase / X4) | **Not run** — covered by unit tests + Phase 6 PUT checks |
| **`vercel.json` rewrite** on Vercel or `vercel dev` | **Not run** — file present in repo; validate on first Vercel deploy/preview |
| Cross-origin Vercel → Worker with `CORS_ALLOWED_ORIGINS` | **Not run** — needs real deployed origins |

---

## 4. Confirmed defects (unchanged; no fixes applied)

| ID | Severity | Issue |
|----|----------|--------|
| IMG-1 | Medium | 3 missing product image files (table above) |
| IMG-2 | Low | 49 products with empty `images[]` (fallback UI only) |
| IMG-3 | Info | 8 unreferenced product image files on disk |
| QA-1 | Low | Phase 6 script D1 count assertions out of sync with local DB (71/139 vs 70/138) |

No code defects found in CORS, Estimate API wiring, or admin auth during this phase.

---

## 5. Unresolved deployment blockers

1. **Deploy** frontend (Vercel) and Worker + **remote D1** with real `database_id` and migrations — not done.
2. Set **`VITE_API_BASE_URL`** (Vercel) and **`CORS_ALLOWED_ORIGINS`** (Worker) to **your** production/preview URLs — placeholders only in docs.
3. **Cloudflare Access** + `admin_users` allowlist for production admin — not exercised here beyond local JWT.
4. **Image content** — resolve 3 missing paths (or approved `products.js` changes) before relying on photos for those SKUs.
5. **First Vercel preview** — confirm SPA rewrite for deep links (repo `vercel.json` added in Phase 6.2; not validated on Vercel in this session).
6. **68 review-rate products** — still manual; no bulk import.

---

## 6. Files touched in Phase 6.3

| File | Change |
|------|--------|
| `scripts/verify-family-pack-images.mjs` | **Added** — family pack path existence check |
| `server/reports/cloudinary-migration-review.json` | **Regenerated** (audit re-run) |
| `server/reports/cloudinary-migration-review.md` | **Regenerated** |
| `server/docs/PHASE6_3_QA_REPORT.md` | **This report** |

No application logic, pricing, or catalogue data changes.

---

## 7. Suggested follow-up (optional)

- Re-run Phase 6 script after aligning local D1 count expectations or refreshing baselines in `phase6-local-e2e-verify.mjs`.
- One manual browser pass: Estimate review send + DevTools Network confirmation of `201`/`200` on customer-requests.
- After Vercel first deploy: hard-refresh `/estimate`, `/crackers/gift-boxes`, `/admin/products`.
