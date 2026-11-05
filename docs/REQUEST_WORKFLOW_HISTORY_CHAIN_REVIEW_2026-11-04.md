# Updated 0021 / restored-0020 chain review — 4 November 2026

**PASS in the focused disposable scope; no 0021 blocker found.** Production compatibility/recovery approval is not established by this result. No production, original local D1, existing database migration, deployment or other migration-file change occurred.

## Evidence and results

Command actually executed:

```text
node --test --test-concurrency=1 server/tests/requestWorkflowHistoryChainRuntime.test.js
```

Result: **4 Node entries PASS (3 scenarios plus parent), 0 FAIL, 0 skipped**, exit 0. Existing focused SQLite results from the preceding fix—14 PASS, 0 FAIL, 7 name-filter exclusions—were reused without rerunning them.

| Requested review | Result | Exact evidence |
| --- | --- | --- |
| Trigger syntax and SQLite/D1 compatibility | PASS | Whole updated 0021 compiled/executed in native Miniflare/workerd D1, compatibility date `2025-04-01` (current checked-in/live date). JSON metadata, null-safe `IS NOT`, nested revision update and scope/revision guards worked. Existing focused Python SQLite regression remains retained evidence for that engine. |
| Assignment fields and metadata | PASS | All eight fields tested individually before and after 0022–0027. Each stage includes null → value, value → different value, value → null: 24 updates/stage, 48 total. Each update produces exactly one `request_assigned` event and revision increment; all eight assignment before/after fields match the actual rows. Existing SQLite regression additionally compares the full metadata object and scope/actor/device snapshots. Status/finalization checks, closed-event priority, metadata shape and revision/safeguard definitions remain intact. |
| Actual restored backup ending at 0020 | PASS | Exact retained backup identity checked by SHA-256; opened `mode=ro&immutable=1` with query-only protection, restored with SQLite backup API into `:memory:`. Integrity/FK checks passed, with 21 exact history entries ending at 0020. Actual tables/data/trigger definitions were copied privately into a fresh nonpersistent native D1. Updated 0021 produced zero fabricated historical workflow events; historical requests retained revision 0 and null creator IDs. Original-column fingerprints matched. This does not use the minimal synthetic 0020 helper as a substitute. |
| Conflict with later 0022–0027 | PASS | All six unchanged migration files applied sequentially in the new D1; history bookkeeping ends at all 28 expected filenames. Updated assignment behavior still passes afterward; original-column fingerprints match, original history rows remain, and native FK check returns no violations. Source inspection found no later replacement/drop of `request_changed_history`. No broad payment/QR/settings acceptance suite was replayed; arbitrary service interactions are not newly certified. |
| Focused test coverage | PASS | Existing `requestWorkflowHistory.test.js:13–79` covers every specified assignment field, full metadata, revision increments and unrelated/no-op updates. New `requestWorkflowHistoryChainRuntime.test.js:97–137` repeats the relevant matrix against actual 0020 schema guards and the final later schema. Customer note/timestamp updates and same-value updates to status, finalization and every assignment field create no event/revision increment. |

## Isolation and exact identities

Read-only source recorded by the accepted recovery demonstration:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79\backup\5264016ce8a63a3f1f9239770b32628020abc7fe1141bfbdd036d824a8f8ea73.sqlite
SHA-256: 30541ce6067a9c3eac588d433f8f04f2fbc31fd00ff820d5c0d013c8c5f9f3b5
```

The source checksum matched both before and after. No retained restoration directory or existing database was migrated. Schema/data travel only through private process memory; no backup rows, credentials or database dump are printed or saved. SQLite internal sequence metadata is not copied into D1: application rows/schema and original migration records are imported, original column projections checked, then normal test-only history inserts recorded with each atomic migration batch.

Miniflare has no Wrangler/application configuration or environment-file loading, uses a stub Worker and random loopback port, and explicitly disables D1/cache/KV/R2/Durable Object persistence. It is disposed in `finally`. Only a synthetic request in the disposable copy is changed for the assignment checks. Approved child-process execution was used for Python/workerd.

Reviewed 0021 file SHA-256:

```text
80b2bb5ba23f42645dbc28df4a349cd0f1cf03ede4f1d3a54a985b35894a8e20
```

This evidence covers the updated checksum; older unchanged-file checksum claims do not apply to this edited migration.

## Remaining boundary

No remaining failure/blocker was reproduced for **0020-restored state → updated 0021 → 0027** in this focused native runtime. This is not a fresh production 0017 → 0020 qualification: 0020's fixture-season/count incompatibility on that separate entry path remains unresolved. Production backup/recovery, rollback/cutover and approval blockers remain unchanged; no production recovery or deployment PASS is claimed.

Changed for this review: only the new focused test file and this report. No migration was edited during this review.
