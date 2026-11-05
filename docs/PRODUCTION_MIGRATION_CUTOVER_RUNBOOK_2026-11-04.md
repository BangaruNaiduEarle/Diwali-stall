# Diwali 2026 — Production Migration & Cutover Runbook

**Full-release planning update:** use the [0001–0027 production parity plan](PRODUCTION_PARITY_PLAN_0001_0027_2026-11-04.md) for the current complete target. It reconciles the recorded production history through 0017, includes 0027, and identifies 0020's mandatory fixture-season/count incompatibility. The through-0026 sequence below is retained historical planning context; neither document authorizes execution.

**Status: gated draft — NOT authorization to migrate or deploy. Production backup/restore and rollback are NOT VERIFIED.** Follow the [final safety review](FINAL_MIGRATION_BACKUP_ROLLBACK_REVIEW_2026-11-04.md); creating this runbook does not close its evidence blockers.

The [retained local chain rehearsal](MULTI_STALL_MIGRATION_CHAIN_REHEARSAL_0021_0026_2026-11-03.md) supports SQL order and local preservation only. The six files matched its saved checksums in the final review. Production account, database name/ID, actual binding, migration history, operator identities and exact production command set are **NOT VERIFIED**. Authorized operators must supply and approve these before execution. No production commands or credentials are inferred from repository/local fixture names.

This document was prepared without production/original D1 access, migrations, tests, code changes, deployment or Git commands. Steps below are future gated operator actions.

## 1. Exact migration sequence

Required entry state: approved preceding schema through **0020**, with the original stall's mapping and memberships verified. If 0020 or earlier migrations are pending, **STOP** for a separately approved prerequisite plan. The retained chain started after 0020; its exact-state assertions must never be bypassed to fit an unknown target.

Apply only missing, approved files in this order through the existing migration runner:

| Order | Exact file in `server/database/migrations/` | Checkpoint |
| --- | --- | --- |
| 1 | `0021_request_workflow_history.sql` | Revision/history infrastructure and stable line links; original-column values preserved. Historical actors/devices remain unknown. |
| 2 | `0022_request_payment_ledger.sql` | Accounts/ledger/balance views; only eligible historical accounts backfilled, no fabricated payment receipts. |
| 3 | `0023_offline_sync_receipts.sql` | Device/receipt tables and authority guards; no invented historical devices or receipts. |
| 4 | `0024_qr_handover.sql` | Signing-key/claim storage and guards; no invented historical keys or claims. |
| 5 | `0025_bill_purchase_cost_snapshots.sql` | Immutable cost capture for new finalizations; no reconstruction of missing historical costs from current rates. |
| 6 | `0026_stall_settings.sql` | Scoped settings/audit storage; migration seeds no settings/default rows. |

The approved command plan must control the pending-file scope and provide checkpoints. Do not assume a general “apply pending” command stops at one file. Do not split SQL into statements, replay applied files, edit migration history or use rehearsal/seed scripts on production. Do not assume six files form one atomic cutover. Record actual completed filenames after each approved step; stop on discrepancies.

## 2. Prerequisites and backup gate

**All items must be approved before writes are paused or migration begins.**

- **Target and baseline — NOT VERIFIED:** operator attests account/database identity, binding `DB`, actual migration history, original business/stall/season ownership, memberships and current data/schema baseline. Preserve both earlier `0010` filenames in history; do not infer applied state from numeric prefixes alone.
- **Candidate/fallback — NOT VERIFIED:** pin Worker/frontend artifacts, configurations and compatible schema versions. Candidate includes the [G07 durable-demotion fix](CACHE_DEMOTION_RECOVERY_ACCEPTANCE_2026-11-04.md). Resolve rehearsed compatibility date `2026-05-01` versus checked-in `2025-04-01`; obtain intended-runtime staging evidence.
- **Write control — NOT VERIFIED:** approve an enforceable pause for public checkout, admin financial/catalogue mutations, imports and offline synchronization. Preserve client outboxes; record pending bill/transfer/operation IDs. A mode flag is not a verified maintenance/write-control mechanism.
- **Production backup/restore — NOT VERIFIED:** approve the actual recovery mechanism, consistency/cutoff rules, recovery-point identity/time, complete schema/data coverage, integrity verification, secure retention/access and recovery owners. Require disposable restore/application-compatibility evidence using that mechanism. Agree recovery-point/time objectives and treatment of writes outside the recovery point.
- **Recovery decision — NOT VERIFIED:** approve pre-/post-reopen recovery branches in section 6, including preservation of acknowledgements, payment history, sync receipts and QR claims.

At the approved write pause, confirm quiescence, record the cutoff, obtain the production recovery artifact through the approved procedure, and verify it before proceeding. If consistency or recoverability cannot be established, **STOP**. Local SQLite backup/restore evidence is not production backup approval.

## 3. Protect existing single-stall data

Record target-specific counts and original-column fingerprints for catalogue/rates, requests/items, quotations/items, auth/memberships, settings and existing financial/QR records. Compare against this baseline after migration. Do not copy rehearsal row counts into production expectations.

Retain original IDs, ownership, prices, balances and settings. Allow only the documented migration effects above. Do not seed a replacement catalogue, run catalogue/rate imports, recreate the owner, reassign historical bills, reset settings or overwrite the database with a disposable snapshot. Preserve all backups and pending client records; never clear site data/IndexedDB or force-sync diagnostic outboxes as cleanup.

The retained original-stall defaults/legacy tests support current-code local behavior, **not** an old deployment binary's compatibility. Do not use `ADMIN_LOCATION_MODE=0` as an assumed rollback once multiple stalls share a season; season-only access has no verified multi-stall isolation guarantee.

## 4. Multi-stall cutover sequence

1. **Authorize:** release owner signs off target, backup/restore, runtime/artifact pairing, write controls, scope configuration and recovery plan. Missing approval/evidence means no execution.
2. **Pause and capture:** enforce the approved write/sync pause; retain pending identities and cutoff evidence; complete the backup gate.
3. **Migrate:** execute the approved sequence in section 1 against the attested target. Keep writes closed. Check completed history, schema and preservation at the agreed checkpoints.
4. **Stage the candidate under the pause:** use only approved artifact/configuration procedures. Do not expose new writers to an incomplete schema or assume old writers remain compatible with it.
5. **Validate the original stall first:** run the approved narrow verification in section 5 before admitting new-stall traffic. Keep its ownership/defaults intact.
6. **Activate approved scope:** confirm `ADMIN_LOCATION_MODE`, original/new stall associations and memberships, and trusted `PUBLIC_REQUEST_BUSINESS_ID`, `PUBLIC_REQUEST_LOCATION_ID`, `PUBLIC_REQUEST_SEASON_ID`. Actual values are **NOT VERIFIED**; obtain operator attestation. Missing/invalid public scope must fail closed, not select another tenant/season. Follow [trusted scope documentation](../server/docs/PUBLIC_REQUEST_LOCATION_CONTEXT.md).
7. **Verify boundaries, then reopen deliberately:** check permitted/foreign stall access and the candidate's first-party API/auth path. Release owner authorizes reopening; record the first accepted post-cutover write. Resume pending sync only under approved identity/reconciliation rules. Record bills, payments, receipts and claims during the initial observation window; stop on any mismatch.

Location-mode activation alone is not proof of isolation. This document neither authorizes new stall provisioning nor supplies an unverified rollout command.

## 5. Verification and stop conditions

Use approved target/runtime checks; these steps have **not** been executed in production by this task. Reuse completed local evidence rather than rerunning whole suites.

| Verify before reopening | STOP if |
| --- | --- |
| Applied filenames match the approved pending set through 0026; expected objects/constraints exist. | Missing/unexpected migrations, unknown partial completion or target/binding drift. |
| Original-column baseline matches; documented backfills only; supported integrity/FK checks are clean. | Historical row/ownership/amount changes, orphan rows or unexplained backfills. Do not assume every SQLite PRAGMA is supported by D1. |
| Original-stall catalogue/defaults, existing bills and authorized reads remain correct. | Existing stall data is missing, repriced, reassigned or inaccessible unexpectedly. |
| Approved scoped billing/payment/QR retry and authority checks retain one authoritative identity and correct balances. | Duplicate bills/payments/claims, missing receipts/audits, incorrect balance or cross-stall access. Any verification writes need explicit approval and must be recorded. |
| Fixed frontend's lower/revoked authority stays nonprivileged after offline restart; pending work survives. | Private pricing reappears, queued work disappears or unauthorized operations are accepted. |
| Public scope, auth/proxy and intended runtime match the approved manifest. | Public catalogue 503, scope ambiguity, cookie/auth failure or unapproved runtime/configuration difference. |

On any stop: keep or re-establish the approved write/sync pause, preserve evidence, and use section 7. Do not bypass constraints or improvise a rollback.

## 6. Loss-aware rollback decision

**No rollback path is verified or authorized by this document.**

| State at failure | Required decision |
| --- | --- |
| Before reopening; zero post-backup accepted writes proven | Consider only the approved, rehearsed recovery-point/application/schema pairing. Preserve pending clients. Verify restored data and scope before any reopening. Without that evidence, remain paused and escalate. |
| New writes accepted, or write status uncertain | Do not blindly restore an earlier point or redeploy an old unscoped app. Inventory accepted writes and acknowledgements since the recovery point. Obtain an approved preservation/reconciliation strategy; consider scoped forward recovery only if separately assessed and authorized. |
| Unknown/partial migration state or incompatible fallback | Remain paused. Establish exact completed state and compatible recovery options; no manual down migration, history edits or table/trigger removal. |

Rollback is unsafe when it can discard acknowledged payments/bills, audits, cost snapshots, QR claims or idempotency receipts; when offline clients can replay against missing receipts; when backup provenance/consistency is uncertain; or when the fallback exposes multiple stalls through season-only queries. Never reconstruct lost financial history from today's prices or silently treat all pending operations as new.

An application rollback does not reverse D1 changes. A database restore does not restore browser outboxes or automatically reconcile their acknowledgements. Define both sides before approving recovery.

## 7. Recovery and escalation

1. Release owner halts progression; authorized operator enforces the approved write/sync pause. If no safe pause is available, escalate immediately rather than attempting destructive recovery.
2. Preserve exact target identity, artifact/configuration versions, last completed migration, error/time, backup/recovery point, last accepted writes and relevant bill/payment/operation/claim IDs in private evidence. Keep credentials/signing material out of shared logs.
3. Escalate to the named release owner, database recovery operator and financial-data owner. **Names, authority and contacts: NOT VERIFIED; assign before execution.** Identify which recovery branch applies and whether loss can be excluded.
4. Obtain explicit recovery approval and the missing disposable/staging evidence. Execute only the approved procedure; recheck data fidelity, financial balances, receipts/claims, pending-client reconciliation, scope isolation and artifact compatibility before reopening.
5. Record the incident, recovery decisions and reopening authorization. An unresolved preservation or compatibility discrepancy remains a NO-GO.

### Remaining production/staging blockers

- Attested target/migration/0020 mapping and intended artifact/runtime/scope configuration, with staging parity evidence.
- Approved and demonstrated production backup/restore mechanism, recovery point, cutoff, custody and recovery owners.
- Rehearsed loss-aware recovery/application compatibility, including post-cutover acknowledgements, offline replay and original-stall fallback isolation.
- Enforceable write-control, approved exact command/checkpoint plan, and authorized post-migration verification/reopening procedure.

**Deployment remains NO-GO until these gates close. Backup/restore and rollback are not declared verified.**
