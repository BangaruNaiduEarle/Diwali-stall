# Release blocker fixes — 3 November 2026

> Follow-up: all six server-tooling findings described below are now resolved.
> See [the server security report](SERVER_TOOLING_SECURITY_2026-11-03.md) for the clean
> audit, scoped dependency patches and passing regression/compatibility tests.
> This document retains the earlier findings; actual Android sign-off remains pending.

The three requested blockers are fixed: legacy checkout retries, the 20 failed backend/scope tests, and Vite GHSA-587h-7wmj-h5pm. **This is not a release approval:** an additional audit of the separate, unchanged server tooling reports five high and one low vulnerable packages, and actual Android validation remains pending.

All persistence checks used the existing isolated D1 from [the readiness report](RELEASE_READINESS_2026-11-03.md). No migrations were added or applied, no original D1 data/migration state was changed, and no deployment, production access or Git commands occurred.

## 1. Legacy checkout root cause and fix

Reproduced before modifying runtime code: identical authenticated legacy checkouts with the same `Idempotency-Key` returned request IDs `415185e2-db44-4d70-8a4c-49c589163498` and `f0bbab57-1900-4b53-b5d5-7e443c7cbf29`. Both returned 201. Evidence: `RUN/fix-legacy-before.json`.

Two connected application bugs caused this:

- `server/src/routes/adminQuickBill.js` forwarded the key only when location mode was enabled.
- `server/src/services/adminQuickBill.js` selected atomic checkout only for a validated location scope. Legacy checkout generated a random request ID and used separate request/quotation writes, ignoring duplicate keys.

Both modes now use the existing atomic checkout implementation. The route forwards the key in both modes and reports `idempotentReplay`. A valid key is required; absent/invalid keys return 400 before writes. The current frontend already generates and preserves that key through retries, so no frontend state change was needed. Direct legacy service callers must now supply a key too.

The enabled-mode identity format remains unchanged. Legacy identity derives deterministic request/quotation UUIDs from a separate namespace, operating season, authenticated creator email and operation key. Input fingerprinting detects reuse with different customer/cart/pricing input (409). The key itself is not stored as plaintext.

The existing request primary key supplies the durable unique constraint; no new table/index/migration is necessary. One D1 `batch()` commits request, lines, fingerprint, pending-finalization state and quotation together. Season/activity/availability/price snapshots are checked inside the batch. Legacy SQL does not require location tables/columns or the workflow `revision` column. Mode selection still comes from trusted DB configuration; it cannot bypass enabled-mode location authorization.

A completed operation returns its persisted request/quotation and totals. If an identical concurrent transaction wins or the commit acknowledgement is lost, the losing/retrying call reads that completed transaction. Failed batches roll back; retrying the same key can safely create the transaction. Incomplete/different persisted input is rejected, never repaired by overwriting it. Different legitimate keys create separate requests.

Validation:

- In-memory checkout tests cover complete rollback, lost commit acknowledgement, concurrent retries, changed input, missing keys, separate checkouts and existing enabled-mode scope/price/ownership races.
- Six real legacy HTTP checks pass. Six simultaneous submissions created one request and one quotation. Aborting response consumption after commit then retrying recovered the original transaction. Changed input received 409. Distinct keys created distinct requests. Direct D1 inspection found exactly five complete transactions for five legitimate operations, each with one request line, quotation and quotation line.
- Existing real Worker/D1 workflows passed again, including online billing/finalization, payment idempotency, four-Admin concurrency, cross-stall denial and QR/Family Packs.

## 2. All 20 former failures

All 20 pass. Their five files contain **40 tests; all 40 pass**. No authorization/runtime scope check was relaxed.

**F1 — outdated direct-service fixture:** service DB bindings must be explicitly initialized from trusted configuration. These tests model legacy single-stall behavior but supplied unconfigured mock DBs, so `adminServiceMode` correctly failed closed with `location_context_unavailable`. Their factories now explicitly bind `ADMIN_LOCATION_MODE: '0'`. Enabled-mode and unknown-mode rejection logic is unchanged.

**F2 — incomplete public catalogue fixture:** public creation requires an active configured catalogue even without admin authentication. The old all-null stub had no catalogue, so 503 was correct. The test now supplies a valid active product/catalogue fixture and requires **201**, strengthening its old “not 401/not 503” assertion.

| Test file / exact test name | Root cause | Affected service/module | Result |
| --- | --- | --- | --- |
| `adminPhase5` — updates selling price without changing private rate | F1 | `adminProducts`, service mode | Pass |
| `adminPhase5` — updates private rate without changing selling price | F1 | `adminPrivateRates`, service mode | Pass |
| `adminPhase5` — creates quotation from request lines with integer paise totals | F1 | `adminQuotations`, request scope | Pass |
| `adminPhase5` — blocks quotation when private rate missing | F1 | `adminQuotations`, request scope | Pass |
| `adminPhase5` — returns existing quotation on retry without duplicate active rows | F1 | `adminQuotations`, request scope | Pass |
| `adminPhase5` — keeps quotation snapshot stable after rate change | F1 | `adminQuotations`, request scope | Pass |
| `adminProductRateEdit` — purchase upsert does not mutate X4 private_rates state | F1 | `adminPurchaseRates`, catalogue scope | Pass |
| `adminProductRateEdit` — X4 upsert does not mutate purchase_rates state | F1 | `adminPrivateRates`, catalogue scope | Pass |
| `adminProductRateEdit` — unchanged X4 upsert is a no-op (preserves current row) | F1 | `adminPrivateRates`, catalogue scope | Pass |
| `adminProductRateEdit` — unchanged purchase upsert is a no-op | F1 | `adminPurchaseRates`, catalogue scope | Pass |
| `mixedEstimateWorkflow` — persists product-only, family-pack-only, and mixed lines with pack price snapshot | F1 | `adminCustomerRequests`, request scope | Pass |
| `mixedEstimateWorkflow` — builds quotation from two billable lines only (pack contents not expanded) | F1 | `adminQuotations`, request scope | Pass |
| `mixedEstimateWorkflow` — keeps historical pack unit_price_paise after catalogue price increases | F1 | `adminCustomerRequests` / `adminQuotations`, request scope | Pass |
| `adminCustomerRequestSeasonIsolation` — scopes list enrichment to the active season | F1 | `adminCustomerRequests`, request scope | Pass |
| `adminCustomerRequestSeasonIsolation` — returns forbidden when pending finalization is marked without season | F1 | `adminCustomerRequests`, request scope | Pass |
| `adminCustomerRequestSeasonIsolation` — returns not_found when status update targets another season | F1 | `adminCustomerRequests`, request scope | Pass |
| `adminCustomerRequestSeasonIsolation` — returns forbidden when recording public customer agreement without season | F1 | `adminCustomerRequests`, request scope | Pass |
| `adminCustomerRequestSeasonIsolation` — returns not_found when public customer agreement targets another season | F1 | `adminCustomerRequests`, request scope | Pass |
| `adminCustomerRequestSeasonIsolation` — omits internal pricing view for cross-season products on detail filter | F1 | `adminQuotationResponse`, request scope | Pass |
| `adminRoutesAuth` — POST /api/public/customer-requests does not require admin auth | F2 | `publicCatalogueSeason`, public request route | Pass |

These 20 failures were fixture/assumption problems, not evidence of an authorization defect needing a runtime bypass. The genuine runtime bug fixed here is the separate legacy duplicate-checkout path. Existing role, membership, request ownership, season/location, payment, offline and Platform Admin boundaries remain covered by the regression suites below.

Quick Bill's older tests were also updated for the newly required legacy key and atomic metadata reads. Its previous test that demanded legacy multi-write behavior now verifies one atomic batch without location-schema dependencies. The transaction mock recognizes the legacy season-based catalogue guard; real D1 tests independently verify uniqueness/persistence rather than relying solely on that mock.

## 3. Vite and complete dependency tree

| Component | Before | After |
| --- | --- | --- |
| Direct Vite declaration | `^8.3.0` | exact `8.3.3` |
| Installed and lockfile Vite | `8.3.2` | `8.3.3` |
| Vite-bundled `launch-editor` | `2.14.1` | `2.14.2` |
| Vite-bundled `launch-editor-middleware` | `2.14.1` | `2.14.2` |
| Other standalone dependency versions | Existing versions | Unchanged |

Inspected `package.json`, lockfile, `npm ls --all --json` before/after and Vite's bundled source. `launch-editor` is bundled inside Vite's Node distribution; it does not appear as a separate installed package in `npm ls launch-editor`. The complete tree comparison found only Vite's version changed, including its deduplicated references from Tailwind and the React plugin. The install changed one package. No direct launch-editor override, major upgrade or `npm audit fix --force` was used.

This is the smallest patched 8.3 release. The [maintainer advisory](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm) identifies launch-editor ≤2.14.1 and Vite 8.3.0–8.3.2 as affected; [Vite 8.3.3](https://github.com/vitejs/vite/releases/tag/v8.3.3) includes the patched editor and related fixes. Node 20.20.0 satisfies Vite's unchanged `^20.19.0 || >=22.12.0` engine requirement.

`npm audit --json --offline=false --prefer-online` now exits **0: zero vulnerabilities**, including related editor/middleware/filesystem advisories. The explicit online flags avoid the environment's misleading offline audit result. Evidence: `fix-npm-audit.json`, `dependency-tree-before.json`, `dependency-tree-after.json`.

## 4. Regression results

| Check | Result |
| --- | --- |
| Previously failing five files | 40/40 pass; all former 20 failures pass |
| Duplicate/atomic + legacy Quick Bill focused tests | 38/38 pass |
| Safe backend unit script | 286/286 pass (previously 272/286) |
| Stall/season/platform scope group | 420/420 pass (previously 414/420) |
| Handover, workflow, payments, QR, Family Pack regressions | 138/138 pass |
| Offline synchronization/storage/PWA regressions | 37/37 pass |
| Frontend tests | 173/173 pass |
| Real legacy HTTP retry/timeout/concurrency checks | 6/6 pass |
| Existing isolated D1/legacy probes | 5/5 pass |
| Real location-mode Worker/D1 workflows | 15/15 pass |
| Production-preview desktop Chrome offline/QR/restart/sync | 14/14 pass |
| Root dependency registry audit | Zero vulnerabilities |
| Lint | Exit 0; existing warnings remain |
| Production build with Vite 8.3.3 | Pass; existing ~1.06 MB chunk warning |
| Original D1 hashes/content and clone historical rows | Unchanged / pass |

Suites overlap; totals must not be summed into a unique-test count. Used `npm --prefix server run test:unit`, not the server default test lifecycle that migrates original local storage. No original migration command ran.

The real browser test uses separate Admin/Owner profiles and the actual Worker, catalogue, signing preparation, IndexedDB and service worker. It covers multipart mixed-cart Family Pack acceptance, duplicate rejection, offline browser restarts, five saved billing/payment operations, an interrupted third sync followed by recovery, and preserved stale-Admin conflicts. Shared shell caches and signing-key boundaries passed too.

One concurrent browser/CLI run encountered a Miniflare internal D1 JSON error during Owner preparation. That failure is preserved as `fix-browser-concurrent-runtime-failure.json`. With the second local Worker stopped and D1 CLI probes completed, the sequential rerun passed all 14 checks. No application security/retry behavior was changed to mask that runtime failure.

## 5. Evidence and database safety

`RUN` remains:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

Main evidence: `fix-legacy-before.json`, `fix-legacy-http-results.json`, `additional-probes.json`, `http-e2e-results.json`, `browser-e2e-results.json`, `fix-npm-audit.json`, `fix-server-audit.json`, dependency-tree JSON and `logs/fix-*.log`.

The original active D1 and the other two SQLite files have the same schema/data and main/WAL hashes as the verified backup. The disposable clone retains all original rows projected onto their original columns. Its schema still has exactly the previously rehearsed migration history (25 records), all 50 expected migration objects, integrity `ok`, and zero foreign-key violations. Tests added only fixture transactions to that existing clone. See `original-preservation-final.json`, `historical-preservation.json`, and `logs/fix-migration-preservation.log`.

Production preview remains on `http://localhost:5193` with the isolated API on `http://localhost:8793`. The temporary legacy Worker was stopped after its checks. No real Android testing is claimed.

## 6. Changed files

- Runtime: `server/src/routes/adminQuickBill.js`, `server/src/services/adminQuickBill.js`, `server/src/services/adminQuickBillAtomic.js`.
- Regression tests/fixtures: `server/tests/adminPhase5.test.js`, `adminProductRateEdit.test.js`, `mixedEstimateWorkflow.test.js`, `adminRoutesAuth.test.js`, `adminCustomerRequestSeasonIsolation.test.js`, `adminQuickBill.test.js`, `adminQuickBillAtomic.test.js`, `server/tests/helpers/mockAdminTransactionDb.js`.
- Real isolated regression harness: `server/scripts/release-legacy-checkout-regression.mjs` (new).
- Dependencies: root `package.json`, `package-lock.json`. Server dependency files are unchanged.
- Documentation: this report (new), `docs/RELEASE_READINESS_2026-11-03.md`, `docs/REQUEST_BILL_ADJUSTMENTS.md`, `docs/ANDROID_RELEASE_CHECKLIST.md`.

## 7. Remaining blockers

The additional **server** registry audit exits 1 with five high and one low vulnerable packages in its unchanged development toolchain:

| Package | Installed | Audit severity |
| --- | --- | --- |
| `wrangler` | 4.85.0 | High, inherited |
| `miniflare` | 4.20260424.0 | High, inherited |
| `sharp` | 0.34.5 | High |
| `undici` | 7.24.8 | High |
| `ws` | 8.18.0 | High |
| `esbuild` | 0.27.3 | Low |

These findings are independent of the fixed Vite bundle and were not introduced by its one-package patch. The audit's proposed non-major remediation is Wrangler 4.156.2; that tooling upgrade and its runtime/persistence compatibility have **not** been implemented or validated in this task. Server dependency files remain unchanged to keep the requested Vite change minimal. Do not treat the root audit's zero findings as a clean server audit.

Actual Android installation, physical camera scanning, mobile-network behavior and device storage/reboot retention still require [the manual Android checklist](ANDROID_RELEASE_CHECKLIST.md). The temporary Worker runtime's compatibility-date limitation from the original report also remains. These unresolved security/device checks prevent release approval despite the requested three fixes passing their regressions.
