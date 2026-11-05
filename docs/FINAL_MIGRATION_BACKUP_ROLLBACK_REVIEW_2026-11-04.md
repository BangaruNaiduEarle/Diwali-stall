# Diwali 2026 — Final Migration, Backup & Rollback Safety Review

Date: **4 November 2026**. **Decision: NOT SAFE TO APPROVE FOR DEPLOYMENT.** The unchanged 0021–0026 SQL chain has verified retained local compatibility/preservation evidence. Production prerequisites, recoverable production backup and production rollback/cutover safety are **NOT VERIFIED**. These are release blockers, not evidence that the local chain failed.

This is a documentation/evidence review only. No database was opened, including disposable databases, original local D1 or production. No migrations, SQL operations, tests, deployment, Git commands, infrastructure creation or application/configuration changes occurred. Reading migration SQL and comparing its checksums with retained evidence did not execute it. Only this report was created.

## Evidence reviewed

- [Full 0021–0026 chain rehearsal](MULTI_STALL_MIGRATION_CHAIN_REHEARSAL_0021_0026_2026-11-03.md), [0025 rehearsal](HISTORICAL_PURCHASE_COST_MIGRATION_REHEARSAL_2026-11-03.md), and [original readiness/backup report](RELEASE_READINESS_2026-11-03.md).
- [Production runbook](../server/docs/PRODUCTION_DEPLOY.md), [migration README](../server/database/migrations/README.md), [location rollout boundary](../server/docs/ADMIN_LOCATION_CONTEXT.md), [trusted public location configuration](../server/docs/PUBLIC_REQUEST_LOCATION_CONTEXT.md), and [compatibility-checker limitations](../server/docs/LOCATION_COMPATIBILITY_CHECKER.md).
- SQL files 0020–0026, checked-in `server/wrangler.toml`, and the relevant recovery limitations in the [gap review](FINAL_ACCEPTANCE_GAP_REVIEW_2026-11-03.md).
- Latest [Reports/Settings acceptance](REPORTS_SETTINGS_FINAL_ACCEPTANCE_2026-11-03.md) and [G07 fix acceptance](CACHE_DEMOTION_RECOVERY_ACCEPTANCE_2026-11-04.md), to avoid treating resolved local implementation/demotion issues as current blockers.

Private retained evidence root (`RUN`):

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

Read saved JSON/logs only: `RUN/backup-verification.json`; `RUN/chain-687017a4/{migration-results.json,evidence-inputs.json,verification-final.json,runtime-results.json,no-pending-migrations.stdout.log}`. Did not run their preparation, backup, restoration, verification or migration scripts. Did not open raw database snapshots or treat saved original-database path strings as permission to access them.

**VERIFIED — retained local evidence** means an inspected earlier result supports the bounded claim. **NOT VERIFIED** means the required production/recovery claim is not established by the reviewed evidence. A documented instruction is not an executed verification.

## 1. Migration order and compatibility

**VERIFIED — retained local evidence.** All six current SQL files have SHA-256 values matching `migration-results.json` and `evidence-inputs.json` from the accepted full-chain run. No migration-file drift was found.

| Ordered migration | Dependency and data effect | Retained result |
| --- | --- | --- |
| `0021_request_workflow_history.sql` | Requires the preceding auth/season/location foundation, including 0020. Adds audit/revision fields and stable line identifiers; backfills new line-link fields. Does not invent historical actors/devices/events. | PASS; 92 schema objects, 22 history entries. |
| `0022_request_payment_ledger.sql` | Uses 0020 scope/membership tables and 0021 revision/audit/line infrastructure. Adds immutable accounts/ledger and balance views. | PASS; 109 objects, 23 entries. Nine eligible historical accounts, **zero invented payments**. |
| `0023_offline_sync_receipts.sql` | Requires the scoped financial/workflow foundation. Adds device registrations, immutable receipts and commit-time authority guards. | PASS; 117 objects, 24 entries. No historical devices/receipts invented. |
| `0024_qr_handover.sql` | Requires 0023 devices and preceding request/workflow schema. Adds immutable signing-key registrations and QR claims with authority/history triggers. | PASS; 125 objects, 25 entries. No historical keys/claims invented. |
| `0025_bill_purchase_cost_snapshots.sql` | Intended after 0024; structurally uses payment accounts, quotation lines, saved units and current authority. Captures new finalized-bill costs; missing historical costs stay unavailable. | PASS; 132 objects, 26 entries. **No historical cost backfill**. |
| `0026_stall_settings.sql` | Follows 0025 in the chain; structurally depends on location/association/auth tables from the foundation. Adds independent settings and append-only events. | PASS; 139 objects, 27 entries. **No settings/default rows seeded**. |

The rehearsal started from a verified **post-0020, pre-0021** local backup. It applied the six files sequentially through local Wrangler, checked each step and ended with no pending migrations. Both earlier `0010` filenames are real history entries: 27 final entries is consistent with 21 existing entries plus six additions, not a numbering defect.

`verification-final.json` records integrity `ok`, zero FK violations, all 64 expected new schema objects present, and **1,460 original rows across 24 tables with zero missing/modified original-column projections**. The verified source backup and established disposable baseline remained unchanged. Native `CHAIN-01`–`CHAIN-09` results are PASS, including original-stall defaults and joint financial/QR/settings invariants. The recorded 117 focused regression passes were not rerun.

The migrations are not all data-free: 0021 updates newly added line-link fields and 0022 backfills eligible accounts. Preservation proves the inspected original-column values survived; it does not mean the database is byte-identical or that arbitrary production data matches the fixture. The chain result does **not** establish a fresh 0001–0020 rollout, production applicability or a reversible schema downgrade.

## 2. Production procedure and prerequisites

**PARTIALLY DOCUMENTED; safe production procedure NOT VERIFIED.** The runbook correctly requires checking remote migration history/target binding, warns that local and remote state can differ, requests a verified backup, and prohibits remote catalogue/rate imports. Those safeguards should be retained.

However, its migration order and post-apply checkpoint stop at **0011**, while the configured migration directory now contains the complete later chain. Its instruction to apply pending migrations is not a bounded 0021–0026 cutover plan. It also refers to a “rollback section” that does not exist. Its claim that `wrangler.toml` has no `[vars]` block is stale; the checked-in file has one.

The following prerequisites are **NOT VERIFIED** for production:

1. An authorized operator's redacted attestation of the exact account/database ID, Worker binding, migration history and prerequisite schema; no inference from the local database or checked-in database name.
2. Whether production already has 0020, and whether the original single-stall business/location/season mapping and memberships are correct. If 0020 is pending, its applicability is a separate gate: it contains exact baseline assertions, including 162 2026 products, 67 requests and three memberships. Those assumptions must not be bypassed or extrapolated from the later chain's post-0020 fixture.
3. An approved ordered rollout/checkpoint plan through 0026, handling any earlier pending files, partial completion, failure/resume boundaries and validation before reopening writes. No evidence establishes all six migrations as one all-or-nothing cutover. Manual statement replay/history manipulation is not a demonstrated recovery path.
4. A write-control plan covering checkout, admin mutations, payments, imports and offline sync, with a defined cutoff and reconciliation of pending client operations. There is no verified coordinated backup/migration/reopen window.
5. A pinned current application/Worker/frontend artifact and intended runtime/configuration, including the fixed G07 frontend. Recorded chain workerd used **2026-05-01**; checked-in Wrangler uses **2025-04-01**. Production/runtime parity remains unverified.
6. Explicit approval of location-mode activation and trusted public scope. Location mode requires `PUBLIC_REQUEST_BUSINESS_ID`, `PUBLIC_REQUEST_LOCATION_ID`, `PUBLIC_REQUEST_SEASON_ID`, plus valid associations and memberships. The recent isolated 503 investigation confirms missing trusted scope fails closed; it does not attest to production configuration.

## 3. Backup and restoration safety

| Claim | Review status | Evidence / limit |
| --- | --- | --- |
| Local consistent backup and WAL-aware capture | **VERIFIED — retained local evidence** | `backup-verification.json` records SQLite backup-API capture, logical/schema comparisons, SHA-256, integrity `ok` and zero FK violations for three local files. The readiness report records committed WAL inclusion and retained diagnostics for an earlier sidecar-related attempt. |
| Local backup can populate a fresh isolated upgrade target | **VERIFIED — retained local evidence** | The chain report restores the verified pre-0021 backup into an independently identified empty disposable target, then verifies historical rows through migration/runtime checks. This is meaningful restore evidence. |
| A current production recovery artifact exists and is complete | **NOT VERIFIED** | The reviewed manifest describes local files, not a production D1 recovery point/export. Production backup identity/time, consistency, coverage, retention and authorized custody are not attested here. |
| Production backup/restore operator procedure | **NOT VERIFIED** | The runbook says to export a verified backup but supplies no completed rollback section or approved production restore/cutover procedure. No evidence establishes the intended production recovery mechanism or its restoration semantics. |
| Restored current schema preserves post-cutover financial/QR/idempotency state | **NOT VERIFIED** | Local cloning/upgrade preservation is not a restore-after-failure drill involving newly acknowledged payments, claims, receipts and client outboxes. |
| Recovering application/version is compatible with the restored database | **NOT VERIFIED** | Same-version local operation after cloning does not prove the selected rollback binary works against the restored/migrated schema, or safely serves existing single-stall data after multiple stalls exist. |

A valid local backup is not proof of a recoverable production backup. Raw backup bytes were not opened or freshly checked in this review. An artifact filename or saved row fingerprint alone does not establish production provenance or a recoverable release cutoff.

## 4. Rollback and single-stall fallback

**NOT VERIFIED; do not approve a destructive down migration or flag-only fallback.** The retained reports explicitly leave down migration and production recovery cutover untested. These migrations create durable financial history, payment accounts, offline receipts, QR claims and cost snapshots; removing them would remove evidence needed to prevent duplicate or inconsistent recovery.

Existing evidence does support **current-code local single-stall compatibility**: `CHAIN-03` preserves original mapped defaults without new settings writes, and selected legacy checkout regressions pass. It does **not** prove that an old deployment binary is safe on the upgraded schema after multi-stall transactions, or that setting `ADMIN_LOCATION_MODE=0` is a safe rollback. The documented disabled-mode path uses season-only context, which is not a demonstrated isolation boundary for multiple stalls sharing a season.

The missing rollback decision must distinguish:

- **Before reopening writes:** which exact application/configuration can use which database schema/recovery point, and what verification permits reopening the original stall.
- **After new writes are accepted:** how every acknowledged bill/payment/audit/receipt/claim and pending offline identity is preserved or explicitly reconciled. Restoring an earlier point can discard acknowledgements and idempotency receipts; later retries can then recreate or conflict with work. No supported reconciliation/cutoff strategy is evidenced.

These are missing safety contracts, not authorization to implement or execute a recovery here. Do not assume transaction/audit-failure rollback tests are database restore tests; do not assume checkout retry tests validate replay after rollback has removed its receipt.

## 5. Can multi-stall deployment overwrite existing production data?

**Retained local preservation VERIFIED; production guarantee NOT VERIFIED.** The inspected chain does not seed a replacement catalogue, rewrite historical purchase costs from today's rates or initialize new-stall settings by overwriting original settings. Its scoped FKs, uniqueness/immutability guards and retained old-column comparisons are positive evidence. No corruption defect in the six unchanged migrations was identified by this review.

Nevertheless, target selection, prerequisite mapping, unbounded earlier pending migrations, mode/public-scope configuration and recovery handling are outside that proof. The existing runbook's ban on running catalogue/rate imports remotely is material: fixture preparation, seed/restore tooling and a production cutover are different operations. Nothing reviewed justifies pointing a disposable rehearsal/seed/backup script at production or replacing its database with a test snapshot.

Therefore the statement “multi-stall deployment cannot overwrite or corrupt existing production data” cannot be approved from this evidence. Approve only the narrower retained local result until the target-specific operational gates below are closed.

## Findings and exact remaining blockers

### CRITICAL

| ID | Finding | Required closure before deployment approval |
| --- | --- | --- |
| C1 | **Production recoverability NOT VERIFIED.** No attested production recovery artifact, completed operator restore procedure or matching production-recovery drill is evidenced. | Authorized operator supplies redacted backup/recovery-point identity and verification, consistency/cutoff/retention/custody details, approved restore procedure and disposable restoration evidence using the approved mechanism. Do not repeat the completed local chain merely to restate its backup PASS. |
| C2 | **Rollback after accepted writes NOT VERIFIED.** No selected fallback application/schema contract or preservation/reconciliation plan for new financial/QR/offline work. | Approve and demonstrate the exact recovery application/schema pairing and pre-/post-reopen strategy on disposable data; retain balances, audits, operation/receipt/claim identities and replay/duplicate-prevention evidence. Original single-stall fallback must retain scope isolation once other stalls exist. No destructive down migration or mode-flag shortcut is approved. |
| C3 | **Production migration/cutover authorization package incomplete.** Existing runbook ends at 0011, has no rollback section and does not establish the production 0020 prerequisite/target mapping. | Supply verified target/history/mapping attestation and an approved 0021–0026 runbook with earlier-pending-file disposition, backup/write-control checkpoints, partial-failure/resume rules, abort criteria and operator ownership. If 0020 is pending, separately establish its exact-state applicability without bypassing its assertions. |

### HIGH

| ID | Finding | Required disposition |
| --- | --- | --- |
| H1 | **Intended runtime/artifact/configuration parity NOT VERIFIED.** Rehearsed 2026-05-01 differs from checked-in 2025-04-01; no production candidate/rollback version manifest is supplied. | Pin the current candidate and fallback artifacts, intended compatibility/runtime and binding configuration; close the missing authorized staging parity checks. Current-code legacy tests are not an old-binary rollback qualification. |
| H2 | **Multi-stall activation and public fallback configuration NOT VERIFIED.** Trusted public tuple and operational mapping cannot be inferred from a successful admin/local migration run. | Record approved original-stall/public identities, memberships and mode rollout/fallback policy; verify those configured boundaries in authorized non-production runtime. Do not auto-select another stall/season or weaken fail-closed behavior to remove 503s. |

### MEDIUM

| ID | Finding | Required disposition |
| --- | --- | --- |
| M1 | **Durable evidence custody NOT VERIFIED.** Raw accepted evidence is referenced under a user temporary directory; present readability is not a retention/access guarantee. | Archive the private accepted manifests/logs with controlled access and reviewer handoff. Do not publish databases, credentials or signing material. Preserve historical diagnostics and avoid regenerating evidence by reseeding retained fixtures. |

**Exact remaining migration/recovery approval blockers:** C1 production backup/restore verification; C2 compatible loss-aware rollback and single-stall fallback; C3 target/prerequisite attestation plus approved cutover runbook; and resolution of H1/H2 for the intended deployed runtime and scope configuration. This review adds no requirement to rerun completed local migration/tests. Close the missing evidence only under separate authorization.

Reports/Settings local acceptance and G07 desktop fix acceptance are already PASS and are not reopened here. Physical Android and other previously documented final release gates remain outside this focused review and must not be silently promoted to verified.

**Deployment approval: NO. Migration SQL is supported for the rehearsed local baseline; production migration and rollback are NOT safe to approve on the available evidence. Release-ready status is not granted.**
