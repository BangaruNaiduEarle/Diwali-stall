# Restored Backup — Current Application Compatibility, 2026-11-04

**PASS — scoped local compatibility after upgrading a fresh copy of the restored 0020 backup through 0026.** Six sequential migration steps and six selected current Worker/native-D1 checks passed. All **1,460 original rows** retain their original-column values. Production recovery/cutover safety remains **NOT TESTED**; this is not deployment approval.

No original local D1 or production was accessed. No retained source backup/restoration artifact was modified. No deployment, Git command, unrelated regression run or application-code change occurred. Only this project report was added; temporary orchestration and results remain private below.

## Source, fresh target and preservation

`RUN`:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

Source is the successfully restored local D1 in `RUN/chain-32881104`, documented by the [restoration demonstration](DISPOSABLE_RECOVERY_RESTORATION_DEMONSTRATION_2026-11-04.md). Its saved verification is PASS, with 21 migration entries ending at 0020. **The source for this copy was that restored artifact, not a new restore directly from the original backup.**

New target (`D`): `RUN/chain-restored-e517d927`.

| Property | Actual value |
| --- | --- |
| Disposable D1 name | `diwali-chain-rehearsal` — fixture name only |
| New independent D1 ID | `60003066-848e-4ffc-9e73-3110d99aeb80` |
| Persistence | `D/persist/v3/d1` |
| Application database | `D/persist/v3/d1/miniflare-D1DatabaseObject/ee001ef25e2ffc378d1cdec88c0409825529e39e7140880a6cb5955a2e10931a.sqlite` |
| Runtime | Local Miniflare/workerd, Node 20.20.0, compatibility date `2026-05-01`; password/session auth enabled, local bypass disabled |

The retained restored file had a non-empty WAL. To preserve it without SQLite opening/changing the retained artifact's sidecars, copied its main file and WAL **as bytes** into `D/restored-input`, then used SQLite's backup API from that private staging copy into the new empty D1 target. The staged logical state and cloned target both match the retained restoration's complete `pre-chain.json` baseline: 75 schema objects, 24 tables, 1,460 rows, integrity `ok`, zero FK violations.

All files under the retained restoration directory—including database/WAL/SHM, metadata and evidence—were fingerprinted before and after. **Every fingerprint matches.** The retained original backup checksum also matches before/after. Existing helper source-preservation checks additionally report the established disposable baseline unchanged. Original local D1 and production were never opened; manifests' original-database paths were used only for exclusion checks.

## Exact execution and retained evidence reuse

Executed from `C:\naidu\Diwali`:

```powershell
node --experimental-global-webcrypto C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79\restored-current-app-20261104.mjs
```

That temporary orchestrator creates only the new target, handles the WAL-aware staged copy, and invokes the existing chain harness for migration:

```powershell
node --experimental-global-webcrypto server/scripts/migration-chain-rehearsal.mjs migrate C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79\chain-restored-e517d927
```

Internally each step exposes only the next unchanged migration file in `D/migrations` and invokes the installed local Wrangler with:

```text
d1 migrations apply diwali-chain-rehearsal --local --config <D>/wrangler.toml --persist-to <D>/persist
```

Here `<D>` denotes the exact fresh directory above, not an instruction to use another database. Per-step inspection must pass before the next migration; the orchestrator stops on migration/integrity/preservation failure. A final no-pending check ran without applying another migration.

For current-application checks, a temporary copy of the existing harness under D changes only import resolution and scenario selection. It bundles the actual current `server/src/index.js`, uses the fresh binding and normal authentication, and runs only CHAIN-01/02/03/07/08/09. CHAIN-04/05/06 settings mutation/race/audit-fault cases and the 117-test regression selection were **not run**; their [previous chain evidence](MULTI_STALL_MIGRATION_CHAIN_REHEARSAL_0021_0026_2026-11-03.md) is retained. Existing [Reports/Settings](REPORTS_SETTINGS_FINAL_ACCEPTANCE_2026-11-03.md) and [desktop G07](CACHE_DEMOTION_RECOVERY_ACCEPTANCE_2026-11-04.md) acceptance were not repeated.

Current Worker bundle SHA-256: `19644763a3ef91ff83fbacf7d6d8a40b3b03537b4ed6f60165dc91bbfd9fb785`. Exact child commands and source-entry fingerprint are in `D/compatibility-results.json`. Both migration and focused runtime invocations exited 0. No migration or integrity failure occurred.

## Migration results

All six SQL files match the earlier accepted rehearsal checksums. Original-column preservation, integrity and FK checks pass after **every** step.

| Migration | Result | Schema objects / history rows |
| --- | --- | --- |
| `0021_request_workflow_history.sql` | **PASS** | 92 / 22 |
| `0022_request_payment_ledger.sql` | **PASS** | 109 / 23 |
| `0023_offline_sync_receipts.sql` | **PASS** | 117 / 24 |
| `0024_qr_handover.sql` | **PASS** | 125 / 25 |
| `0025_bill_purchase_cost_snapshots.sql` | **PASS** | 132 / 26 |
| `0026_stall_settings.sql` | **PASS** | 139 / 27 |
| No pending migrations | **PASS** | Unchanged final history |

Final schema has **35 tables and 139 objects**; all **64 declared new objects** are present. The original 21 migration records remain intact, including both earlier 0010 filenames. Nine eligible historical payment accounts were backfilled; migration created **zero payment entries, receipts, QR claims, cost snapshots or settings rows**. Stable IDs were backfilled for 274 historical request lines without inventing old actors/devices/history.

## Targeted current Worker/D1 results

| Scenario | Result | Observed compatibility |
| --- | --- | --- |
| CHAIN-01 — migrated schema/history | **PASS** | Native D1 sees the six ordered migration names, required tables/indexes and historical stable line IDs. |
| CHAIN-02 — representative historical finalized bill | **PASS** | Actual authenticated quotation read succeeds; historical missing purchase-cost/profit remains explicitly unavailable, with no invented cost rows. |
| CHAIN-03 — original single-stall defaults | **PASS** | Original mapped contact/schedule defaults remain correct at profile/season revisions 0; no settings override or platform-singleton change. |
| CHAIN-07 — new billing/finalization/payment | **PASS** | New fixture bill captures cost 10,000 paise and profit 7,000; later rate change leaves snapshots frozen. Due 17,000, received 3,000, outstanding 14,000. Retry/finalization replay adds no duplicate snapshot/payment; wrong stall/season returns 404. |
| CHAIN-08 — signed mixed-pack offline reconciliation | **PASS** | New fixture HANDOVER/AGREEMENT/CLOSE/PAYMENT chain and retries retain one request identity, one claim, four receipts, one payment and two cost rows. Pack snapshot preserved; unsupported complete pack-profit valuation stays unavailable. |
| CHAIN-09 — final joint invariants | **PASS** | Platform settings unchanged, native FK check empty, cost/account scope mismatches zero. |

Fixture writes affected only new identities/catalogue/requests in D. After them, all 1,460 baseline rows across 24 original tables still match their original-column projections: **zero missing or modified**. Final totals include 11 payment accounts, two ledger entries, four offline receipts, one QR claim, three cost rows and zero settings rows. Read-only SQLite integrity is `ok`; FK checks are empty. No unsupported native D1 integrity PRAGMA was attempted.

## Evidence and reconciliation limits

Private artifacts under D:

- `clone-verification.json`, `pre-chain.json`, `sources-before.json`: new-copy lineage, empty-destination guard and original-row baseline.
- `retained-source-before.json`, `retained-source-after.json`: complete unchanged retained-artifact fingerprints and original backup checksum.
- `migration-results.json`, `verification-0021.json` through `verification-0026.json`, per-step stdout/stderr, `no-pending-migrations.stdout.log`, `verification-chain-complete.json`: sequential migration/checkpoint results.
- `runtime-results.json`, `http-trace.json`, `worker-bundle.mjs`, `focused-chain-runtime.mjs`: six selected real Worker/native-D1 cases and current artifact identity.
- `verification-final.json`, `compatibility-results.json`: final schema, preservation, FK/integrity and command/result summary.

Credentials, signing material and copied records remain private; do not reseed or replay migration/fixture modes against retained D.

**NOT TESTED / not established:**

- A production-provenance recovery artifact/mechanism, production restore/cutover or intended deployed-runtime parity. Local date `2026-05-01` does not resolve the documented target runtime discrepancy.
- Preservation of writes acknowledged **after this older backup's recovery point**. New successful test payments/receipts/claims are not recovered historical payments/receipts/claims; they do not demonstrate loss-aware reconciliation.
- Replaying real pending browser outboxes against a restored server that has lost acknowledgements; no browser/device workflow was executed here.
- An older fallback application binary, destructive schema downgrade, whole-chain atomic rollback, or interrupted-migration recovery. No failure-injection or unrelated suite was added.
- Retrospective reconstruction of missing historical purchase costs or unsupported Family Pack valuation; unavailable values remain intentional.

## Disposition and remaining CRITICAL blockers

**PASS:** fresh restored-copy upgrade through 0026, selected current Worker/native-D1 compatibility, representative/all-original-row preservation and integrity. **FAIL:** none observed. **NOT TESTED:** production recovery qualification and post-backup reconciliation described above.

The local “restore 0020 → upgrade → run the current Worker” compatibility gap is now demonstrated. It does not approve production migration or rollback. Remaining CRITICAL blockers:

1. Select/approve and attest the actual production backup/recovery mechanism, artifact/point, consistency/cutoff, custody and recovery owners.
2. Demonstrate loss-aware recovery for accepted post-backup bills/payments, receipts/claims and pending offline identities with the approved application/schema/runtime pairing and safe original-stall fallback.
3. Approve actual target/history/0020 mapping, exact production command/checkpoint plan, enforceable write controls and reopening/escalation authorization. Intended-runtime staging/configuration gates remain open.

**Deployment remains NO-GO. Production recovery and rollback are not declared verified.**
