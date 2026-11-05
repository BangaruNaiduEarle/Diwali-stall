# Migration 0020 production-baseline assertion fix — 4 November 2026

**PASS in fresh in-memory SQLite and native D1 for the 0017 → 0018 → 0019 → revised 0020 path.** This resolves the identified mandatory-2099/fixed-count incompatibility in the SQL. It does not attest production data or authorize production migration/deployment. No existing database, retained backup or production resource was opened or modified.

## Exact changes

Only `server/database/migrations/0020_business_location_foundation.sql` changed among migrations:

- Lines 9–10: describe captured counts and optional non-target seasons.
- Line 132: require exactly one active `season-2026` with code `2026`; no requirement that `season-2099` exist.
- Lines 134–187: add `_0020_baseline_counts` after the existing original-table/history inventory checks. Capture total and season-2026 counts for categories, products, Family Packs, private rates, purchase rates, requests, quotations and season memberships, before ownership changes. Replace all eight fixed pre-data-count assertions with these captures.
- Lines 744–824: compare migrated season-2026 ownership counts and unchanged total counts against the captured baseline, including exact membership count rather than three. Structural identity cardinalities and schema/history counts remain unchanged; they are safeguards, not fixture business totals.
- Lines 836–838: generalize the unmapped-season safeguard to every season other than 2026.
- Line 1608: drop the new helper on success; failed execution relies on the same enclosing atomic migration/history batch.

Existing full typed original-row snapshots and comparisons, exact membership-copy comparisons (roles, disabled flags and timestamps), schema/history inventories, FK checks, relationship/ownership guards, identity-conflict checks, existing business/stall foundation creation and membership-copy logic remain unchanged. No fixture season, fixture membership or extra business seed was added to the migration. No other migration changed.

Revised 0020 SHA-256:

```text
088adb040c5b78c52984de4e2ea0c69a947cc793b9d1df183361f8d7f2f4de05
```

Older reports/checksum claims describe the previous file and remain historical evidence. Do not replay this revised file in an environment where the exact 0020 filename is already recorded.

## Focused checks

New test: `server/tests/locationMigration0020Baseline.test.js`. It uses the existing Python SQLite bridge with `:memory:` only. The starter applies the actual 0001–0017 files, records their 18 exact names (including both 0010 files), then adds synthetic business records only inside the test fixture. Actual 0018, 0019 and 0020 execute with normal history insertion, with later steps in atomic batches. No saved source database is used.

| Check | Result / actual evidence |
| --- | --- |
| Normal production-like path without 2099 | PASS: 15 categories, 3 products, 1 Family Pack, 2 private rates, 1 purchase rate, 2 requests, 1 quotation and 5 season memberships. Neither 0018 nor the revised migration creates 2099. Original columns/rows, rates, saved amounts, sequence values and original history entries retained; all 2026-owned records mapped to the original stall. |
| Variable/empty counts | PASS: zero transactional records with zero memberships, and separately ten memberships. No fixed three-user assumption. |
| Optional other season | PASS: synthetic season-2031 records and membership stay unchanged, unmapped and separate. No requirement for a special fixture season. |
| Rejected invalid states | PASS: inactive 2026; unapproved original column; unexpected migration name; conflicting foundation table; FK violation; cross-season parent; injected same-count original-value corruption. Each rejection leaves the pre-attempt schema/data/history exactly unchanged. |
| History-write atomicity | PASS: deliberate final duplicate history insertion rolls back all migration SQL, data changes and helpers in SQLite and native D1. |
| No replay | PASS: exact-filename selection skips an already-migrated disposable 0020 snapshot without executing the file or changing its fingerprint. A forced bypass also aborts atomically on the existing-foundation guard. The retained already-0020 backup was not opened, cloned, migrated or replayed. |
| Native D1 | PASS: actual pre-0018 schema/data imported from the fresh 0017 fixture into nonpersistent Miniflare D1, then actual 0018 → 0019 → revised 0020 applied at `2025-04-01`. Original records preserved; 21 migration names; five memberships; clean FK check; no helpers retained. |

Native runtime uses a stub Worker, random loopback port, no application/Wrangler config or environment-file loading, and explicitly disabled D1/cache/KV/R2/Durable Object persistence. Runtime and bridge processes are closed after execution. Approved child-process execution was used for Python/workerd.

## Commands and final results

```text
node --test --test-concurrency=1 server/tests/locationMigration0020Baseline.test.js
15 PASS, 0 FAIL, 0 skipped

node --test --test-concurrency=1 --test-name-pattern="native in-memory D1" server/tests/locationMigration0020Baseline.test.js
1 PASS, 0 FAIL, 5 top-level cases excluded
```

The second command reran only the native case after adding its explicit final-history-write rollback assertion. The completed SQLite cases were retained, not rerun. Do not sum these overlapping runs into a new distinct test total.

Diagnostic: the first native attempt failed because the test snapshot helper queried D1's protected `_cf_` internal table. The helper was corrected to exclude platform-owned objects, matching the migration's existing policy. No migration safeguard was weakened. The complete focused run then passed; the subsequent native-only run also passed with its added rollback assertion.

No production recovery PASS, production preservation guarantee, release GO or deployment authorization is claimed. Existing production backup/rollback/write-pause, configuration/security and formal execution approvals remain required. No full-chain or previously completed unrelated suite was repeated.
