# Diwali project handover — 3 November 2026

**4 November 2026 status: NO-GO pending recovery, production/staging, device and formal sign-off gates.** Reports/Settings final local acceptance (17 cases) and G07 desktop fix acceptance now pass. Phase 1/8 formal sign-offs remain **NOT TESTED**. See the [dated evidence closure](FINAL_ACCEPTANCE_GAP_REVIEW_2026-11-03.md#phase-1-and-phase-8-evidence-closure--4-november-2026); the implementation/task descriptions below retain their earlier context. Next CRITICAL task is approval and disposable demonstration of the intended production backup/recovery mechanism, not repetition of completed tests.

This handover was prepared by documentation and targeted source inspection only. No tests, migrations, database access, deployment, Git commands or application/configuration changes were performed. Existing reports remain unchanged. Results below are **retained evidence**, not fresh executions. Anything whose current availability/state was not established is marked **NOT VERIFIED**.

## 1. Project, architecture and folders

The application supports a Diwali product/Family Pack storefront and authenticated multi-stall operations: requests, quotations, Quick Bills, finalization, payments, offline billing, signed QR handover, reports and settings.

- **Frontend:** React 19, React Router 7, Vite 8.3.3, Tailwind 4, JavaScript/JSX, Lucide icons; `qrcode` generation and `jsqr` scanning. Existing PWA shell plus scoped IndexedDB drafts/catalogues/outbox support offline operation.
- **Backend:** Cloudflare Worker at `server/src/index.js`, D1/SQLite, `jose`, password/session authentication and existing Access/local-auth paths. Routes use middleware authorization and scoped services; durable financial mutations use transactional batches/triggers, revisions, audits and idempotency identities.
- **Other boundaries:** signed Cloudinary upload parameters are server-generated. Frontend API resolution supports a local proxy and intended Vercel/Worker routing. Actual deployment topology, credentials and running services are **NOT VERIFIED** by this handover.
- **Local evidence stack:** Windows/PowerShell, Node 20.20.0, Wrangler 4.85.0, Miniflare 4.20260424.0 and workerd 1.20260424.1, as recorded in migration/runtime reports. Availability in another account is **NOT VERIFIED**.

| Folder/file | Purpose |
| --- | --- |
| `src/pages`, `src/components`, `src/data`, `src/utils`, `src/api` | Public application, static defaults and shared API/display helpers. |
| `src/admin/{pages,components,context,api,lib}` | Operational UI, authenticated workspace/session, scoped adapters and role/navigation rules. |
| `src/admin/offline`, `src/shared`, `public/offline-billing-sw.js` | Durable offline workflows, QR protocol and shell caching. |
| `server/src/{routes,services,middleware,lib}` | Worker routing, business operations, authorization, validation/calculations. |
| `server/database/migrations` | Versioned SQL; applied names belong to D1's `d1_migrations`. |
| `server/tests`, `tests`, colocated `*.test.js` | Backend, frontend/API and focused regression tests. Inspect isolation before execution. |
| `server/scripts`, `scripts` | Imports, audits, build/PWA and disposable acceptance harnesses. Some scripts can mutate data. |
| `docs`, `server/docs` | Acceptance evidence and implementation contracts. Newer dated reports supersede historical implementation statements. |
| `docs/report-evidence/standalone-reports-2026-11-03` | Portable Reports browser results, console/preservation JSON and four representative screenshots. |
| `server/wrangler.toml`, root/server `package.json`, `vite.config.js` | Configuration/lifecycle hazards; do not assume defaults target disposable resources. |

Root `README.md` is largely a scaffold. `server/README.md` still contains obsolete assertions that admin/password/quotation features are absent. Earlier location docs describe intermediate rollout stages. Use current implementation and the dated evidence below, not those stale statements, to determine feature status.

## 2. Multi-Stall requirements and invariants

1. Platform Admin provisions stalls and assigns initial ownership through the existing provisioning flow; operational Owner/Super Admin/Admin authority requires explicit stall **and** season membership. Platform/global role is not a tenant bypass.
2. A user can belong to multiple stalls with different roles. Effective authority is the **lesser** of season and location roles. Owner in A/Admin in B remains Admin in B. Removing/disabling A membership must not remove B access or globally revoke an otherwise valid session.
3. Last effective active Owner protection, self-removal/disable restrictions and existing invitation limits must remain. Existing location management cannot grant Owner or reset another account's global password; use the established provisioning/security controls.
4. Each stall independently owns products/categories, selling/purchase/X4 rates, supported stock status, embedded customer records, requests/quotations, finalized bills/payments, reports and settings. Modified IDs, filters or direct API requests must not read/write another business/stall/season or leak its counts/private fields.
5. Resolve business from the authorized stall, never a client business ID. Operational requests use confirmed `X-Admin-Location-Id` / `X-Admin-Season-Id`. Revalidate membership/roles in services and financial commit predicates; UI hiding is supplemental.
6. Transactions are stall **and operating-season** scoped. Permanent stalls intentionally reuse their location-owned catalogue across seasons; catalogue provenance is not permission to cross transaction seasons. Historical reads require explicit membership; archived business/stall/season/association rejects writes. Seasonal provisioning currently follows the existing 2026 flow; broader future-season provisioning is not promised.
7. Switching workspace clears transient UI/financial data; scoped IndexedDB/catalogues/drafts/outbox remain separated by business/location/season/user/device. Never move or delete pending operations merely to make a test appear successful.
8. Admin may create/edit supported operational requests and read permitted bill/payment information, but cannot alter privileged prices/discounts/purchase/profit, finalize or record payments/HOLD. Owner/Super Admin perform authorized financial operations. Purchase cost/profit/margin must not leak through any Admin API, history, QR, report or cache.
9. Stable line IDs, revisions, immutable bill/payment/cost snapshots, unique operation/payment IDs and atomic audit/receipt commits prevent duplicate retry effects and silent overwrites. Stale edits, competing QR claims and closures preserve conflicts. Independent requests should progress concurrently.
10. QR acceptance is provisional offline; cloud reconciliation is a separate authoritative step. Enforce intended recipient and business/stall/season, signature/certificate/catalogue/revision validity. Repeated scans/acceptances/retries must not create duplicate requests, claims, bills or payments.
11. Public tenancy comes only from trusted server `PUBLIC_REQUEST_BUSINESS_ID`, `PUBLIC_REQUEST_LOCATION_ID`, `PUBLIC_REQUEST_SEASON_ID` in location mode. An Admin selection or anonymous body/header cannot choose another public tenant. Invalid trusted mapping fails closed.
12. Preserve existing single-stall behavior and historical data. Stock **status** and customers embedded in requests are implemented; a standalone customer directory and quantity/movement ledger remain unimplemented/unverified requirements requiring a release-scope decision.

Relevant detailed contracts: `server/docs/ADMIN_LOCATION_CONTEXT.md`, `ADMIN_LOCATION_MEMBERS.md`, `PUBLIC_REQUEST_LOCATION_CONTEXT.md`; [Multi-Stall matrix](MULTI_STALL_ACCEPTANCE_2026-11-03.md), [payment ledger](PAYMENT_LEDGER.md), [offline billing](OFFLINE_BILLING.md), [QR handover](QR_HANDOVER.md).

## 3. Implementation and migration state

**0021–0026 are checked in and passed sequential application on a fresh disposable local D1.** This is not evidence of installation in an original, staging or production database. Those installed states are **NOT VERIFIED**; do not inspect them under this handover's authorization.

| Migration | Implemented purpose | Verified scope |
| --- | --- | --- |
| `0021_request_workflow_history.sql` | Revisions, stable line IDs, scoped immutable workflow history. | Local chain PASS; historical stable IDs backfilled without fabricating events. |
| `0022_request_payment_ledger.sql` | Immutable finalized accounts, append-only payment/HOLD ledger and summary views. | Local chain PASS; nine eligible historical accounts, zero invented payments. |
| `0023_offline_sync_receipts.sql` | Registered devices and atomic unique sync receipts. | Local chain PASS; no fabricated historical receipts. |
| `0024_qr_handover.sql` | Device keys, scoped claims and reconciliation guards/history. | Local chain PASS; no fabricated historical claims. |
| `0025_bill_purchase_cost_snapshots.sql` | Immutable scoped bill-item costs captured atomically at finalization. | Individual runtime rehearsal and full chain PASS; no historical cost backfill. |
| `0026_stall_settings.sql` | Independent location profiles, season schedules, revisions and immutable settings audit. | Full chain PASS; migration seeds no settings rows, defaults resolved without GET writes. |

The full-chain source was a verified pre-0021 disposable backup, not an empty imitation schema. Original-column values of **1,460 rows/24 tables** survived; final fixture has **139 schema objects, 35 tables, 27 migration records** (history includes two earlier 0010 filenames). Evidence: [full-chain rehearsal](MULTI_STALL_MIGRATION_CHAIN_REHEARSAL_0021_0026_2026-11-03.md). No further Reports migration was needed. Do not replay migration/preparation scripts against saved fixtures.

**Historical purchase costs:** `bill_item_purchase_costs` links exact quotation item/stable line/account and business/stall/season. Authoritative purchase rate is captured when server finalization commits; offline reconciliation does not trust an earlier device-time estimate. Box cost and saved loose-unit integer-floor rules are frozen. Historical profit = frozen final due − complete frozen costs. Absent/incomplete costs and Family Pack valuation return unavailable, never today's rate. Snapshot UPDATE/DELETE/REPLACE and retry duplication are blocked. Pending estimates remain explicitly labelled estimates. Main helper: `server/src/lib/billPurchaseSummary.js`.

**Stall Settings:** `/admin/settings`, `GET/PATCH /api/admin/settings`; `adminStallSettings` route/service, `AdminStallSettingsPage`, context/store and API adapter. Owner/Super Admin edit; Admin reads only. Profile/contact/canonical stall presentation is location-wide, schedule is location+season. Fields: stall name/label, brand, phone/WhatsApp, venue/address/details/map, dates/hours. Revisioned PATCH gives 409 on stale save; audit failure rolls back everything. After lost response reload/compare; do not blindly retry a settings write. Successful saves refresh authenticated workspace consumers. Original mapping `business-diwali/location-diwali-2026/season-2026` retains scoped static defaults; other stalls do not inherit its contacts.

**Reports:** `/admin/reports`; discovery `GET /api/admin/reports`, then `/sales-by-date`, `/bills`, `/collections`, `/products`, `/seasons`, `/profit`. Owner/Super Admin see all six; Admin sees only bill records and product quantities, with privileged quote/line values and monetary aggregate summaries removed. Every SQL statement rechecks live scope/authority. Dates use Asia/Kolkata `[from,toExclusive)`; sales use server finalization, collections default to receipt time with explicit occurred-time option. Page/limit pagination uses server totals. Season report covers selected season only. No frontend financial calculations, report persistence or pending-outbox revenue. Source: `server/src/{routes,services}/adminReports.js`, `src/admin/pages/AdminReportsPage.jsx`, corresponding API/lib files.

## 4. Testing tracker — preserve exact evidence scopes

No test was run for this handover. The linked matrices are canonical; counts overlap and must not be summed into a unique overall total. Historical FAIL attempts remain in source reports; later fixes/passes do not erase them.

| Phase/work | Recorded status and limits | Evidence document under `docs/` |
| --- | --- | --- |
| Original readiness | **NOT RELEASE READY** originally; checkout defect, 20 test failures and Vite advisory subsequently resolved. Not a formal Phase 1 sign-off. | [RELEASE_READINESS](RELEASE_READINESS_2026-11-03.md), [RELEASE_BLOCKER_FIXES](RELEASE_BLOCKER_FIXES_2026-11-03.md), [SERVER_TOOLING_SECURITY](SERVER_TOOLING_SECURITY_2026-11-03.md) |
| Phase 1 | **NOT TESTED — formal sign-off.** Authoritative release scope/owner/matrix and referenced standalone user-management audit remain unavailable; reusable PASS evidence is mapped without relabelling it. | [4 November evidence closure](FINAL_ACCEPTANCE_GAP_REVIEW_2026-11-03.md#phase-1-and-phase-8-evidence-closure--4-november-2026) |
| Phase 2 Multi-Stall | **13 PASS, 0 FAIL, 1 partially NOT TESTED**; Scenario 5 literally **NOT TESTED — partial**. | [MULTI_STALL_ACCEPTANCE](MULTI_STALL_ACCEPTANCE_2026-11-03.md) |
| Phase 3 Roles/Seasons/Isolation | **12 PASS, 0 FAIL, 0 NOT TESTED, 0 NOT IMPLEMENTED**, local requested matrix. The separate G07 desktop populated-cache demotion/revocation gap is now fixed and PASS; device boundaries remain open. | [ROLES_SEASONS_ISOLATION_ACCEPTANCE](ROLES_SEASONS_ISOLATION_ACCEPTANCE_2026-11-03.md), [G07 fix acceptance](CACHE_DEMOTION_RECOVERY_ACCEPTANCE_2026-11-04.md) |
| Phase 4 Billing/Payment | **38 acceptance rows PASS**, zero FAIL/NOT TESTED/NOT IMPLEMENTED in that local matrix. | [BILLING_PAYMENT_ACCEPTANCE](BILLING_PAYMENT_ACCEPTANCE_2026-11-03.md) |
| Phase 5 Four-Admin concurrency | **15 scenarios PASS**, zero FAIL/NOT TESTED/NOT IMPLEMENTED in verified desktop scope; four Admin profiles plus Owner/Super Admin, not physical phones/soak qualification. | [FOUR_ADMIN_CONCURRENCY_ACCEPTANCE](FOUR_ADMIN_CONCURRENCY_ACCEPTANCE_2026-11-03.md) |
| Phase 6 Offline QR/Family Pack | **11 PASS, 1 partial NOT TESTED**, no application FAIL; full phase **INCOMPLETE** for physical Android. Synthetic desktop camera is not device optics. Unsupported pack models remain **NOT IMPLEMENTED**. | [OFFLINE_QR_FAMILY_PACK_ACCEPTANCE](OFFLINE_QR_FAMILY_PACK_ACCEPTANCE_2026-11-03.md) |
| Phase 7 Security/regression | **PASS for isolated local scope**; both audits zero vulnerabilities at execution; six selected groups pass, no skips within selections. Android/deployed parity/unknown production-secret inventory **NOT TESTED**. Audit cleanliness today is **NOT VERIFIED**, not newly audited here. | [SECURITY_REGRESSION_ACCEPTANCE](SECURITY_REGRESSION_ACCEPTANCE_2026-11-03.md), companion JSON |
| Phase 8 | **NOT TESTED — formal sign-off.** Definition/matrix, risk dispositions and explicit approval remain missing; release decision is NO-GO. This handover is not a Phase 8 execution or approval. | [4 November evidence closure](FINAL_ACCEPTANCE_GAP_REVIEW_2026-11-03.md#phase-1-and-phase-8-evidence-closure--4-november-2026) |
| Historical cost foundation | Local implementation verified: **79 focused PASS**, with explicitly filtered exclusions in source. | [HISTORICAL_PURCHASE_COST_FOUNDATION](HISTORICAL_PURCHASE_COST_FOUNDATION_2026-11-03.md) |
| 0025 runtime rehearsal | **PASS**: pre-migration check + 13 post-migration runtime checks + 79 focused tests. Direct D1 integrity PRAGMA **NOT TESTED — D1 restriction**; read-only file integrity passed. | [HISTORICAL_PURCHASE_COST_MIGRATION_REHEARSAL](HISTORICAL_PURCHASE_COST_MIGRATION_REHEARSAL_2026-11-03.md) |
| Settings backend | **38 distinct selected PASS**: 18 new including native runtime, 20 existing consumer regressions. | [STALL_SETTINGS_BACKEND_IMPLEMENTATION](STALL_SETTINGS_BACKEND_IMPLEMENTATION_2026-11-03.md) |
| Full 0021–0026 chain | **PASS**: six sequential migrations, nine native checks, **117 focused PASS, 0 FAIL, 45 excluded by name filters**. | [MULTI_STALL_MIGRATION_CHAIN_REHEARSAL_0021_0026](MULTI_STALL_MIGRATION_CHAIN_REHEARSAL_0021_0026_2026-11-03.md) |
| Settings frontend | **38 PASS, 0 FAIL/skipped/cancelled; six browser scenarios PASS** in local scope. | [STALL_SETTINGS_FRONTEND_INTEGRATION](STALL_SETTINGS_FRONTEND_INTEGRATION_2026-11-03.md) |
| Reports backend | **60 focused PASS**, final affected 18-test rerun PASS; three native checks PASS. No migration. | [STANDALONE_REPORTS_BACKEND_IMPLEMENTATION](STANDALONE_REPORTS_BACKEND_IMPLEMENTATION_2026-11-03.md) |
| Reports frontend | **30 focused PASS, 0 FAIL/skipped; nine browser/API scenarios PASS**, 360px/390px layouts and exact value reconciliation. | [STANDALONE_REPORTS_FRONTEND_IMPLEMENTATION](STANDALONE_REPORTS_FRONTEND_IMPLEMENTATION_2026-11-03.md), `report-evidence/standalone-reports-2026-11-03/` |
| Combined final Reports/Settings gate | **17 cases PASS within the approved local scope.** Earlier plan below is completed; no final release approval or unsupported-model acceptance is implied. | [REPORTS_SETTINGS_FINAL_ACCEPTANCE](REPORTS_SETTINGS_FINAL_ACCEPTANCE_2026-11-03.md) |

The older gap review's “Reports/Settings absent” statements are historical and superseded by implementation reports. Its Scenario 5 disposition, pending device/parity gates and other unresolved evidence still stand until explicitly reconciled. No current reproducible critical application defect is reported by the latest completed local work; this is not proof about untested environments.

## 5. Immediate next task: final 17-case acceptance

Use the **exact case IDs from gap-analysis section 5**, with the subsequently approved implementation scope below. Final case-by-case mapping/sign-off is pending; this table is a task specification, not 17 new PASS results. Map reusable evidence explicitly as **retained**, execute only missing checks on fresh disposable copies, and record PASS / FAIL / NOT TESTED / NOT IMPLEMENTED with expected/actual results and artifacts.

| Case ID | Final closure focus / scope clarification |
| --- | --- |
| `REPORTS-01-REGISTER-TOTALS` | A/B known pending/void/finalized fixtures, multiple quotes/payments and agreements; exact server totals, one bill, pagination reconciliation and unknown legacy amount coverage. |
| `REPORTS-02-DATE-BASIS` | India-midnight inclusive/exclusive boundaries, server finalization versus collection receipt/occurrence, late payments and unknown dates. Creation-time sales filtering is not an existing contract; do not invent it. |
| `REPORTS-03-PAYMENT-BALANCE` | Unpaid/full/partial/multiple methods/modes, HOLD/release zero-money behavior and later current balance. Historical as-of balance is not implemented. |
| `REPORTS-04-ROLE-PROJECTION` | Owner A/Admin B, Super Admin, Platform-only; direct financial denials and no private values in body/summary/filter choices. |
| `REPORTS-05-FOREIGN-SCOPE` | Foreign business/stall/season/record filters, positive own reads, explicit historical membership, removed/forged authority. Only implemented filters/routes are in scope. |
| `REPORTS-06-UNITS-PROFIT` | Saved box/piece/fixed-pack units, frozen cost/zero cost/loss, current-rate changes, absent/Family Pack unavailable costs; no Final Price + ₹500 contribution or invented allocation/margin. |
| `REPORTS-07-SWITCH-PAGING-EXPORT` | Delayed responses, role/season changes, filter reset, multi-page rows/totals. Exports are not implemented; record that boundary, not export PASS. Offset paging is not a snapshot cursor. |
| `REPORTS-08-READ-ONLY-OFFLINE` | No business writes/cache leakage; offline/error/retry states, invalid filters and safe-integer overflow. Pending outbox is not finalized revenue. |
| `SETTINGS-01-INDEPENDENCE` | Independent A/B saved contacts/venue/schedules across reload; shared location profile versus separate season schedules; Platform singleton unchanged. |
| `SETTINGS-02-ROLE-ARCHIVE` | Owner/Super positive saves, Admin read-only/direct PATCH denial, foreign/disabled/revoked/Platform denial, archived writes and commit-time revocation. |
| `SETTINGS-03-VALIDATION-ATOMICITY` | Phone/map/date/length/unknown/security/financial validation; whole profile/schedule/audit rollback and trusted actor/scope/revision/server time. Do not assume extra device fields exist. |
| `SETTINGS-04-CONCURRENT-RETRY` | Same revision one winner/409 with retained edits, independent stalls, no-op save, lost response/reload and exactly one event. Settings uses revisions, not operation receipts. |
| `SETTINGS-05-SWITCH-OFFLINE` | Unsaved/late A values cannot save/populate B; online-only settings failure is explicit; existing QR/pack/outbox identities and financial values unchanged. Offline settings editing/version persistence was not adopted. |
| `SETTINGS-06-PUBLIC-CONSUMERS` | Approved workspace-only integration: public defaults stay unchanged and Admin B cannot retarget anonymous public A. Retain trusted-public-scope evidence; do not add a public Settings endpoint or claim public overrides passed. |
| `SETTINGS-07-SINGLE-STALL-COMPATIBILITY` | Original mapping defaults, no contact inheritance to B, missing-schema errors and explicit legacy-mode limitation; no implicit mode switch. |
| `SCHEMA-01-ADDITIVE-PRESERVATION` | Reconcile retained full-chain constraints/defaults/history/FK/audit proof and untouched fixture sources. **No new migration execution is needed or authorized for this acceptance task.** |
| `REGRESSION-01-TOUCHED-BOUNDARIES` | Reuse recorded focused passes; run only missing/affected route, scope, projection, consumer and calculation checks. Financial/QR/offline regressions only if a confirmed fix touches them. |

Suggested new output: `docs/REPORTS_SETTINGS_FINAL_ACCEPTANCE_2026-11-03.md` (proposed filename, not an existing report). Include the 17-case matrix, retained-versus-new evidence, Scenario 5 closure assessment, preservation checks and unresolved gates. If scope/evidence cannot support a case, leave it pending; do not implement optional features just to pass the plan.

## 6. Remaining work, in priority order

1. Complete the 17-case consolidated acceptance above without repeating whole phases or changing preserved sources.
2. **Retest Multi-Stall Scenario 5 narrowly for Reports/Settings** using reciprocal A/B positive and foreign-scope checks. Preserve the 13 completed PASS rows. Customer-directory/quantity-ledger requirements need explicit required/deferred decisions; their old NOT TESTED rows cannot silently become PASS.
3. Close additional gap-review evidence: populated privileged offline cache after demotion/removal (`G07`), approved disposable restore/application-compatibility rehearsal (`G08`), phase definitions/sign-offs (`G01`), and private evidence custody (`G12`). Resolve payment-documentation contradictions (`G11`) separately without rewriting historical acceptance reports.
4. Perform actual Android acceptance using [ANDROID_RELEASE_CHECKLIST](ANDROID_RELEASE_CHECKLIST.md): install/cold start/reboot/storage, physical optical normal/Family Pack QR, permission handling, offline closures/payments and reconnect/conflicts. **NOT TESTED** until real devices. Four-phone concurrency, if required, is separate from four desktop profiles.
5. Obtain explicit authorization and disposable staging/runtime access, then validate HTTPS/auth/CORS/cookies/proxy/PWA and D1 atomicity/scope parity (`G06`); controlled secret inventory/exposure attestation (`G10`) remains separate. Access currently unavailable in reports; availability now **NOT VERIFIED**. No production testing implied.
6. Representative-volume Reports/D1 performance, bounded CPU/latency, concurrent paging and recovery/soak qualification remain **NOT TESTED**. Agree datasets and acceptance thresholds before claiming performance guarantees.
7. Reconcile the final evidence tracker and formal Phase 1/8 scope; obtain explicit final **GO/NO-GO**. Current recommendation remains **NO-GO** for pending acceptance/device/parity gates, not because Reports/Settings are still absent.

## 7. Approved decisions and known limitations

- Both standalone Reports and independent Stall Settings are mandatory for 2026. Their local implementation is complete; final release acceptance remains separate.
- User explicitly chose **“Workspace consumers only; keep existing public defaults.”** Do not add anonymous Settings reads/public overrides without new authorization. Platform public-catalogue singleton remains global.
- Settings: location profile across seasons, schedule per location+season, Admin read-only, no new financial/security controls, no offline settings edit/outbox or automatic persisted-settings preparation.
- Reports: Admin financial aggregates denied; selected season only; no exports, as-of balance or negotiated-revenue allocation to products. Gross saved line values are not final bill revenue. Pagination is bounded offset pagination and can shift with concurrent writes.
- All monetary calculations use integer paise. Payment mode ONLINE/OFFLINE is independent of CASH/UPI/CARD/BANK/OTHER. HOLD is not payment. Final Price + ₹500 is reference-only.
- Historical cost capture occurs at authoritative server finalization; missing historical snapshots are not reconstructed. Family Pack purchase/profit valuation remains unavailable until approved. Current pending estimates are not historical results.
- Supported QR packs use complete fixed catalogue variants/snapshots. Custom substitutions/options, nesting/empty definitions, missing-history reconstruction, partial-legacy edits and offline pack unit-price overrides remain unsupported/safely rejected. Safe rejection PASS does not mean these features are implemented.
- Local runtime reports use compatibility date `2026-05-01`; earlier requested `2026-10-01` parity is untested. Checked-in `server/wrangler.toml` currently says `2025-04-01`; it is not the isolated harness config. Intended deployed date/configuration is **NOT VERIFIED**. Do not change flags/dates to conceal the discrepancy.
- Known dependency fixes: Vite 8.3.3 and server/tooling overrides esbuild 0.28.1, sharp 0.35.5, undici 7.30.1, ws 8.21.0. Phase 7 audits passed at execution; do not run forced upgrades from historical findings. Existing build chunk-size advisory is not a newly established blocker.

## 8. Environment and exact resumption precautions

Code workspace: `C:\naidu\Diwali`. Recorded disposable root, abbreviated `RUN`:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

| Recorded location | Use / caution |
| --- | --- |
| `RUN/isolation.json` | Recorded isolation manifest. May contain original-path metadata: compare strings only; never open that original DB. |
| `RUN/persist`, `RUN/backup` | Preserved disposable baseline and verified backup; treat as read-only sources, not new test targets. |
| `RUN/chain-687017a4` | Already-migrated 0021–0026 source fixture. New tests must clone it, never replay its preparation. Native final figures: 72 requests, 11 accounts, 2 ledger entries, 3 cost rows, 4 receipts, 1 claim. |
| `RUN/settings-ui-ac7f6ffb` | Completed Settings browser evidence and private profiles/state. |
| `RUN/reports-backend-18da0f10` | Completed Reports backend native evidence. |
| `RUN/reports-ui-e25c1111` | Completed Reports browser evidence: 22 screenshots, HTTP traces, checkpoints, preservation. Portable subset is in `docs/report-evidence`. |
| `RUN/p2-*` through `p7-*` | Earlier phase fixtures/evidence; see exact paths in the canonical reports. Diagnostic profiles can retain unsynced drafts; do not drain them. |

These paths are recorded evidence references. Their existence, current accessibility, running ports and transfer to a new account are **NOT VERIFIED** here. Temporary storage is not a durable archive. Private `state.json`, SQLite copies, cookies, passwords, device/root keys and browser profiles must remain in an authorized private handoff, never pasted into a chat or public report. New-account tool approvals/credentials are not assumed to carry over.

Resume sequence:

1. Read this file, current Reports/Settings implementation reports, the gap-analysis 17 cases, full-chain report and final gap review. Inspect current relevant source and any applicable local instructions before execution. Preserve existing documents and uncommitted work; do not use Git to reset/clean/discard.
2. Confirm the intended workspace and authorized private disposable artifact access. If artifacts are missing, stop dependent runtime work, mark it NOT TESTED and ask the user for an approved private fixture handoff or authorization to establish a replacement disposable source. **Never substitute original `.wrangler` data.**
3. Inspect harnesses before using them: `server/scripts/reports-frontend-rehearsal.mjs`, `reports-frontend-db.py`, Settings equivalents and report backend rehearsal. They contain account/machine-specific paths and checkpoint modes. Do not blindly run `prepare`, `browser-resume` or migration-chain scripts on saved targets.
4. Once the next testing task is explicitly requested, create a **new disposable copy/identity/config/persistence directory** from an authorized pre-migrated source. Validate resolved paths, schema prerequisites, source fingerprints and protected-table preservation. Use independent test browser profiles and normal password/cookie authorization; no personal profile or auth bypass.
5. Build only to an isolated output directory with environment-file loading disabled and local-only API routing as in prior harnesses. Default Vite/Worker commands can read environment files or target existing data. Historical ports 8793/5193 are not assumed live/free; native harnesses can use dynamic loopback ports.
6. Reuse verified cases explicitly; execute only gaps, checkpoint attempts and keep raw/sanitized evidence. After a confirmed minimal blocking fix, run only affected regressions. Verify sources/schema/business rows remained unchanged before writing a verdict.

**Lifecycle hazard:** server `npm test` and `npm run test:integration` have pretest hooks that apply migrations to default local D1. Do not run them for acceptance. Inspect individual tests and use direct `node --test --test-concurrency=1 <approved isolated files>` only when testing is authorized; not every test file is safe merely because it is a Node test. Windows sandbox `spawn EPERM` previously required explicit tool escalation for child processes/workerd/Chrome. Request that permission if needed; do not route around it.

## 9. Safety constraints requiring explicit separate approval

- No original local D1 or production access/modification, default `.wrangler` database use, deployment, remote D1 command, Git command or migration outside an explicitly authorized fresh disposable target. Current task authorizes **documentation only**, not execution of this plan.
- Do not change application/configuration/dependencies/migrations under this handover. No forced audit fixes, broad refactors, feature additions or UI redesign. A later acceptance task must separately authorize any necessary narrowly reproduced blocker fix.
- Do not modify/reinitialize existing test sources, clear site data/IndexedDB, delete backups, overwrite reports, force sync diagnostic outboxes, suppress conflicts, invent snapshots or estimate missing money to make a test pass.
- No secret values in reports/frontend/QR/public assets. Server root signing material and API credentials stay server-side; scoped device keys/private preparation have a different documented trusted-profile boundary. Unknown production secret inventory remains unverified.
- No physical-device, deployed-parity, performance, export, unsupported-feature or final GO claim based only on source inspection, mocked tests, desktop emulation, a 404, or another phase's PASS.

## FIRST ACTION IN NEW ACCOUNT

**Exact next task: “Diwali 2026 — Reports + Stall Settings Final Acceptance Testing (17 cases).”** Start with read-only review and evidence mapping; do not reimplement Reports/Settings or rerun migrations.

Suggested instruction to the new account:

> Read `docs/PROJECT_HANDOVER_2026-11-03.md`, the Reports/Settings implementation reports and section 5 of `docs/REPORTS_SETTINGS_GAP_ANALYSIS_2026-11-03.md`. Confirm safe access to the established disposable environment. Map all 17 exact case IDs to retained evidence, then execute only genuinely missing checks using the actual local Worker and fresh copies of the already-migrated disposable D1 with separate browser profiles. Follow the approved workspace-only public-settings policy and existing API scope. Create `docs/REPORTS_SETTINGS_FINAL_ACCEPTANCE_2026-11-03.md` with PASS / FAIL / NOT TESTED / NOT IMPLEMENTED, exact evidence, preservation results, remaining gaps and a narrow Multi-Stall Scenario 5 closure recommendation. No original DB/production access, migrations, deployment, Git commands, unrelated changes or repeated completed phases. Keep Android and deployed parity NOT TESTED until actually performed. If the private fixture is unavailable, stop dependent tests and request a safe handoff; never fall back to default/original D1. Do not declare final release GO while mandatory gates remain pending.
