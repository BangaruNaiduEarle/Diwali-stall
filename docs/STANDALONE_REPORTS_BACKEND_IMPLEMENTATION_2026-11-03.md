# Standalone Reports Backend Implementation — 3 November 2026

**Implemented and locally verified the six requested read-only backend reports. No new migration is required.** This is backend acceptance, not completion of the standalone Reports frontend or final release approval.

Reviewed the [Reports & Settings gap analysis](REPORTS_SETTINGS_GAP_ANALYSIS_2026-11-03.md), [historical cost foundation](HISTORICAL_PURCHASE_COST_FOUNDATION_2026-11-03.md), [Settings backend](STALL_SETTINGS_BACKEND_IMPLEMENTATION_2026-11-03.md), [Settings frontend integration](STALL_SETTINGS_FRONTEND_INTEGRATION_2026-11-03.md), existing authorization, billing, payment, product and season implementation, and migration definitions. Existing acceptance reports remain unchanged and retain their original dispositions.

## Changed files

| File | Change |
| --- | --- |
| `server/src/index.js` | Dispatch the new Reports handler after authenticated settings routing. Existing handlers and business operations unchanged. |
| `server/src/routes/adminReports.js` | GET-only scoped report routes, no-store JSON responses and safe errors. |
| `server/src/lib/reportFilters.js` | Allowlisted filters, strict calendar/pagination validation and Asia/Kolkata boundaries. |
| `server/src/services/adminReports.js` | Scoped read-only SQL, live authorization, report calculations, coverage, pagination and role projections. |
| `server/tests/adminReports.test.js` | 18 focused calculation, authorization, isolation, legacy, Family Pack, date and read-only tests. |
| `server/scripts/reports-backend-rehearsal.mjs` | Actual bundled local Worker/native D1 HTTP rehearsal using a fresh copy of the established disposable fixture. |
| `server/scripts/reports-backend-db.py` | Guarded disposable clone, source/schema/financial-table preservation checks and SQLite integrity checks. |
| This document | Implementation contract, actual test evidence and limitations. |

No frontend, dependency, configuration, existing migration, existing test helper or existing report was changed. No Git command, deployment, production/original local D1 access or migration against an existing database occurred. Fixture migrations inside the focused tests affect only newly created SQLite `:memory:` databases. Native testing copied an already-migrated disposable fixture and applied **no migrations**.

## APIs and permissions

Every route requires the existing authenticated workspace, `X-Admin-Location-Id` and `X-Admin-Season-Id`. The server resolves business ownership from the selected stall. Body/query IDs never grant scope. Platform status and global user role alone grant no operational access; the lesser season/stall membership role applies.

| GET route | Content | Owner / Super Admin | Admin |
| --- | --- | --- | --- |
| `/api/admin/reports` | Available report names and authorized scope/timezone | All six names | `bills`, `products` only |
| `/api/admin/reports/sales-by-date` | Finalized bill count/value by business date | Allowed | 403 |
| `/api/admin/reports/bills` | Finalized bill register, recorded parties, frozen due and current payment balance | Allowed, including recorded quote total/adjustment | Operational per-bill due/balance only; quote/adjustment fields and aggregate monetary summary omitted |
| `/api/admin/reports/collections` | Actual payments by date, method and recording mode | Allowed | 403 |
| `/api/admin/reports/products` | Saved product/pack line quantities by identity, recorded name and unit | Quantities and saved line gross values | Quantities only; line monetary values omitted |
| `/api/admin/reports/seasons` | Selected season's finalized sales | Allowed | 403 |
| `/api/admin/reports/profit` | Historical bill profit and cost coverage | Allowed | 403 |

Admin financial aggregates are default-denied as required by the gap analysis: existing per-request read permission does not approve new financial aggregate access. No purchase cost/profit/margin is exposed in any Admin report. Ordinary SQL itself suppresses privileged quotation/line values using the live effective role, in addition to response projection. Only the authorized profit route queries the cost table. Reports never query current purchase or private rates.

The season report intentionally returns **only the selected authorized season**, including a zero-sales row when that season has no eligible bills. Another season requires a separately authorized context/request; there is no all-seasons or all-stalls expansion. Explicit readable archived membership permits GET; existing archived-write guards remain in force. Reports in explicitly configured legacy/unscoped mode return 503 `location_required`; existing legacy billing/settings behavior remains unchanged. Single-stall installations using the established scoped workspace use the same routes without a new setting.

Every report SQL statement contains a live authorization CTE checking the enabled user, season/stall memberships, association, business/stall/season statuses and effective role. Summary, count and page queries execute in one D1 batch. Captured privileged context cannot bypass a subsequent membership demotion. Missing, ineligible and foreign `requestId` filters all return 404 within an otherwise authorized workspace. Invalid scope/membership returns 403. Report routes are GET-only; authorized active-context non-GET requests return 405, and archived writes can be rejected earlier with 403 by the existing guard. Responses use `Cache-Control: no-store`.

## Filters, dates and pagination

- Common filters: `from=YYYY-MM-DD`, `toExclusive=YYYY-MM-DD`, `page` (default 1, maximum 10,000), `limit` (default 25, maximum 100), and optional finalized `requestId`.
- Dates are business dates in **Asia/Kolkata**. Start is inclusive; end is exclusive. Example: `from=2026-11-04&toExclusive=2026-11-05` becomes `[2026-11-03T18:30:00.000Z, 2026-11-04T18:30:00.000Z)`. SQL preserves fractional seconds at the boundary.
- Sales, bills, products, seasons and profit use `dateBasis=finalized` only. Authoritative time is the recorded `closed_at`, with a scoped `request_closed` event's server receipt time as fallback. Creation/update timestamps, device times and payment-account migration time do not substitute for finalization time.
- Collections use `dateBasis=received` by default; `dateBasis=occurred` explicitly selects recorded payment occurrence time. Filter payments by that timestamp regardless of the bill's finalization date. Additional filters: `paymentMethod=CASH|UPI|CARD|BANK|OTHER`, `recordingMode=ONLINE|OFFLINE`.
- Products additionally allow `productId` or `familyPackId` (mutually exclusive), and `unitType=box|piece|unknown`.
- Invalid dates, reversed/equal ranges, unsupported/repeated filters, arbitrary scope override queries and invalid pagination return 400. Accepted calendar years start at 1970. No user SQL identifiers or sort expressions are interpolated.

Responses identify scope, timezone, currency, normalized date boundaries, date/value basis and generation time, then return `summary`, `rows` and `pagination: {page, limit, total, totalPages}`. Grouped report pagination counts groups; bill/profit pagination counts bills. Full summaries cover the complete filtered set, independent of the requested page. Ordering includes deterministic identity keys. Empty pages do not change totals.

An unknown finalization date stays null and appears in an unfiltered unknown-date bucket. Date-filtered rows exclude it; `unknownFinalizationDateBillCountInScope` discloses the scope-wide coverage gap. Collections similarly disclose `unknownTimestampPaymentCountInScope` for the selected timestamp basis. These coverage counts are scope-wide, not totals for the filtered page.

## Calculations and existing schema

| Report / metric | Recorded source and rule |
| --- | --- |
| Eligible sale | `customer_requests.status='closed' AND finalization_status='finalized'` in the authorized stall/season. Drafts/unfinalized requests are excluded. |
| Finalized sales value | Immutable `request_payment_accounts.amount_due_paise`, counted once per bill. Quotation totals, reference prices and payment joins cannot replace or multiply it. |
| Missing historical amount | Bill stays visible with null due; `unavailableAmountBillCount` increases. `knownAmountDuePaise` is explicitly the known subset. Complete `amountDuePaise` is null when any selected bill lacks a reliable amount. No amount is invented from current rates or old quote totals. Missing account also yields null payment status/outstanding rather than an asserted payable debt. |
| Bill record | Recorded reference/customer, creator user ID, current recorded handover recipient ID, finalizer email, finalization time and scoped account quotation ID. Fields missing in historical records remain null; this is not a reconstruction of full handover history. |
| Bill balance | Existing scoped `request_payment_summaries`: actual received/outstanding/status at report generation. These are **current balances of the selected bills**, not historical as-of balances. |
| Collections | Sum integer-paise ledger entries with `entry_type='PAYMENT'` once each. HOLD/RELEASE_HOLD contribute no collections. ONLINE/OFFLINE recording mode remains separate from payment method. |
| Product sales | Only saved `quotation_items` for the finalized scoped account quotation; no catalogue repricing. Product or saved pack identity/name/unit, bill/line counts and quantity. Boxes/pieces are distinct groups; components are not counted as extra pack sales. |
| Product monetary value | Saved `line_total_paise` before bill adjustment/agreed-price effects, explicitly labelled `recordedLineSalesPaise`. It is not allocated final revenue. `allocatedFinalRevenuePaise` remains null for privileged callers; no discount/agreed amount allocation is invented. |
| Historical cost | Only immutable `bill_item_purchase_costs` matched to scoped bill/quote, exact quotation item, stable request line, product, quantity and unit. All expected saved lines must have valid complete snapshots. Legitimate recorded zero costs remain valid. |
| Historical profit | Frozen final due minus complete frozen line costs. No current catalogue purchase rate, private rate or estimate. Historical absent/incomplete cost gives `costAvailable:false`, null cost/profit and `historical_cost_unavailable_or_incomplete`. Any pack/unknown product line keeps that bill's profit unavailable, even if a numeric pack cost is present. |
| Profit aggregates | Complete totals `purchaseCostPaise` / `profitPaise` are null if any selected bill is unavailable. `completeCostBillCount` / `unavailableCostBillCount` expose coverage. `knownPurchaseCostPaise` / `knownProfitPaise` describe only complete-cost bills, not estimated full totals. Empty complete sets total zero. |
| Arithmetic | Integer paise, safe-integer checks on numeric output and safe failure on SQL overflow. No floating-money rounding. Existing snapshot loose-unit rounding is preserved. Final Price + ₹500 is never a report input. |

Existing migrations 0020–0025 already supply scoped transaction tables, immutable accounts/ledger, payment summary views and immutable cost snapshots; 0026 remains the independent Settings foundation. Existing scoped indexes include `idx_requests_location_season_created`, `idx_quotations_location_season_request`, `idx_payment_ledger_scope` and `idx_bill_purchase_cost_scope`. No persistent report totals, backfill, catalogue modification or new migration/index is justified by this implementation. Missing required schema/data produces safe failure, not fallback to unscoped estimates.

## Executed tests and evidence

**PASS — 60 focused tests, zero failures/skips** across the following direct command (the server npm pretest was deliberately not invoked):

```text
node --test --test-concurrency=1 server/tests/adminReports.test.js server/tests/requestPayments.test.js server/tests/billPurchaseCostSnapshots.test.js server/tests/adminBillingLocationApi.test.js
```

Counts: Reports 18, existing payments 17, historical-cost snapshots 11, scoped billing API 14. After the final Admin summary projection and explicit Platform rejection assertions, the Reports 18-test suite was rerun: **18 PASS, 0 FAIL, 0 skipped**. Unchanged suites' results above are from their actual execution in this implementation session, not imported acceptance statuses. The first attempt at the new suite found one incorrect test expectation (archived POST expected 405 but the existing guard correctly returned 403); the expectation was corrected, without changing the guard.

| Requirement | Status | Focused test name / evidence |
| --- | --- | --- |
| Scope/auth/discovery/methods | PASS | `scoped report discovery and method/auth boundaries do not grant Platform or global-role bypass`: unauthenticated Worker 401, Platform without membership 403, unauthorized location 403, GET discovery and non-GET rejection. |
| Date/bill/season arithmetic | PASS | `daily, bill-wise and selected-season reports sum frozen finalized amounts exactly once`: two bills 17,000 + 12,000 = 29,000 paise; draft excluded, multiple payments do not duplicate sales. |
| Business midnight/date validation | PASS | `Asia/Kolkata date filters are inclusive/exclusive at midnight and preserve fractional seconds`, plus invalid/repeated filter tests. Four UTC boundary bills select exactly two. |
| Receipt periods/methods/HOLD | PASS | `collections use payment dates, separate method/mode and exclude HOLD without multiplying bill amounts`: date window collects 5,000 paise versus current bill receipts of 6,000; occurred-time window differs explicitly. |
| Historical product basis | PASS | `product reports preserve saved units/line prices and do not allocate agreed bill amounts`: changed current selling rate does not reprice saved box/piece lines. |
| Frozen/zero cost and missing historical costs | PASS | `historical profit uses only immutable complete cost snapshots, including legitimate zero costs`; `pre-0025 finalized bills retain unavailable cost/profit and do not backfill from current rates`; mixed known/missing coverage test. Frozen 10,000 cost and 7,000 profit survive source-rate change. |
| Family Pack valuation | PASS | `Family Pack sales keep fixed variant identity and quantities while profit stays unavailable`: actual supported offline CREATE/finalize flow, saved pack ID/quantity and null profit. No valuation model added. |
| Admin response restrictions | PASS | `Admin ordinary reports omit private financial values and profit endpoint is denied by effective role`: only bills/quantities available; financial aggregates/profit 403; same Owner in A/Admin in B cannot read B profit. |
| Stall/season/archive isolation | PASS | `authorized second stall never reads first-stall bills or line data, and scope query overrides are rejected`; `season-wise report is strictly selected-season; explicit historical membership permits reads without writes`. Foreign request filters 404; removed membership 403. |
| Unknown legacy amounts/timestamps | PASS | `legacy missing bill amounts and finalization dates are unavailable, never estimated from catalogue or migration time`. Unknown dates/amounts remain null with coverage counts. |
| Paging, overflow, live demotion, read-only | PASS | Named pagination, safe-integer overflow, fresh live authority and no-mutation/legacy-mode tests. Three bills total 51,000 paise regardless of page. Overflow returns 503 rather than rounded money. |
| Existing atomicity/retries/offline cost behavior | PASS | Existing snapshot tests: immutable UPDATE/DELETE/REPLACE, retry uniqueness, rollback on capture failure and offline CLOSE receipt replay. Existing payment tests: concurrent/lost-response retries, balances, holds and immutable audit; scoped billing regressions all pass. |

**PASS — actual local Worker + native disposable D1:**

```text
node server/scripts/reports-backend-rehearsal.mjs
```

Final evidence directory: `C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79\reports-backend-18da0f10`.

`runtime-results.json`, `http-trace.json`, `source-before.json` and `preservation.json` contain the local artifacts. No credentials are written into this report or the HTTP trace. The helper reads only the established disposable `chain-687017a4` source; it checks the isolation manifest and clones into a newly initialized, separately named native D1 database. Reports use normal password-authenticated HTTP sessions for Owner, Super Admin, Admin and second-stall Owner. Source is opened read-only and compared after the run.

| Actual runtime check | Status | Evidence |
| --- | --- | --- |
| `D1-REPORT-01 six scoped report routes and direct SQL reconciliation` | PASS | All six actual Worker routes 200/no-store; two selected-stall bills = 47,000 paise; two payment entries = 5,500 paise; report aggregates equal direct scoped D1 SQL. Mixed complete/Family Pack coverage gives null overall profit. |
| `D1-REPORT-02 role projections, aggregate denials and Super Admin access` | PASS | Admin bills/products 200 with private fields and monetary summary removed; four privileged aggregate/profit routes 403; Super profit 200; Owner A with Admin B role gets B profit 403. |
| `D1-REPORT-03 cross-stall/season IDs, validation and pagination` | PASS | Another authorized stall/season cannot select A's bill (404); invalid date 400; limit 1 preserves total 2. |
| Preservation/integrity | PASS | Source unchanged; schema unchanged; all 12 protected tables unchanged: requests/items, quotations/items, accounts, ledger, workflow audit, cost snapshots, sync receipts, QR claims, migration history and platform settings. `integrity_check=ok`, no foreign-key violations. Login/session writes occur only in the new disposable copy. |

Windows initially blocked test-runner/workerd child creation with `spawn EPERM`. Authorized reruns outside the sandbox completed successfully; this was an environment launch limitation. Targeted lint has **zero errors/warnings in new files**. Including existing `server/src/index.js` reports its existing unused `ctx` parameter warning; no unrelated cleanup was made.

## Remaining gaps and verdict

- **NOT IMPLEMENTED in this backend-only phase:** Reports frontend/navigation, UI scope-switch/error handling, exports and an all-authorized-seasons comparison. The selected-season endpoint does not claim to supply a cross-season comparison.
- **Unavailable by design:** historical cost without reliable snapshots; Family Pack cost/profit until valuation is defined; product-level allocation of negotiated bill amounts; legacy unknown sale timestamps/amounts. No estimates or retroactive backfill were added.
- **NOT TESTED:** production-scale D1 query latency/CPU limits and concurrent traversal under a changing dataset. Pagination is bounded offset pagination, not a point-in-time export cursor; newly finalized records can shift later pages between requests. Representative disposable load testing is required before claiming large-volume performance guarantees.
- **NOT TESTED:** deployed runtime parity, because staging/runtime access remains unavailable. Native tests use compatibility date `2026-05-01`, matching the established local workerd; requested deployed `2026-10-01` parity is not claimed. Physical Android testing remains pending/NOT TESTED and was not part of these backend checks.
- No as-of balance, refunds, expenses, tax, stock valuation or newly expanded Admin financial reporting permission was invented.

**Verdict: PASS for the requested standalone Reports backend foundation in the isolated local environment.** No migration or reproducible unresolved blocker was found within that tested scope. Standalone Reports UI acceptance, representative-volume performance and deployed runtime parity remain open; this document does not change previous phase statuses or declare release GO.
