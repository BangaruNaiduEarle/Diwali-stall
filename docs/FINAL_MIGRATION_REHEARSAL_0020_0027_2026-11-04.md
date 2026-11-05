# Final post-0020 backup → 0027 rehearsal — 4 November 2026

**PASS — fresh disposable in-memory SQLite/native D1 only.** Final run: **7 Node test entries PASS (six checks plus parent), 0 FAIL, 0 skipped**, exit 0. No migration file, existing database, production resource or deployment configuration changed. Production was not accessed or deployed.

## Exact evidence

- Test: `server/tests/finalMigrationRehearsal.test.js`.
- Sanitized results: [94b2897c-97fa-4cad-922b-407503c21da2.json](report-evidence/final-migration-rehearsal-2026-11-04/94b2897c-97fa-4cad-922b-407503c21da2.json). Contains exact applied filenames/checksums, runtime, preservation totals, membership counts and check results; no row values, passwords, cookies or secrets.
- Runtime: native Miniflare/workerd D1, compatibility date **2025-04-01**, random loopback port, stub Worker. No Wrangler/application config or environment-file loading; persistence explicitly disabled for D1/cache/KV/R2/Durable Objects. Runtime disposed after the checks.
- Command: `node --test --test-concurrency=1 server/tests/finalMigrationRehearsal.test.js`.

Exact retained source:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79\backup\5264016ce8a63a3f1f9239770b32628020abc7fe1141bfbdd036d824a8f8ea73.sqlite
SHA-256: 30541ce6067a9c3eac588d433f8f04f2fbc31fd00ff820d5c0d013c8c5f9f3b5
```

Source checksum matched before/after. Opened only this backup via `mode=ro&immutable=1` with query-only protection, restored through SQLite backup API into a new `:memory:` connection, then privately imported its application schema/rows into a fresh nonpersistent native D1. No existing restore directory was reused. No original D1 or saved database was migrated. The copy is logical application data/schema, not a byte-copy of D1 engine-internal storage.

## Results

| Requested check | Result | Actual evidence |
| --- | --- | --- |
| 0020 already applied, never replayed | PASS | Source has **21 exact migration entries ending at 0020**. Pending selection contains only 0021–0027. No 0020 SQL was loaded/executed by this rehearsal; its existing history row and foundation remain preserved. |
| Sequential forward migrations | PASS | **0021 → 0022 → 0023 → 0024 → 0025 → 0026 → 0027**, each as a complete atomic statement/history batch. Each filename was absent before application. Final history is exactly the original prefix plus seven entries: **28** total, including both historical 0010 files. Original-row and FK checks pass after every migration. |
| Original records preserved | PASS | Every original-column projection for **1,460 rows / 24 application tables** retained, including original membership/role/disabled-state rows, settings, prices, requests, quotations, login/session records and history prefix. Every extra row in an original table is accounted for as a migration-history or explicitly created disposable fixture/authentication row. No historical workflow events fabricated by the seven migration applications. |
| Schema/FK/integrity | PASS | Final schema has **139 non-internal objects / 35 application tables**. Native D1 `foreign_key_check` has zero violations after each migration and at completion. Reconstructing the final native D1 application schema/data in a separate memory-only SQLite connection returns `integrity_check=ok` and zero FK violations. No unsupported native D1 integrity PRAGMA was used. No 0020 helpers remain. |
| Five logins/memberships per stall | PASS within stated scope | Existing Stall A had 3 memberships and B had 1. Added **2 A + 4 B synthetic accounts/memberships only in the disposable copy**, retaining all original accounts/memberships. Both stalls have **5 active memberships**; original shared memberships remain shared. No claim that the ten membership contexts represent ten distinct global logins. |
| Authentication/usability | PASS within stated scope | All **6 added synthetic accounts** authenticate through actual password/session services. All **10 membership contexts**, including retained members, authorize and read their selected stall. Actual privileged member-list services return only the five selected-stall members for **both stalls**. Existing passwords were preserved, not reset or supplied for sign-in. |
| Isolation | PASS | Each of ten contexts returns exactly its own-stall request IDs/count and cannot fetch the other stall's synthetic request. All **6 stall-exclusive synthetic accounts** receive **403** when selecting the foreign stall. No shared authorized login is incorrectly treated as forbidden from its other existing stall. |
| Final Rate default | PASS | After 0027, all copied/new membership grants remain zero; no automatic Admin Final Rate grants were introduced. This is a migration default check, not a repeat of the completed UI/permission suite. |

## Attempt history and limits

Initial attempt: migration, preservation, account and isolation checks passed, but the final logical-integrity export was incomplete because Python's Windows pipe decoding was not explicitly UTF-8. That attempt reported **5 PASS / 2 FAIL entries including the parent**; it was not accepted as a completed rehearsal. No migration/data defect was established. Corrected only the new harness's pipe encoding and used a fresh disposable copy for the successful final run. The final run also verifies both scoped member lists explicitly. No migration changed to obtain a pass.

This is schema/data and focused service acceptance, not browser/device acceptance, production recoverability, a live production baseline attestation or deployment approval. The separately qualified revised 0017 → 0020 path was not repeated: this rehearsal deliberately starts from the already-applied retained 0020 backup. Production recovery/cutover/security approvals and NO-GO status remain unchanged.

Files added for this task: the focused test, the sanitized JSON above and this report. All retained backups and migration files remain unchanged.
