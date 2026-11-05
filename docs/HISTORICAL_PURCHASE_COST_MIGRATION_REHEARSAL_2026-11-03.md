# Historical Purchase Cost Migration 0025 — Runtime Rehearsal

Date: 3 November 2026. **Verdict: PASS for migration 0025 in the fresh isolated local Worker/D1 runtime.** Wrangler applied the migration successfully; 13 post-migration runtime checks, one pre-migration historical fixture check and the focused 79-test regression selection passed. No application/migration defect was reproduced and no application fix was needed.

This closes the **local native D1 rehearsal** gap in the [foundation report](HISTORICAL_PURCHASE_COST_FOUNDATION_2026-11-03.md). It is not deployment approval or final release acceptance. Physical Android and deployed runtime parity remain NOT TESTED. Existing reports are preserved unchanged.

## Environment and isolation

Reused the established isolated environment as a read-only schema source and created a **new database identity and persistence directory** beneath it:

```text
RUN = C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
P25 = RUN\p25-0026c34c
Database name: diwali-cost-rehearsal
Database ID: 76ef022b-f3ac-4b30-9b3c-f49c9af7a97a
Persistence: P25\persist\v3\d1
Database file: P25\persist\v3\d1\miniflare-D1DatabaseObject\468c1cd8c467bcfaf10473f5ce864b1da9d0608d5acd886a21e37f6a9e8078a4.sqlite
```

- Actual current application Worker bundled with esbuild and executed by native workerd through Miniflare; loopback HTTP requests used real password login/session cookies and normal request security. No authentication bypass or mocked D1 participated in the runtime checks.
- Node **20.20.0**, Windows; Wrangler **4.85.0**, Miniflare **4.20260424.0**, workerd **1.20260424.1**, esbuild **0.28.1**. Compatibility date **2026-05-01**, matching the established local runtime limitation. Dynamic loopback ports were private to each runtime session.
- Started with a fresh D1 binding. Exported **schema only** from the manifest-verified established disposable D1: 128 schema objects and its 25 migration-history records, including the existing pre-0025 chain. No business/authentication rows or existing credentials were copied. New fixture businesses/stalls/seasons/users/products were seeded independently.
- This is a 0025 upgrade rehearsal against the established pre-0025 schema, **not a fresh replay of migrations 0001–0024**. Earlier foundation migrations contain baseline-specific prerequisites; they were not rerun or modified.
- Fixture scope: `cost-business`, `cost-stall-a`, `cost-stall-b`; active operating seasons `cost-2026` / `cost-2027`; independent Owner, Super Admin and Admin identities. All three have explicit fixture memberships; global roles do not substitute for location/season authority.
- Read-only Python inspection asserted that the schema source resides inside `RUN\persist`, differs from the original database path, and the rehearsal target resides inside `P25\persist`. Only those verified disposable files were opened. The original path was compared as a string, never opened.
- No original local D1 or production access, deployment, Git command, original configuration/dependency modification or unrelated suite execution occurred. Workerd instances were disposed after each runtime stage.

`P25/state.json` contains private new fixture passwords/cookies and must remain private. Evidence summaries below contain no credentials.

## Migration application and preservation

Before applying 0025, PRE-01 created a genuine finalized bill and a 3,000-paise partial payment through the real Worker. This provided a historical bill with no purchase-cost snapshot, rather than fabricating an estimated historical cost.

Copied only `0025_bill_purchase_cost_snapshots.sql` into `P25/migrations`; its SHA-256 matches the checked-in migration. Applied once with the installed Wrangler CLI:

```text
node server/node_modules/wrangler/bin/wrangler.js d1 migrations apply diwali-cost-rehearsal --local --config <P25>/wrangler.toml --persist-to <P25>/persist
node server/node_modules/wrangler/bin/wrangler.js d1 migrations list diwali-cost-rehearsal --local --config <P25>/wrangler.toml --persist-to <P25>/persist
```

Both commands exited 0. Wrangler listed **only 0025** as pending and recorded **7 commands executed successfully**. Its standard noninteractive local confirmation selected yes. The migration-list output subsequently reported no migrations to apply. No remote flag was used.

| Verification | Status | Evidence |
| --- | --- | --- |
| Fresh local D1 receives 0025 once | **PASS** | `migration-apply.stdout.log`, `migration-list.stdout.log`; native D1 migration receipt in D1-01. Migration-history rows **25 → 26**. |
| Schema and indexes | **PASS** | D1-01: **18 columns**, quotation-item primary key, unique request/stable-line index and `idx_bill_purchase_cost_scope`. Schema **128 → 135 objects**: new table, explicit scope index and five triggers. |
| Existing schema and seeded data preserved by migration | **PASS** | `pre-migration.json` / `verify-migration.json`: all 128 old schema definitions retained; **33 pre-existing non-history tables / 56 rows** identical. Only the expected migration-history row was added; snapshots were not backfilled. Total recorded application/history rows **81 → 82** immediately across migration. |
| Established disposable baseline preserved | **PASS** | Before/migration/final schema and per-table row-digest comparisons: **3,476 rows / 34 application/auth/migration tables** unchanged. The baseline received no writes or 0025 application. Internal SQLite/Cloudflare metadata is excluded from this application-table count. |
| Read-only SQLite integrity / foreign keys | **PASS** | Fresh rehearsal database `integrity_check = ok`, zero foreign-key violations before migration, immediately after migration and after all runtime fixtures. |
| Direct `PRAGMA integrity_check` through D1 API | **NOT TESTED — D1 restriction** | Native D1 rejected it with `D1_ERROR: not authorized: SQLITE_AUTH`. Did not weaken D1 restrictions. Equivalent file-level integrity was checked read-only after runtime disposal; D1's supported foreign-key check also passed. |

New objects:

```text
bill_item_purchase_costs                    table
idx_bill_purchase_cost_scope                index
bill_purchase_cost_authority                trigger
bill_purchase_cost_no_delete                trigger
bill_purchase_cost_no_update                trigger
bill_purchase_cost_on_finalization          trigger
bill_purchase_cost_scope                    trigger
```

## Requested acceptance matrix

All results in this matrix are **new executions in this rehearsal**, except the referenced implementation semantics from the unchanged foundation report. In-memory regression results are identified separately from native Worker/D1 evidence.

| # | Requirement | Status | Test names / evidence |
| --- | --- | --- | --- |
| 1 | Apply migration to fresh disposable D1 | **PASS** | Schema-only fresh initialization, PRE-01, Wrangler application/list and `verify-migration.json`; new target only. |
| 2 | Verify schema and indexes | **PASS** | D1-01 — `0025 schema, indexes, foreign keys and migration receipt`; schema/index metadata and unchanged prior definitions. |
| 3 | Bill-line purchase-cost snapshot creation | **PASS** | D1-03, D1-08 and D1-13: server-finalization capture, box/loose costs and a two-line bill with two distinct quotation-item/stable-line identities. Pending bills have no snapshots. |
| 4 | Stall and season scope | **PASS** | D1-07 — `Stall/season IDs and Admin authority cannot expose historical costs or finalize`: wrong authorized stall and other authorized season return 404; Admin receives no internal summary and finalize returns 403. Positive Super Admin Stall B and positive second-season closure produce correctly scoped cost rows. |
| 5 | Snapshot immutability | **PASS** | D1-05 — UPDATE and DELETE reject with `bill_purchase_costs_immutable`; INSERT OR REPLACE rejects with `bill_purchase_cost_scope_or_duplicate`; original snapshot unchanged. |
| 6 | Duplicate finalization/retry protection | **PASS** | D1-06: three already-finalized retries return 200 and retain one snapshot/account. D1-12: three simultaneous first-finalization submissions return 200/200/200, resolving to one account, one snapshot and one closure event. D1-09: offline CLOSE and payment replay preserve one receipt per operation and one payment. |
| 7 | Historical missing costs return unavailable profit | **PASS** | PRE-01 + D1-02: bill finalized/paid before 0025 returns `available: false`, `historical_cost_unavailable`, null profit/subtotal; retry does not backfill. D1-08: new missing-rate snapshot stays unavailable after a later rate import. |
| 8 | Existing totals and payment calculations unchanged | **PASS** | D1-02 preserves pre-migration account/ledger balance. D1-04 preserves quotation **40,000 paise**, final due **17,000**, paid **3,000**, outstanding **14,000**. Frozen cost **12,002**, profit **4,998** remains unchanged after current-rate edits and payment. D1-10 confirms atomic rollback; existing payment/adjustment/offline regressions pass. |
| 9 | Focused 79-test evidence selection | **PASS** | Four exact groups below: **79 PASS / 0 FAIL / 0 cancelled**, with **45 explicit name-filter skips** outside the selected cases. No unrelated suites, npm pretest/migration hooks or audit commands ran. |

## Native runtime checks and data integrity

| Test | Status | Observed result |
| --- | --- | --- |
| PRE-01 — Historical bill finalized and partially paid before 0025 | **PASS** | Accepted due 17,000; payment 3,000; no cost table existed at finalization. |
| D1-01 — Schema/indexes/receipt | **PASS** | Native metadata verifies the new schema and migration receipt. |
| D1-02 — Historical bill unavailable / preserved | **PASS** | Null historical profit and unchanged pre-migration balance; no retroactive snapshot on retry. |
| D1-03 — Native finalization capture | **PASS** | Current purchase rate changed from 5,000 to **6,001** before finalization; quantity 2 captures unit 6,001 / line **12,002**. Profit uses the agreed due, yielding **4,998**. |
| D1-04 — Frozen costs / unchanged totals and payment | **PASS** | Later current rate **9,900** does not alter snapshot/summary; partial payment and quotation values remain correct. |
| D1-05 — UPDATE/DELETE/REPLACE denial | **PASS** | Three expected constraint failures; snapshot byte-for-value unchanged. |
| D1-06 — Repeated finalized retry | **PASS** | Three 200 replies, one snapshot/account. |
| D1-07 — Roles, stalls and seasons | **PASS** | Cross-context 404, Admin finalize 403, no Admin internal summary; positive Stall B cost **9,000** and independent operating-season snapshot. |
| D1-08 — Missing data and loose units | **PASS** | Missing-rate row remains null after import. Purchase pack cost **10,005**, saved divisor **10**, quantity **3** yields floor unit **1,000**, line **3,000 paise**. |
| D1-09 — Offline receipt/payment replay | **PASS** | One closure snapshot, **two receipts** (CLOSE/PAYMENT), **one ledger payment** after repeated operations; no duplicate bill. |
| D1-10 — Native transaction rollback | **PASS** | Temporary failure trigger rejects cost capture. Sync returns expected unconfirmed **503**; request remains pending at its prior revision, events unchanged, no account/snapshot/receipt. Diagnostic trigger removed afterward. |
| D1-11 — Native FK check / checkpoint counts | **PASS** | Native supported FK check empty; counts recorded at that checkpoint. File-level final integrity verified separately. |
| D1-12 — Simultaneous first finalizations | **PASS** | One new account/snapshot/closure event after three concurrent submissions. Successful replies converge on the same finalized bill. |
| D1-13 — Multi-item bill | **PASS** | Two distinct stable-line/item snapshots, each expected line count 2; frozen costs **10,005 + 4,000 = 14,005**, complete bill profit **2,995 paise** against due 17,000. |

Final read-only database verification after D1-13:

| Record type | Final rows |
| --- | ---: |
| Requests | 11 |
| Finalized payment accounts | 9 |
| Bill-item purchase snapshots | 9 |
| Payment ledger entries | 3 |
| Offline receipts | 2 |
| Workflow events | 68 |

Nine snapshot rows belong to eight newly finalized bills, including the two-line bill. The ninth finalized account is the historical bill intentionally lacking snapshots. Two requests remain pending: Admin-denial and injected-rollback fixtures. A missing-rate snapshot intentionally contains null cost. These are explained fixture states, not lost records or duplication. Final application/auth/migration tables: **35 tables / 226 rows**, integrity `ok`, FK violations **0**; the established baseline comparison still passes.

## Focused regression execution

| Selection | PASS | FAIL | Skipped |
| --- | ---: | ---: | ---: |
| `billPurchaseCostSnapshots.test.js`, `requestPayments.test.js`, `billAdjustmentsHandover.test.js`, `offlineSync.test.js` | 56 | 0 | 0 |
| `adminCustomerRequestFinalizeAgreed.test.js`, `adminBillingLocationApi.test.js` | 18 | 0 | 0 |
| `adminQuickBillAtomic.test.js`, filter `gate OFF\|legacy retries` | 2 | 0 | 21 |
| `handoverSync.test.js`, `requestWorkflowHistory.test.js`, filter `offline handover atomically\|Owner-first mixed Family Pack\|assignment captures` | 3 | 0 | 24 |
| **Executed selected tests** | **79** | **0** | **45 excluded by filters** |

Direct `node --test --test-concurrency=1` runs bypassed server npm migration lifecycle hooks. These 79 checks use fresh in-memory SQLite/mocks; they complement, rather than replace, the native runtime cases above. Raw TAP/stdout/stderr and exact argument arrays are retained. Focused lint of the new JavaScript rehearsal harness exits 0 without diagnostics.

## Evidence and tooling

Private evidence under `P25`:

- `schema-export.json`, `established-baseline-before.json`: baseline schema, migration history and hashed row preservation inventory; no business data copied into the fresh database.
- `wrangler.toml`, `migrations/0025_bill_purchase_cost_snapshots.sql`: fresh target binding and exact isolated migration copy.
- `migration-apply.stdout.log` / `.stderr.log`, `migration-list.stdout.log` / `.stderr.log`: actual Wrangler application/list results.
- `pre-results.json`, `pre-http-trace.json`, `pre-migration.json`: historical fixture result, sanitized HTTP trace and exact pre-upgrade table fingerprints.
- `verify-migration.json`, `verify-migration.log`: old schema/rows preserved, expected migration-history change, integrity and established-baseline preservation.
- `post-results.json`, `post-http-trace.json`: all 13 final runtime PASS cases with test names, scoped row evidence, expected denials, costs and balances. D1-11's row count is an intermediate checkpoint; `verify-final.json` is authoritative for final counts.
- `post-attempt-*.json`: retained prior checkpoint results, including the unsupported integrity-PRAGMA attempt; completed PASS cases were not re-executed on resumption.
- `verify-final.json`, `verify-final.log`: final integrity, FK, per-table row counts/hashes and unchanged established baseline.
- `regression-results.json`, each group `*.stdout.log` / `*.stderr.log`: exact 79-test results and explicit filter skips.
- `evidence-inputs.json`: source/bundle/migration SHA-256 identities, matching migration copy and actual runtime versions. `worker-bundle.mjs` is the tested bundle. `state.json` holds private fixture credentials and must not be published.

Added reusable, narrowly scoped rehearsal tooling only:

- [historical-cost-rehearsal.mjs](../server/scripts/historical-cost-rehearsal.mjs) — native fresh D1 setup, actual Worker HTTP cases, Wrangler migration, checkpoint resumption and exact focused regression selection.
- [historical-cost-rehearsal-db.py](../server/scripts/historical-cost-rehearsal-db.py) — manifest/path-verified read-only schema export and preservation/integrity checks.

Do not rerun preparation, PRE-01 or migration application against the retained fixture merely to inspect it. Use saved evidence; the harness supports explicit post-check resumption. No application source, migration SQL, package, lockfile or previous report was changed in this rehearsal.

### Harness diagnostics and their disposition

- Initial sandbox execution could not spawn child processes (`EPERM`); the authorized retry used the same isolated scope. The empty failed setup directory was retained separately.
- Fresh D1 created both its database file and `metadata.sqlite`; a harness assertion initially expected only one SQLite file. Excluded metadata from database selection and resumed fixture metadata without reseeding business rows.
- Initial login harness omitted the trusted Origin header; normal server security rejected it. Added same-origin Origin to the harness; no application security bypass or guard change occurred.
- After successful migration, a preservation assertion compared JSON lists with Python tuples. Corrected serialization and reran **read-only verification only**; 0025 was not applied again.
- Initial D1-11 attempted an integrity PRAGMA unavailable through D1. Retained that diagnostic, reported the direct API check NOT TESTED, and checked integrity read-only after disposal. Retained D1-01–10 PASS results and resumed only unfinished/additional checks.

These diagnostics do not conceal application failures. The accepted results rest on completed native Worker/D1 observations, actual Wrangler history and separate preservation checks.

## Remaining limits and verdict

| Boundary | Status / disposition |
| --- | --- |
| Migration 0025 on fresh isolated local workerd/D1 | **PASS** |
| Direct integrity PRAGMA via D1 | **NOT TESTED — unsupported API**; read-only SQLite integrity **PASS** |
| Deployed Cloudflare runtime/HTTPS/configuration parity | **NOT TESTED — staging/runtime access unavailable** |
| Physical Android installation/camera/network/device behavior | **NOT TESTED**; unchanged acceptance gap |
| Replaying the entire 0001–0024 chain on an empty database | **NOT TESTED in this phase**; existing pre-0025 schema was reused, not earlier migration suites |

Historical missing costs and unsupported Family Pack valuation remain intentionally unavailable. A configured purchase rate at server finalization is not procurement-lot/FIFO valuation. No data repair/backfill, new Reports/Settings workflow or deployment was performed.

**Final verdict: PASS for the requested isolated local 0025 runtime rehearsal.** No reproduced migration blocker remains in this scope. Any later target migration/deployment requires its own authorization and environment validation; overall release approval remains governed by the unresolved Reports/Settings, device and deployed-parity gates in the existing acceptance tracker.
