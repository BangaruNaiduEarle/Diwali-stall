# Multi-Stall Migration Chain Rehearsal — 0021–0026

Date: 3 November 2026. **Verdict: PASS for the complete 0021–0026 chain on a fresh isolated local D1 fixture.** All six migrations applied sequentially through Wrangler, all nine native Worker/D1 acceptance checks passed, and all 117 selected regression tests passed. No migration/application fix was needed.

This closes the **local full-chain rehearsal** gap left by the [historical cost foundation](HISTORICAL_PURCHASE_COST_FOUNDATION_2026-11-03.md), [0025 rehearsal](HISTORICAL_PURCHASE_COST_MIGRATION_REHEARSAL_2026-11-03.md) and [Stall Settings backend report](STALL_SETTINGS_BACKEND_IMPLEMENTATION_2026-11-03.md). It does not authorize deployment or declare overall release acceptance complete. Existing reports remain unchanged.

## Environment and safety boundary

```text
RUN = C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
CHAIN = RUN\chain-687017a4
Fresh D1 name: diwali-chain-rehearsal
Fresh D1 ID: a5dade1b-278d-4079-b847-7593da4f0e93
Persistence: CHAIN\persist\v3\d1
Database file: CHAIN\persist\v3\d1\miniflare-D1DatabaseObject\b5f285591fc0798e55dbac6c3d7716d227383a51f8130fecd07e7f913232fd77.sqlite
```

- Created a new D1 identity and empty local persistence target. Restored the existing **verified pre-0021 backup inside `RUN\backup`** into that fresh target using SQLite's backup API, after checking the target contained no application tables. This tests upgrade preservation with historical data, rather than reconstructing a minimal location schema.
- Source backup had the real 0020 foundation and preceding schema: **24 application/auth/migration tables, 75 schema objects, 21 migration records and 1,460 rows**. Both historical 0010 filenames remain part of the migration-history count.
- The verified backup and the established `RUN\persist` baseline were opened **read-only** for source/preservation checks. Their resolved paths were checked against the isolation manifest and the original database path. The original database was never opened; no production access occurred.
- Applied migrations only to the fresh `CHAIN\persist` target with explicit `--local`, fresh config and database ID. No default server persistence path or remote flag was used. No deployment, Git command, dependency/configuration change to the application or existing report modification occurred.
- Actual current Worker was bundled with esbuild and executed through native Miniflare/workerd, with real loopback HTTP, password authentication, normal Origin checks and session cookies. Local authentication bypass remained disabled. A newly generated fixture-only signing key supported signed QR tests; it remains private in `state.json`.
- Runtime: Node **20.20.0**, Windows; Wrangler **4.85.0**, Miniflare **4.20260424.0**, workerd **1.20260424.1**, esbuild **0.28.1**; compatibility date **2026-05-01**. Native runtime instances were disposed after use.

No earlier completed acceptance phase was rerun. New native scenarios target interaction of the six migrated components; regression selections target those same boundaries only.

## Sequential migration evidence

Exposed one new migration file at a time in `CHAIN\migrations`, then invoked the installed Wrangler CLI separately for each step:

```text
node server/node_modules/wrangler/bin/wrangler.js d1 migrations apply diwali-chain-rehearsal --local --config <CHAIN>/wrangler.toml --persist-to <CHAIN>/persist
```

Every invocation exited 0. A read-only verification followed **each migration**, checking integrity, foreign keys, preservation of old-column values and unchanged isolated sources. Migration history increased exactly once per step and its last name matched that step. Each isolated migration copy has a recorded SHA-256 matching the checked-in source.

| Migration | Status | Total schema objects | Migration-history rows | Immediate compatibility evidence |
| --- | --- | ---: | ---: | --- |
| Pre-0021 verified fixture | **PASS** | 75 | 21 | Exact fresh clone of the verified isolated backup; no revision column or later tables yet. |
| 0021 — Request workflow history | **PASS** | 92 | 22 | History table/indexes/triggers created; old-column values preserved. Stable historical line IDs backfilled; no invented historical events. |
| 0022 — Payment ledger | **PASS** | 109 | 23 | Accounts, ledger, summary views/indexes/triggers created; **9 eligible historical accounts** backfilled; **0 payment entries** invented. |
| 0023 — Offline synchronization receipts | **PASS** | 117 | 24 | Device/receipt tables and guards created; no historical devices or receipts invented. |
| 0024 — QR handover | **PASS** | 125 | 25 | Device-key/claim tables, history and authority triggers created; no historical keys/claims invented. |
| 0025 — Bill purchase-cost snapshots | **PASS** | 132 | 26 | Immutable scoped line-cost storage created; **0 historical cost snapshots** backfilled. |
| 0026 — Stall Settings | **PASS** | 139 | 27 | Independent profile/season settings and immutable audit storage created; **0 settings/default rows** written by migration. |
| Final no-pending check | **PASS** | 139 | 27 | Another local migration-apply invocation reported **“No migrations to apply!”**; no migration executed twice. |

Final verification matched **all 64 declared new schema objects**, including **8 explicit indexes**, from the actual six migration files against the resulting database. The expected-object manifest in `verification-final.json` lists each table/view/index/trigger, migration name and presence result. This complements the native API checks; no schema success is inferred only from SQL source inspection.

### Preservation rules and result

0021 intentionally adds/backfills new stable-line fields. Preservation therefore compares each old table using **its original pre-0021 column list**, not an invalid whole-row comparison across an ALTER TABLE. For every original row, its original-column hash remains present after every migration and after runtime tests. Newly seeded fixture rows are allowed; missing/modified historical rows are not.

- **1,460 pre-existing rows across 24 tables retained their original column values**, including original migration-history entries. Migration history additionally contains the six new records.
- Original request/quotation counts before runtime: **70 requests, 274 request items, 72 quotations, 297 quotation items**. Historical unit/actor data was not reconstructed from current catalogue data.
- `PRAGMA integrity_check` returned **ok** and read-only FK checks returned **zero violations** after each step and at final verification. Native D1's supported FK check also passed after runtime cases. Integrity was inspected read-only outside the D1 API, whose direct integrity PRAGMA restriction was established in the earlier 0025 rehearsal.
- Verified isolated backup file SHA-256 is unchanged; the established disposable baseline's schema and all recorded application-table row hashes are unchanged.
- Final schema has **139 objects / 35 application/auth/migration tables**. Temporary diagnostic triggers used for rollback testing were removed.

## Requested acceptance matrix

All native results below are **new executions against the full migrated database**. The regression section separately identifies in-memory/mocked selections; none substitutes for the native migration application.

| # | Requirement | Status | Test names and observed evidence |
| --- | --- | --- | --- |
| 1 | Schema creation and indexes | **PASS** | Sequential Wrangler steps 0021–0026, CHAIN-01 and final expected-object manifest: all 64 declared objects / 8 indexes present, 27 history records in correct order, FK/integrity checks pass. |
| 2 | Historical purchase-cost snapshots | **PASS** | CHAIN-02: historical finalized bill has null/unavailable profit and no retroactive snapshot. CHAIN-07: new finalization captures scoped cost **10,000 paise**, profit **7,000** on due **17,000**; later purchase-rate edits do not alter it. Immutability and duplicate retry checks pass. |
| 3 | Stall-scoped settings and defaults | **PASS** | CHAIN-04/05: new stalls default to empty contacts/schedules; separate persisted profiles/revisions and season schedules. Migration itself seeds no settings rows. |
| 4 | Existing single-stall compatibility | **PASS** | CHAIN-03: the source-defined original business/stall/2026 context returns existing configured phone/WhatsApp/venue/detail/map and date/time defaults with revisions 0; no settings writes to that stall. Platform singleton remains unchanged. Focused explicit legacy-mode regressions also pass. |
| 5 | Owner/Super Admin settings updates | **PASS** | CHAIN-04: Owner saves A profile/schedule; Super Admin independently updates A WhatsApp; Owner B updates B. A revisions **2/1**, B **1/0** at that checkpoint; foreign B data unchanged by A writes. |
| 6 | Admin read-only access | **PASS** | CHAIN-04: Admin receives display settings with `canUpdate: false` and no updater metadata; PATCH returns **403**. Same user Owner A/Admin B cannot edit B. |
| 7 | Revision conflicts | **PASS** | CHAIN-05: two simultaneous A saves from one revision produce **200/409**. No-op with current revision creates no event. Separate season has independent dates; A/B revisions are not global. |
| 8 | Atomic audit history | **PASS** | CHAIN-06: injected audit failure returns safe **503**, with profile/canonical stall name/schedule/revisions/event count unchanged. Audit UPDATE/DELETE rejected. CHAIN-07/08 also retain financial/offline audit and receipt invariants. |
| 9 | Cross-stall isolation | **PASS** | CHAIN-04/05/07: same-business A/B settings independent; lesser B role denied; wrong authorized stall and season cannot read A's payment record (**404**). Final persisted cost/account scope mismatch count **0**. |
| 10 | Billing/payment/offline/QR regressions | **PASS** | CHAIN-07 native finalization/payment retries and CHAIN-08 signed mixed Family Pack handover/agreement/CLOSE/PAYMENT retries; **117 focused regression tests PASS** with explicit filtered exclusions below. |

## Native runtime scenarios

| Test ID / name | Status | Specific result |
| --- | --- | --- |
| CHAIN-01 — Full migrated schema, indexes and historical identities | **PASS** | Last six migration names match 0021–0026 exactly; required financial/offline/QR/settings tables and indexes found; **274 historical request lines** have deterministic backfilled IDs. |
| CHAIN-02 — Historical bill unavailable cost/profit | **PASS** | An existing eligible finalized bill remains readable under its original stall/season; `available: false`, null profit and no cost rows. Current rates do not manufacture historical profit. |
| CHAIN-03 — Original single-stall defaults | **PASS** | Unchanged source configuration defaults, no saved overrides/revisions, original selected context authorized through a new fixture Owner membership. No old credentials were used. |
| CHAIN-04 — Settings role/isolation matrix | **PASS** | Owner/Super Admin positive saves; B retains independent values; Admin and lower B grant reject mutation with 403. |
| CHAIN-05 — Concurrent revisions / season separation | **PASS** | One successful save and one 409; active alternate-season schedule independent; unchanged save appends no audit. |
| CHAIN-06 — Atomic settings audit / immutability | **PASS** | Temporary failure trigger proves whole settings batch rollback; settings events remain append-only. Diagnostic trigger removed. |
| CHAIN-07 — Financial capture and payment arithmetic | **PASS** | Quantity 2 at purchase cost 5,000 captures line cost **10,000**. Frozen due **17,000**, received **3,000**, outstanding **14,000**, gross profit **7,000**; quotation selling total remains **20,000**. Current rate changed to 6,001 without repricing history. Payment replay and three finalization retries create no duplicate cost/account/payment. Snapshot UPDATE/DELETE denied. |
| CHAIN-08 — Signed mixed Family Pack QR/offline chain | **PASS** | Real Admin device registration/signature/certificate and Owner recipient; v2 transfer has one fixed pack plus one product. Duplicate HANDOVER replays one claim; AGREEMENT/CLOSE/PAYMENT and repeated payment yield **1 request identity, 1 claim, 4 receipts, 1 payment, 2 cost rows**. Saved pack composition unchanged. Pack cost remains explicitly unavailable, so complete bill profit is null. |
| CHAIN-09 — Final joint invariants | **PASS** | Platform setting unchanged; native FK check empty; no cost snapshot/account business/location/season/quotation mismatch. Final historical-data/source-preservation check passes. |

The QR case tests signed payload and authoritative Worker reconciliation, not camera optics, physical Android or a new browser acceptance phase. Offline operations traverse the real synchronization API and receipt transaction; device-local UI/reboot testing was not repeated.

### Final row integrity

| Table / record type | Final rows | Explanation |
| --- | ---: | --- |
| Customer requests | 72 | 70 retained + 2 new runtime requests. |
| Customer request items | 277 | 274 retained + ordinary bill line + 2 mixed QR lines. |
| Quotations / quotation items | 74 / 300 | 72 / 297 retained + the two new transaction snapshots. |
| Payment accounts | 11 | 9 verified historical accounts + 2 new finalized bills. |
| Payment ledger | 2 | One online partial payment and one offline partial payment; retries do not duplicate. |
| Purchase-cost snapshots | 3 | Ordinary bill line plus 2 QR bill lines; pack row explicitly unavailable. No historical cost backfill. |
| Offline devices / signing keys | 2 / 2 | New Admin and Owner fixture devices only. |
| Offline receipts / QR claims | 4 / 1 | HANDOVER, AGREEMENT, CLOSE, PAYMENT; one authoritative claim. |
| Workflow events | 20 | New runtime activity only; no fabricated historical events. |
| Location profiles / season settings | 2 / 3 | A/B profiles and A/B current-season namespace rows plus A alternate-season schedule. Original stall has no persisted override. |
| Settings events | 5 | Successful changes only; stale/no-op/denied/injected-failure requests add none. |
| Migration history | 27 | Existing 21 names preserved + six sequential additions. |

## Focused regression results

Direct `node --test --test-concurrency=1` selections bypassed npm migration lifecycle hooks. Tests use fresh `:memory:` SQLite/mocks or explicitly nonpersistent native fixtures, independently of the full-chain D1. No audit, broad default test runner, unrelated UI suite or earlier acceptance preparation was executed.

| Group / files | PASS | FAIL | Filtered skips |
| --- | ---: | ---: | ---: |
| Cost/billing/offline: `billPurchaseCostSnapshots`, `requestPayments`, `billAdjustmentsHandover`, `offlineSync` | 56 | 0 | 0 |
| Settings: `adminStallSettings`, `adminStallSettingsRuntime` | 18 | 0 | 0 |
| Existing consumer compatibility: `adminPlatformPublicCatalogue`, `publicCatalogueLocation` | 20 | 0 | 0 |
| Finalization/scope: `adminCustomerRequestFinalizeAgreed`, `adminBillingLocationApi` | 18 | 0 | 0 |
| Explicit legacy checkout: `adminQuickBillAtomic`, filter `gate OFF\|legacy retries` | 2 | 0 | 21 |
| QR/history: `handoverSync`, `requestWorkflowHistory`, filter `offline handover atomically\|Owner-first mixed Family Pack\|assignment captures` | 3 | 0 | 24 |
| **Executed selection** | **117** | **0** | **45 excluded by filters** |

All selected runs exited 0, with zero cancelled tests. The 45 filtered cases are not counted as executions or passes. Exact argument lists and raw TAP/stdout/stderr are saved under `CHAIN`; groups were executed once for this rehearsal. Focused lint of the new JavaScript harness exits 0 without diagnostics.

## Evidence and changed files

Private evidence under `CHAIN`:

- `state.json`, `wrangler.toml`: fresh binding/path and private new fixture credentials/signing material. Do not publish the state file or database backup.
- `pre-chain.json`, `sources-before.json`: pre-0021 schema/columns/row hashes, verified-backup SHA-256 and established-baseline preservation inventory.
- `migrations/0021_...sql` through `0026_...sql`: isolated, source-identical copies.
- `0021.stdout.log` / `.stderr.log` through `0026.stdout.log` / `.stderr.log`: six real Wrangler applications.
- `verification-0021.json` through `verification-0026.json`, `migration-results.json`: per-step history/schema/integrity/FK/original-column preservation.
- `no-pending-migrations.stdout.log`, `verification-chain-complete.json`: no-pending confirmation and clean pre-fixture chain state.
- `runtime-results.json`, `http-trace.json`: nine native PASS results, sanitized actor/scope/status traces and financial/receipt evidence.
- `verification-final.json`: all 64 expected schema objects, final row counts, original-row projections, integrity/FKs and unchanged isolated sources.
- `regression-results.json`, each group `*.stdout.log` / `*.stderr.log`: exact 117-test results and exclusions.
- `evidence-inputs.json`, `worker-bundle.mjs`: runtime versions, compatibility date, source/bundle hashes and matching migration-copy hashes.

Added [migration-chain-rehearsal.mjs](../server/scripts/migration-chain-rehearsal.mjs) and [migration-chain-rehearsal-db.py](../server/scripts/migration-chain-rehearsal-db.py) as narrowly scoped rehearsal tooling, plus this report. **Application code, migration SQL, dependencies, existing configuration and reports were not modified.** Do not rerun migration/fixture preparation against retained evidence merely to inspect it; runtime checks support explicit checkpoint resumption.

The first sandbox setup attempt could not spawn native workerd (`EPERM`) and wrote no business data. The authorized retry created the accepted fresh fixture; the separate incomplete setup directory was retained. There were no failed migration or runtime application cases to repair. A final additional read-only verification enumerated every declared schema object; no business case or migration was repeated for that check.

## Remaining NOT TESTED boundaries and final verdict

| Boundary | Status |
| --- | --- |
| Complete 0021–0026 local D1 chain, historical-data preservation and joint backend runtime checks | **PASS** |
| Deployed Cloudflare runtime/HTTPS/configuration parity | **NOT TESTED — staging/runtime access unavailable** |
| Physical Android installation/camera/device storage/reboot/mobile networking | **NOT TESTED** |
| Fresh replay of migrations 0001–0020 | **NOT TESTED in this task**; a verified real pre-0021 backup supplied the prerequisite schema. |
| Down migration / production recovery cutover | **NOT TESTED**; no rollback/deployment was attempted. |

Frontend Settings/consumer integration and standalone Reports remain separate release requirements; no new UI, public routing or unsupported Family Pack valuation was implemented. No pending device/deployment acceptance is promoted to PASS.

**Final verdict: PASS for the requested full 0021–0026 migration-chain rehearsal in the isolated local D1 environment.** No reproduced chain-compatibility blocker remains within this scope. Target rollout still requires separate authorization and deployment-environment validation; overall release approval remains subject to the other outstanding acceptance gates.
