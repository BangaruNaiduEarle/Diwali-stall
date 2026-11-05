# Disposable Recovery Restoration Demonstration — 2026-11-04

**PASS — retained local SQLite backup restored into a fresh local D1 target. Production recovery and intended recovery-application compatibility remain NOT TESTED.** No production/original local D1 was accessed. No migration or deployment occurred, no Git commands ran, and no existing database/evidence was overwritten.

## Mechanism and qualification

Read the [production cutover runbook](PRODUCTION_MIGRATION_CUTOVER_RUNBOOK_2026-11-04.md), [final safety review](FINAL_MIGRATION_BACKUP_ROLLBACK_REVIEW_2026-11-04.md), [local chain rehearsal](MULTI_STALL_MIGRATION_CHAIN_REHEARSAL_0021_0026_2026-11-03.md) and existing clone tooling.

The **intended production mechanism is not selected/attested in those documents**. The available demonstrated mechanism is local: a previously verified SQLite backup, restored with SQLite's backup API into an empty, separately identified local D1 persistence target. This task demonstrates that bounded mechanism; it does not designate it as the approved production mechanism or equate it with a remote D1 recovery operation.

Private evidence root (`RUN`):

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

Source: `RUN/backup/5264016ce8a63a3f1f9239770b32628020abc7fe1141bfbdd036d824a8f8ea73.sqlite`, selected from the existing isolation/backup manifests. Resolved path checks confined it to `RUN/backup`, excluded the original database path, and checked that the artifact was not a link. Only this backup copy was inspected/restored.

- File header: **SQLite format 3**, not a SQL text export.
- Current SHA-256 equals the retained backup manifest: `30541ce6067a9c3eac588d433f8f04f2fbc31fd00ff820d5c0d013c8c5f9f3b5`.
- Retained backup evidence records integrity `ok`, zero FK violations and **21 migration entries ending at 0020**.
- This is a **post-0020/pre-0021 local backup**. It cannot establish recovery of later payment-ledger, receipt, QR-claim, cost-snapshot or settings records. No production provenance/freshness is claimed.

The backup matches its baseline schema after restoration. The intended recovery application/version is unspecified; the current release's later features require schema beyond this backup. **Application compatibility is NOT TESTED.** No migrations were applied to manufacture a newer recovery schema.

## Fresh target and exact execution

Successful target (`D`): `RUN/chain-32881104`.

| Property | Actual disposable value |
| --- | --- |
| Local D1 name | `diwali-chain-rehearsal` — existing helper's fixture name, not a production name |
| New D1 ID | `91988567-c552-4e6b-9b8f-515790debf8a` |
| Persistence | `D/persist/v3/d1` |
| Database file | `D/persist/v3/d1/miniflare-D1DatabaseObject/5ea742c80c61fd600ab91a1aa55bc374aadb2bfb66835930adfd61a8d065139e.sqlite` |
| Runtime | Existing local Miniflare/workerd; compatibility date `2026-05-01` |

Commands actually executed from `C:\naidu\Diwali`:

```powershell
node --experimental-global-webcrypto server/scripts/migration-chain-rehearsal.mjs prepare
```

The existing **prepare-only** mode creates a new directory, D1 ID/configuration and empty local target. It initializes the binding with a stub runtime and invokes the existing `server/scripts/migration-chain-rehearsal-db.py` with arguments `RUN`, `D`, `clone`. The helper asserts the destination has no application tables, opens the backup read-only, restores with `src.backup(dest)`, then compares complete backup/target inspections. It also reads the established disposable baseline read-only; it never opens the original local D1.

No `migrate` or application-fixture/runtime acceptance mode was invoked. The following additional verifier was created only under the new target's evidence directory, then executed:

```powershell
node C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79\chain-32881104\verify-restored.mjs
```

This reopens **only the newly restored target** through native local D1 and performs SELECT/schema/FK reads. It uses a stub Worker, not the current application. It compares against the saved clone/backup baseline and creates `restoration-verification.json` exclusively (`wx`), refusing to overwrite it. Runtime is disposed afterward. These commands document the execution; do not replay the verifier/clone against retained D.

The first prepare invocation was blocked by sandbox `spawn EPERM` before cloning. Authorized execution outside the sandbox created a different fresh target and succeeded. The incomplete `RUN/chain-3c8128bc` was retained; no directory was deleted or reused. Both successful commands exited 0.

## Verification evidence

| Check | Result | Actual evidence |
| --- | --- | --- |
| Artifact format/checksum | **PASS** | SQLite header and manifest-matching SHA-256; same source hash after verification. |
| Fresh-target restoration | **PASS** | Existing helper reports `freshClone: true`, `originalOpened: false`; empty-destination guard and complete source/target inspection equality pass. |
| Schema | **PASS** | Native D1 returns **75 schema objects**, exactly equal to the saved source schema. |
| Migration history | **PASS** | All **21 exact filenames in order** match the backup manifest, including both earlier 0010 filenames and final 0020. No migration ran. |
| Data completeness | **PASS** | Clone helper compares all original row hashes; native D1 independently matches counts for **24 tables / 1,460 rows**. |
| Representative record fidelity | **PASS** | **25 native-D1 row hashes** match source hashes across categories, products, Family Packs, purchase rates, requests/items, quotations/items and platform settings. Private row values are not published. |
| Integrity and relationships | **PASS** | Clone helper's complete equality includes target SQLite integrity `ok` and empty FK results; subsequent native D1 FK check returns zero violations. No unsupported native integrity PRAGMA was attempted. |
| Source backup preservation | **PASS** | Source checksum unchanged; restoration writes only the fresh target. |
| Intended recovery application/schema pairing | **NOT TESTED** | No approved recovery application/version exists in the reviewed records; restored schema ends at 0020. No full application was launched or migrated. |
| Production mechanism, artifact and recovery cutover | **NOT TESTED** | No production access or operator attestation; local restore is not remote recovery evidence. |
| Post-cutover financial/QR/offline reconciliation | **NOT TESTED** | This older artifact predates the relevant new tables. No post-0026 recovery point or receipt-replay drill was substituted. |

Evidence under D: `wrangler.toml`; private `state.json`; `inspection-clone.log`; `pre-chain.json`; `sources-before.json`; `verify-restored.mjs`; `restoration-verification.json`. The last JSON contains actual target identity, commands, native schema/history/count results, representative hashes and source checksum. Credentials/random signing material and restored data remain private. Existing earlier evidence was preserved.

## Disposition and remaining deployment blockers

**PASS:** local backup format, fresh local D1 restoration and restored database fidelity/integrity. **FAIL:** no accepted restoration/data-integrity failure observed; the initial launch permission diagnostic is retained separately. **NOT TESTED:** intended production mechanism/application compatibility and loss-aware production recovery.

Deployment remains **NO-GO** until these blockers close:

1. An authorized operator selects/approves the intended production backup/restore mechanism and supplies an appropriate, attested recovery artifact/point and cutoff/custody information. This local artifact does not satisfy that production attestation.
2. Pin the recovery application/runtime/schema pairing and demonstrate compatibility on disposable/staging infrastructure; resolve the existing runtime-date discrepancy.
3. Demonstrate preservation/reconciliation of acknowledged bills/payments, receipts, QR claims and pending offline work after the recovery point, including safe original-stall fallback.
4. Approve the actual target/migration mapping, write-control mechanism, exact cutover/recovery command plan and reopening/escalation ownership.

**The local restoration component is demonstrated. Production backup/restore and rollback are not declared verified.**
