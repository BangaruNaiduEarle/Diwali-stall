# Phase 3D — Cloudinary upload runner (preparation)

Upload is **separate** from D1 `images_json` migration. This phase only moves verified local files to Cloudinary and records durable URL mappings.

## Architecture

```
catalogue:cloudinary:audit  →  cloudinary-migration-manifest.json
                                      │
                                      ▼
                    cloudinary-migration-upload.mjs
                      (validate manifest uploadTasks only)
                                      │
              ┌───────────────────────┴───────────────────────┐
              │ dry-run (default)          --execute            │
              │ plan / skip / counts       signed POST (Node)   │
              └───────────────────────┬───────────────────────┘
                                      ▼
              data/generated/cloudinary-upload-mapping.json
              (byCataloguePath + byProductSlot, idempotent retries)
                                      │
              (later phase) D1 images_json PATCH — not in 3D
```

- **Manifest source of truth:** only `uploadTasks` from the approved manifest are uploaded (one task per local catalogue path). `entries` define how product slots reuse canonical URLs (e.g. P006/P063 shared file → one upload at `P006/1`, both slots map to the same `secureUrl`).
- **Signing:** uses the same SHA-1 helpers as `POST /api/admin/uploads/sign` (`cloudinarySign.js`). The CLI reads `CLOUDINARY_*` from `server/.dev.vars` or the environment. The API secret is never written to reports, the browser, or git.
- **Missing files:** tasks whose `localFilePath` is absent on disk are skipped (including shared `GC_SPECIAL_AJN.webp` until the exact `.webp` exists). No filename guessing or near-match substitution.
- **Path confinement:** each task resolves under `public/images/products/`, must match its catalogue path, allowed image extensions only, symlink escape rejected (`cloudinaryMigrationPathSafety.js`).
- **Checkpoint saves:** after each successful upload the mapping is written atomically (temp file + rename) so partial runs retain completed paths.

## Commands

From `server/`:

```bash
# Regenerate manifest after catalogue/image changes
npm run catalogue:cloudinary:audit

# Dry-run (default) — no network, no mapping file writes
npm run catalogue:cloudinary:upload

# Real uploads (explicit opt-in)
npm run catalogue:cloudinary:upload:execute
```

Optional flags (see `node scripts/cloudinary-migration-upload.mjs --help`):

- `--force` — re-upload even if `byCataloguePath` already has a `secureUrl`
- `--manifest=`, `--map=`, `--report=` — override paths

## Artifacts

| Path | Purpose |
|------|---------|
| `reports/cloudinary-migration-manifest.json` | Input: `uploadTasks` + `entries` |
| `data/generated/cloudinary-upload-mapping.json` | Durable path → URL map (safe to commit; no secrets) |
| `reports/cloudinary-migration-upload-report.json` | Per-run task status |

### Mapping shape

- **`byCataloguePath`:** one record per uploaded local catalogue path (deduped). Retries skip upload when `secureUrl` is present unless `--force`.
- **`byProductSlot`:** `{productId}/{slot}` → `secureUrl` and delivery `cloudinaryPublicId` (shared slots reuse the canonical public ID).

## Recovering from partial failure

1. Fix the cause (network, credentials, missing file, Cloudinary error).
2. Re-run **`npm run catalogue:cloudinary:upload:execute`** without `--force`. Successfully uploaded paths remain in the mapping; only pending/failed tasks are attempted.
3. Inspect `reports/cloudinary-migration-upload-report.json` for `failed` / `skipped_missing_local_file` rows.
4. Use `--force` only when you intentionally need to replace an asset at the same canonical public ID (`overwrite: true` in signed params).

Do **not** run D1 import or `images_json` updates in this phase.
