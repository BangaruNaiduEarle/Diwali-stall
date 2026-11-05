# Reports & Stall Settings Final Acceptance — 3 November 2026

**17 consolidated cases PASS, 0 FAIL, 0 NOT TESTED within the approved local implementation scope.** This combines explicitly retained component evidence with **8 new Worker/native-D1 checks and 2 new desktop-browser checks**. These are different counting units and must not be added to earlier suite totals. This is not release approval. Physical Android, deployed parity and the other release gates remain open; the release recommendation remains **NO-GO**.

**Multi-Stall Scenario 5 recommendation:** close its Reports and Stall Settings gaps for the approved local scope. Keep the full scenario **NOT TESTED — partial** pending an explicit required/deferred decision for the standalone customer directory and quantity/stock-movement ledger. Preserve the other 13 Multi-Stall PASS rows and historical reports unchanged.

## Authority and evidence interpretation

Followed [PROJECT_HANDOVER](PROJECT_HANDOVER_2026-11-03.md), the exact 17 IDs in [gap analysis section 5](REPORTS_SETTINGS_GAP_ANALYSIS_2026-11-03.md#5-focused-acceptance-plan), subsequent implementation reports and the user's confirmation of this acceptance task. The handover's approved implementation scope supersedes the older gap analysis's proposals and statements that Reports/Settings were absent.

Settings integration is **authenticated workspace consumers only; existing public defaults stay unchanged**. Reports use implemented routes/filters and selected-season scope. Export, historical as-of balance, allocated product revenue, offline Settings editing/persisted-settings preparation and Family Pack cost valuation are not implemented. A PASS below does not claim those features exist. No optional feature was implemented to change a result.

Retained means evidence from an earlier execution, inspected and mapped here; it is not a new execution. No completed suite, migration chain or completed browser scenario was replayed. New means this task's actual bundled local Worker/native D1 or new Chrome-profile execution. Source inspection explains contracts but does not substitute for an execution PASS.

## Disposable safety verification — completed before case execution

Workspace confirmed: `C:\naidu\Diwali`. No applicable `AGENTS.md` was found in the inspected workspace/ancestor locations. The recorded disposable root, `RUN`, is:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

First inspected directory/file metadata, allowlisted manifest/state fields and configuration text, without opening a database. Reported this safety result to the user before proceeding to case mapping/execution. `RUN/isolation.json` supplied the original database path for **string comparison only**; that database was never opened or inspected. No default `.wrangler` database, production resource or remote D1 command was used.

| Established artifact | Binding identity | Verified access / disposition |
| --- | --- | --- |
| `chain-687017a4` | `DB = a5dade1b-278d-4079-b847-7593da4f0e93` | Already-migrated source; read-only clone input. |
| `settings-ui-ac7f6ffb` | `DB = a25f3417-8953-4e67-a892-a3ca159eee93` | Existing DB/evidence and 9 browser-profile directories accessible; retained, not launched. |
| `reports-backend-18da0f10` | `DB = f2085b0c-b1ea-4959-8fc5-2fcd1f01fe3a` | Existing DB, three runtime results and preservation evidence accessible; retained. |
| `reports-ui-e25c1111` | `DB = 3e353c8c-ce1a-41f1-9d67-3f14af5f81bc` | Existing DB/evidence and 24 browser-profile directories accessible; retained, not launched. |

Each established database resolved beneath its own disposable directory; none matched the original-path metadata. Database ancestry had no reparse points. All three component states referenced the same chain source. The chain config's ID matched its state, and all these IDs differed from the checked-in application ID `c2ae3b00-7356-4e54-97ba-e7b92ca79346`. No checked-in Worker configuration was used to launch tests.

New run, abbreviated `FINAL`:

```text
RUN\reports-settings-final-453dec2a
Binding: DB = 2e1a78c2-38f8-4857-a2cc-98f1fc921f3b
Source: RUN\chain-687017a4\persist\v3\d1\miniflare-D1DatabaseObject\b5f285591fc0798e55dbac6c3d7716d227383a51f8130fecd07e7f913232fd77.sqlite
Target: FINAL\persist\v3\d1\miniflare-D1DatabaseObject\8170f84fff3a60ed64a584daccd401af2ca4d242fb5a7e2c450384bfd184c68a.sqlite
```

The clone helper resolved paths, rejected linked ancestry/hardlinks, checked source/target separation and verified an exact SQLite-backup clone: **35 tables, 139 schema objects**. Source SHA-256 before and after: `234393d8d4e0078d6862ac176d5fb245ee38933c61dead1b23a49bde5b0d5b04`. The source connection used `mode=ro`. No migration or migration script ran, including in in-memory fixtures.

Runtime used explicit Miniflare local D1 persistence and random loopback ports, compatibility date `2026-05-01`, location mode enabled and local-auth bypass disabled. It did not load the application's Wrangler configuration or environment files. Password login/session cookies authorized normal HTTP requests. A separate fresh headless Chrome profile under `FINAL` verified its profile command line; nonlocal page requests were blocked. The frontend build used `configFile:false`, `envDir:false`, an isolated output directory and a same-origin local API proxy. No prior profile, personal browser, pending outbox or diagnostic conflict was touched.

The initial sandbox launch failed with `spawn EPERM`; approved escalated child-process execution enabled local workerd/esbuild/Chrome. The failed prepare directory `RUN/reports-settings-final-68948b2b` was retained, not reused or deleted.

## Retained evidence index

| Key | Canonical report and retained execution evidence |
| --- | --- |
| RB | [Reports backend](STANDALONE_REPORTS_BACKEND_IMPLEMENTATION_2026-11-03.md): 18 Reports tests within the recorded 60 focused passes, final affected 18-test rerun, native `D1-REPORT-01..03`; private `reports-backend-18da0f10/{runtime-results,http-trace,preservation}.json`. |
| RU | [Reports frontend](STANDALONE_REPORTS_FRONTEND_IMPLEMENTATION_2026-11-03.md): 30 focused passes, `REPORT-UI-01..09`; [portable browser results](report-evidence/standalone-reports-2026-11-03/browser-results.json), console/preservation JSON and screenshots. |
| SB | [Settings backend](STALL_SETTINGS_BACKEND_IMPLEMENTATION_2026-11-03.md): 17 named Settings tests, one native runtime test, 20 existing Platform/public-scope regressions (38 distinct selected passes). |
| SU | [Settings frontend](STALL_SETTINGS_FRONTEND_INTEGRATION_2026-11-03.md): 38 focused passes, actual `UI-01..06`; private `settings-ui-ac7f6ffb/{browser-results,http-trace,preservation}.json`. |
| CH | [Full 0021–0026 chain](MULTI_STALL_MIGRATION_CHAIN_REHEARSAL_0021_0026_2026-11-03.md): sequential migration/preservation evidence, native `CHAIN-01..09`, 117 focused passes with 45 name-filter exclusions. Reconciled only; not rerun. |

The existing native and browser result JSONs were inspected and agree with the named PASS rows in these reports. Earlier failures, filtered exclusions and limitations remain in their original evidence. SB/RB test files were read to verify precisely what their named assertions covered; they were not executed again.

## Final 17-case matrix

All amounts below are integer paise. Exact identifiers are retained even where their names mention features excluded by the approved implementation scope.

| Exact case ID | Result | Expected behavior | Actual / evidence: retained versus new |
| --- | --- | --- | --- |
| `REPORTS-01-REGISTER-TOTALS` | **PASS** | One bill per finalized account; pending/void/old quotations excluded; exact whole-set totals and page reconciliation; unavailable legacy amount explicit. | **New FINAL-01:** A has 3 unique finalized bills, total **26,100** across 3 one-row pages; B has 1 bill, **9,000**. Two old void quotations of 999,999 each, a pending request and a void request do not inflate sales. **Retained RB:** exact finalized amounts/discount-agreement basis, unknown legacy amount/date test and D1-REPORT-01; **RU-08:** UI values equal server values. |
| `REPORTS-02-DATE-BASIS` | **PASS** | India-midnight half-open ranges; finalization sales versus receipt/occurrence collections; late payments and unknown dates explicit. | **Retained RB:** `Asia/Kolkata date filters are inclusive/exclusive at midnight and preserve fractional seconds` selects 2 boundary bills / **34,000**; collections date test selects **5,000** received versus **0** occurred in that period, independently of earlier bill closure. Legacy date remains null with coverage. **New FINAL-10:** one 1-paise malformed-legacy-time fixture appears under null date for both collection bases; date filters exclude it and keep unknown coverage count **1**. Creation-time sales is not the contract. |
| `REPORTS-03-PAYMENT-BALANCE` | **PASS** | Unpaid/partial/full current balances; method independent of mode; HOLD/release zero money; later receipts update balance. | **New FINAL-02:** UNPAID → HOLD after 1,000 receipt → PARTIAL on release, received **1,000**, outstanding **16,000** → PAID, received **17,000**, outstanding **0**. Five payment methods across ONLINE/OFFLINE total **17,000**; two HOLD/release events excluded from payment count **5**. Separate bill remains UNPAID. **Retained RB:** late receipt-period semantics. Historical as-of balance is not implemented. |
| `REPORTS-04-ROLE-PROJECTION` | **PASS** | Owner A/Admin B stays Admin B; Super positive; Platform-only denied; no privileged response/aggregate/filter-choice values. | **Retained RB** discovery/auth and Admin projection tests, live demotion test, D1-REPORT-02; **RU-02** and API allowlist tests: Admin choices bills/products, four financial endpoints 403, Super profit 200, Platform-only 403. **New FINAL-04:** same-session B operational bill read succeeds with no monetary aggregate/privileged quote/cost/profit fields; B profit 403. |
| `REPORTS-05-FOREIGN-SCOPE` | **PASS** | Positive own reads; foreign business/stall/season records excluded/denied; historical membership required; forged/removed authority denied. | **New FINAL-04:** own A/B succeed; reciprocal bill filters **404**; cross-business bill selection **404 in both directions**; foreign products yield no rows; business/location/season query overrides **400**; revoked A **403**, same session's B **200**. **Retained RB** historical-season/membership and foreign-scope tests, D1-REPORT-03, RU-06. Only implemented filters/routes are claimed. |
| `REPORTS-06-UNITS-PROFIT` | **PASS** | Saved box/piece/fixed-pack units; frozen complete/zero/loss costs; missing/pack unavailable; no reference-price or invented allocation/margin. | **New FINAL-03:** saved box cost **6,001**, 10 pieces, floor **600** per piece × 3 = **1,800**; due **100**, profit **−1,700**, unchanged after current rate becomes 99,999. Zero-cost bill yields **9,000** profit. **Retained RB** box/piece/pack saved-line tests, known/missing coverage, CH-07/08; RU-01/08. Family Pack profit stays null; gross line values are not final bill revenue; Final Price + 50,000 is not an input. |
| `REPORTS-07-SWITCH-PAGING-EXPORT` | **PASS** | Late/foreign responses ignored; role/season/filter reset; multiple pages reconcile within documented pagination contract. | **Retained RU-04/05/06:** page traversal, held A response after B switch, lower B role/filter reset and season change; API generation guards also cover late season responses. **New FINAL-01:** three distinct pages retain total **26,100**. Exports are **not implemented**, and offset pagination has no snapshot/cursor guarantee under concurrent writes; neither is marked export/performance PASS. |
| `REPORTS-08-READ-ONLY-OFFLINE` | **PASS** | GETs cause no business writes/cache leakage; connection failures explicit; pending outbox excluded; validation/overflow safe. | **New FINAL-06:** all six GETs 200/no-store and exact hashes unchanged for **32 non-auth tables**. **FINAL-07:** actual Chrome offline transport produces error, removes results, retry recovers, Reports Cache Storage entries **0**. **Retained RB** invalid-filter and safe-integer-overflow tests (400 / safe 503), RU-05 error/loading and server-only results. No offline revenue or report persistence introduced. |
| `SETTINGS-01-INDEPENDENCE` | **PASS** | A/B contacts/venue/schedule persist independently; location profile shared across seasons with separate schedules; Platform singleton unchanged. | **New FINAL-05:** concurrent independent A/B saves 200, each profile/season revision **1/1**, distinct phones/venues/dates retained on GET. Browser in separately restarted runtime also loads A's saved phone. **Retained CH-04/05**, SB season-profile test and SU-01/02: independent seasons, canonical consumer refresh and global singleton unchanged. |
| `SETTINGS-02-ROLE-ARCHIVE` | **PASS** | Owner/Super saves; Admin reads only; foreign/disabled/revoked/Platform authority and archived writes denied, including at commit. | **New FINAL-05:** Owner A's Admin B PATCH **403**, Owner B's foreign A GET **403**, A/B own saves/readbacks 200. **Retained SB** explicit authority/archive tests and commit-time demotion rollback, CH-04, SU-02/03: Super save positive, forced Admin PATCH denied. No global-role bypass. |
| `SETTINGS-03-VALIDATION-ATOMICITY` | **PASS** | Phone/map/date/length/unknown/security/financial errors rejected; whole profile/schedule/canonical/audit rollback; trusted audit fields. | **Retained SB** validation (400/428), audit immutability and injected-failure rollback; CH-06 native safe 503 with all affected rows/revisions unchanged. **New FINAL-09:** 7 further oversized/detail/security/forged-actor/time inputs return **400**, all 32 non-auth table hashes unchanged; saved audit actor/role/business/stall/season and server timestamp correct. No unsupported device field is assumed. |
| `SETTINGS-04-CONCURRENT-RETRY` | **PASS** | Same revision one winner/409; loser retains edits; independent stalls; no-op/lost response creates no duplicate event. | **Retained SB** concurrent/no-op/stale tests, CH-05, SU-03/05: 200/409, local edits preserved, explicit reload; lost successful response yields exactly **one** audit event. **New FINAL-05:** independent simultaneous stalls both succeed with separate revisions. Revisions, not operation receipts, govern retries. |
| `SETTINGS-05-SWITCH-OFFLINE` | **PASS** | Unsaved/late A cannot populate/save B; online-only save failure explicit; financial/QR/pack/outbox state preserved. | **Retained SU-04**, store tests `late successful A save cannot replace B after a switch` and synchronous clearing; protected financial/QR evidence. **New FINAL-08:** actual Chrome offline save fails visibly, further saving paused until reload; reconnection/reload restores server phone, and all 32 non-auth table hashes unchanged. No offline settings outbox/version persistence is claimed. |
| `SETTINGS-06-PUBLIC-CONSUMERS` | **PASS** | Approved workspace changes refresh authenticated consumers; public defaults and trusted public tenancy unchanged; Admin B cannot retarget anonymous A. | **Retained SU-01/06:** workspace header/selector/contact/venue/schedule refresh; public WhatsApp/default stays original after workspace edits. **SB:** 6 Platform + 14 trusted-public-scope regressions retain PASS. Existing public scope derives only from server tuple, not Admin selection/body/headers. Current source boundaries inspected; public overrides/Settings endpoint were not added. SU public catalogue 503 is a documented fixture limitation, not public product-catalogue PASS. |
| `SETTINGS-07-SINGLE-STALL-COMPATIBILITY` | **PASS** | Original scoped defaults preserved; B inherits no contact; missing schema/legacy mode explicit; no implicit mode switch. | **Retained SB** original defaults/no-write, new-stall defaults, missing-schema and legacy 503 tests; CH-03, SU-06 original phone/date-label browser evidence and frontend legacy-mode tests. **New preservation:** original mapping and its pre-existing rows remain unchanged. Installed schema in original/deployed D1 remains unverified. |
| `SCHEMA-01-ADDITIVE-PRESERVATION` | **PASS** | Reconcile existing additive-chain constraint/default/history/FK/audit proof; leave source fixtures untouched; no new migration. | **Retained CH:** 1,460 original-column rows/24 historical tables survived, 27 migration records, defaults/no fabricated history, FK/immutable/audit/atomic proofs. **New clone and preservation:** source unchanged, schema/migration history unchanged, every pre-existing row retained across 32 non-auth tables, integrity `ok`, FK violations **0**, **11,104** preserved files unchanged. Zero migrations in this task. |
| `REGRESSION-01-TOUCHED-BOUNDARIES` | **PASS** | Reuse focused route/scope/projection/consumer/calculation evidence; run only missing/affected checks. | **Retained RB/RU/SB/SU/CH** focused passes with their original exclusions; new FINAL-01..10 cover identified gaps and reciprocal isolation. No application/config/dependency/migration edit or blocking application fix occurred. New harness lint/syntax and isolated frontend build pass. Financial/QR/offline suites were not replayed; protected rows/receipts/claims/snapshots are unchanged. |

## New execution details and preserved attempts

New fixtures are under business `final-453dec2a`, stalls `final-453dec2a-a` / `final-453dec2a-b`, existing disposable season `chain-2026`. New catalogue/membership/request/settings rows were added only to the fresh copy. Existing actors authenticated normally; new location grants preserve Owner A/Admin B and independent Owner B. Pre-existing rows were not changed to manufacture these scenarios. A membership disable/restore affected only a newly added grant.

`FINAL-01..06`, `FINAL-09` and `FINAL-10` are **8 distinct runtime checks**; `FINAL-07/08` are **2 browser checks**. Their order reflects checkpointed execution. The 1-paise unknown-time fixture in FINAL-10 was inserted after the recorded five-method collection checks; the earlier **17,000** collection expectation remains correct for its filtered bill. This is malformed legacy fixture seeding through guarded native D1 SQL, not a payment-API acceptance of malformed timestamps.

First runtime attempt passed FINAL-01, then the payment harness omitted `If-Match`; the server safely returned **428 `revision_required` before any payment write**. Corrected the harness to read/send the current revision. Saved the original attempt and resumed only unfinished checks, retaining FINAL-01. Later resumed only FINAL-10 after identifying the remaining timestamp-coverage gap. The earlier failure is retained as a harness error, not erased or classified as an application defect.

Build passed with the existing >500 kB chunk advisory. Targeted `oxlint` and `node --check` passed. An initial lint invocation incorrectly assumed ESLint was installed; the project's actual linter is oxlint, which was then used successfully. No dependencies were installed/updated. Browser console has **zero uncaught exceptions**. Existing generic API failure wording appears in offline error artifacts; errors/retry behavior passed, and no unrelated copy/UI change was made.

Added only the final report/evidence and acceptance tooling:

- [reports-settings-final-acceptance.mjs](../server/scripts/reports-settings-final-acceptance.mjs): guarded new fixture, actual Worker HTTP, checkpointed missing checks, isolated build and new-profile offline browser checks.
- [reports-settings-final-db.py](../server/scripts/reports-settings-final-db.py): read-only source clone, path/link guards, source/file/row/schema preservation. Existing rehearsal scripts unchanged.

These scripts contain account-specific disposable paths. Saved targets must not be prepared/reseeded or browser suites replayed simply to inspect results. Read the report and result JSON first. No server `npm test`/pretest hook, Git command, deployment, migration or original/production access occurred.

## Preservation and artifact custody

Final verification after all checks:

- Chain source snapshot and SHA-256 unchanged; existing baseline, backup, component DBs, state/evidence JSON and all 33 prior browser-profile directories preserved.
- Test-copy schema and all **27 migration records** unchanged. Every pre-existing row in **32 non-authentication tables** retained byte-for-byte; new fixture rows are allowed. Login/session/user bookkeeping is exempt only in the new copy.
- Six Reports GETs and both browser offline flows separately retained exact full hashes for all 32 non-auth tables, including settings, catalogue, packs, bills/payments/costs, offline receipts/devices/keys and QR claims.
- SQLite integrity `ok`, foreign-key violations **0**. No conflict suppression, site-data clearing, outbox synchronization or snapshot fabrication.
- **11,104** inventoried files unchanged, including preserved DB/evidence/profile files, pre-existing Markdown reports, application JS/JSX, migrations, dependency manifests/locks and checked-in config. This is a targeted inventory, not a claim to have hashed every workspace file.

Portable sanitized evidence: [evidence index](report-evidence/reports-settings-final-2026-11-03/index.json), [safety](report-evidence/reports-settings-final-2026-11-03/safety.json), [runtime checks](report-evidence/reports-settings-final-2026-11-03/runtime-results.json), [browser checks](report-evidence/reports-settings-final-2026-11-03/browser-results.json), [preservation](report-evidence/reports-settings-final-2026-11-03/preservation.json). The index records SHA-256 hashes for the portable files and final tooling/report.

Private `FINAL` artifacts retain `source-before.json`, `preserved-files-before.json`, state, traces, runtime attempts, initial/final preservation results, isolated build and new browser profile/screenshot. They are not copied into portable evidence: source rows/state/profiles can contain credentials/private data. Temporary storage remains temporary. This task does not close account-wide durable custody/reviewer-access gate G12.

## Scenario 5 recommendation and remaining gates

**Reports/Settings portion: recommend closure for approved local scope.** Positive A/B totals and independently persisted settings, reciprocal denied/excluded foreign records, same-user lower B authority, cross-business checks, live membership removal, frontend state handling and preservation provide positive implementation/isolation evidence. This supersedes their historical missing-route evidence for these two features only; earlier reports remain untouched.

**Full Scenario 5: keep NOT TESTED — partial.** Standalone customer directory and quantity/movement ledger remain unavailable requirements with no explicit release-scope deferral in the reviewed record. Existing embedded-customer and stock-status PASS results do not implement those models. The 13 other Scenario PASS rows are preserved. A formal scope decision can reconcile the remaining subrows; this report cannot silently promote them.

The following remain outside this acceptance and are **NOT TESTED/unresolved** as previously recorded:

- Physical Android install/reboot/storage/optical QR and device behavior, including any required four-phone concurrency. Chrome offline transport/emulation is desktop evidence only.
- Deployed HTTPS/auth/CORS/cookies/proxy/PWA/D1 parity and intended compatibility-date/configuration. Local date remains `2026-05-01`; checked-in `2025-04-01` and earlier requested `2026-10-01` differences were not changed or resolved.
- Representative-volume D1 latency/CPU, concurrent offset paging guarantees, recovery/soak thresholds.
- G01 Phase 1/8 definitions/sign-offs, G07 populated privileged-cache demotion lifecycle, G08 separately approved restore/application compatibility, G10 deployment-secret inventory, G12 durable private evidence custody; G11 payment prose reconciliation remains separate. Unsupported-model release decisions remain explicit.
- Exports, as-of balances, product allocation/margins, offline Settings persistence and Family Pack cost valuation remain **not implemented**, not tests passed by omission.

The 17-case local consolidation is complete. Final release GO is neither granted nor recommended while mandatory device, parity and other acceptance gates remain open.
