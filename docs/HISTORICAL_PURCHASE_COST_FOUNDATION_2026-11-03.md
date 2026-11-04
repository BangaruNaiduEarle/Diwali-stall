# Historical purchase cost foundation — 3 November 2026

Implemented locally. **Migration 0025 is required and has not been applied to any on-disk D1 database.** All schema execution in this task used freshly created SQLite `:memory:` fixtures. No original local D1, production, deployment, Git command, dependency update or existing acceptance-report change was involved.

## Schema decision

Reviewed the [approved gap analysis](REPORTS_SETTINGS_GAP_ANALYSIS_2026-11-03.md), existing line snapshots, finalization, payment accounts and offline receipt transaction boundary. Existing `product_details_json` / `pack_snapshot` fields describe selling/pack information and have no independently immutable purchase-cost contract. Current purchase-rate history is not a frozen cost-at-sale ledger. Reusing those fields would not safely satisfy historical costing.

Added [0025_bill_purchase_cost_snapshots.sql](../server/database/migrations/0025_bill_purchase_cost_snapshots.sql), intended after the existing 0024 chain. It creates `bill_item_purchase_costs`, linked to the exact `quotation_items.id`, stable request line, quotation and immutable finalized payment account. Each row records business/location/season, quantity/unit, source purchase-rate identity, captured pack cost/divisor, unit/line cost or an explicit unavailable reason, expected bill-line count and server capture time.

No historical backfill is performed. Existing finalized accounts and their lines receive no inferred cost data. The migration adds a table/index/triggers; it does not rewrite prior bill/payment data or apply old migrations again.

## Behavior

- The existing finalization transaction creates one immutable payment account. Its new INSERT trigger captures all bill-line costs in the same statement/transaction, alongside the existing audit changes and, for offline sync, the atomic operation receipt. A snapshot failure aborts closure/account/history; it cannot commit half a financial operation.
- Source cost is the server's authoritative current purchase rate (`effective_to IS NULL`) for that product at the selected location **when finalization commits**. Neither a client purchase price nor an offline-preparation estimate is trusted. An offline closure captures at server reconciliation, not the unverified earlier device time.
- Whole-box cost uses the recorded purchase rate. Loose-piece cost uses the saved line's pieces-per-pack divisor and existing integer floor rule, then multiplies by saved quantity. Zero cost is valid. Unsafe integer amounts, unknown unit basis or missing rates produce an unavailable-cost row without changing bill/payment calculations.
- Family Pack purchase valuation is not inferred from descriptive components or X4/final reference prices. Its bill line records `unsupported_family_pack` with null cost; finalization/handover/payment remains supported. A separately defined reliable pack-cost model is still needed for pack profit.
- Finalized/closed bill summaries read **only immutable cost rows plus the frozen payment-account amount due**. Gross profit is frozen agreed bill due minus complete frozen cost, not quotation total, receipts, today's rates or Final Price + ₹500. Incomplete, unsafe or absent snapshots return `available: false`, null purchase subtotal/profit and a reason. Known line costs may be shown without presenting their partial sum as complete profit.
- Pending bills retain their explicitly labelled current-purchase estimate; this is not historical profit. The Owner detail UI distinguishes estimates from finalized costs and explicitly says when historical profit is unavailable.
- Snapshot UPDATE/DELETE and replacement of an existing snapshot are rejected by triggers; quotation-item identity and stable request-line uniqueness prevent retry duplication. Replaying an already-finalized bill does not recapture costs, including historical bills without snapshots.
- Service finalization additionally checks effective Owner/Super Admin authority. Live enabled user/season/location memberships and active scope are rechecked during account/snapshot commit. Snapshot reads use the existing scoped request boundary. Admin responses omit the internal financial summary; Platform status alone grants no operational authority.

## Changed files

| File | Change |
| --- | --- |
| [0025 migration](../server/database/migrations/0025_bill_purchase_cost_snapshots.sql) | Immutable scoped cost records, atomic capture and commit-time authority checks. |
| [billPurchaseSummary.js](../server/src/lib/billPurchaseSummary.js) | Separate finalized immutable-cost path; unavailable historical result; preserve pending estimate path. |
| [adminCustomerRequestScope.js](../server/src/lib/adminCustomerRequestScope.js) | Narrow scoped snapshot SELECT support; map commit-time authority failure to 403. |
| [adminCustomerRequests.js](../server/src/services/adminCustomerRequests.js) | Explicit effective-role check in finalization service. |
| [AdminCustomerRequestDetailPage.jsx](../src/admin/pages/AdminCustomerRequestDetailPage.jsx) | Accurate finalized/estimate labels and unavailable-cost notice. |
| [workflowSqlite.js](../server/tests/helpers/workflowSqlite.js) | Install the new schema only in fresh in-memory fixtures; optional omission for pre-migration historical tests. |
| [billPurchaseCostSnapshots.test.js](../server/tests/billPurchaseCostSnapshots.test.js) | Eleven focused creation/immutability/history/retry/authorization/atomicity tests. |
| This report | Implementation, migration, validation and remaining limits. |

Existing acceptance reports, gap analysis, package/lockfiles, payment formulae, QR protocol and offline operation schemas were not changed. No original data was opened to verify preservation: it was outside this task's access boundary throughout.

## Focused validation

Used direct `node --test` invocations, bypassing server `npm test` migration hooks. The existing Python bridge opens only `sqlite3.connect(':memory:')`; scope/finalization/legacy cases also use mocks. No existing D1 binding/persistence was used.

| Test selection | Result |
| --- | --- |
| `server/tests/billPurchaseCostSnapshots.test.js` — final run | **11 PASS, 0 FAIL, 0 skipped** |
| `server/tests/billAdjustmentsHandover.test.js` | **12 PASS** |
| `server/tests/offlineSync.test.js` | **16 PASS** |
| `server/tests/requestPayments.test.js` | **17 PASS** |
| `server/tests/adminBillingLocationApi.test.js` + `adminCustomerRequestFinalizeAgreed.test.js` | **18 PASS, 0 FAIL, 0 skipped** |
| `adminQuickBillAtomic.test.js`, name filter `gate OFF\|legacy retries` | **2 PASS, 0 FAIL, 21 skipped by explicit name filter** |
| `handoverSync.test.js` + `requestWorkflowHistory.test.js`, three named QR/Family Pack closure/audit cases | **3 PASS, 0 FAIL, 24 skipped by explicit name filter** |
| Oxlint on the six changed JS/JSX/helper/test files | Exit 0; three warnings on unchanged existing lines: unused queue SQL constant and two pre-existing state-in-effect patterns. No new-line diagnostics. |

New tests verify authoritative cost capture and fixed profit despite later rates/payment; saved-divisor loose-unit rounding and zero cost; UPDATE/DELETE/REPLACE denial and concurrent retry identity; pre-migration missing-cost history; later rate import and unsafe cost; mixed known/unknown lines; atomic rollback; Admin/foreign stall/season denials; commit-time demotion; offline CLOSE receipt replay; supported Family Pack closure without invented cost.

Representative commands:

```text
node --test --test-concurrency=1 server/tests/billPurchaseCostSnapshots.test.js
node --test --test-concurrency=1 server/tests/billPurchaseCostSnapshots.test.js server/tests/requestPayments.test.js server/tests/billAdjustmentsHandover.test.js server/tests/offlineSync.test.js
node --test --test-concurrency=1 server/tests/adminCustomerRequestFinalizeAgreed.test.js server/tests/adminBillingLocationApi.test.js
node --test --test-concurrency=1 --test-name-pattern="gate OFF|legacy retries" server/tests/adminQuickBillAtomic.test.js
node --test --test-concurrency=1 --test-name-pattern="offline handover atomically|Owner-first mixed Family Pack|assignment captures" server/tests/handoverSync.test.js server/tests/requestWorkflowHistory.test.js
```

The combined four-file attempt had **54 PASS / 1 FAIL** because the new Family Pack fixture incorrectly used the intentionally unsupported online checkout path. Corrected the fixture to the existing verified-snapshot offline CREATE path; all final eleven new tests pass. The 45 existing regression cases already passed and were not repeated unnecessarily. An earlier new scope fixture used the session-inspection path, which intentionally does not attach an operational location; corrected it to an operational request path. Neither correction relaxed application guards. Initial sandbox execution could not spawn child processes; approved retries ran the same in-memory tests successfully.

## Migration requirements and remaining risks

1. **Not applied:** 0025 still needs an authorized rehearsal on a new disposable D1 with the actual preceding schema/runtime, including trigger execution, FK/integrity checks, existing-row preservation and closure/receipt rollback. Native Worker/D1 runtime parity for this migration is **NOT TESTED** here. No migration against the original database is authorized or performed.
2. Coordinate schema availability before enabling the new finalized summary/capture behavior in any target environment. Old databases do not contain this table; the new finalized read path deliberately does not fall back to current rates if schema deployment is missing.
3. The captured cost is the authoritative configured purchase rate at server finalization, not procurement-lot/FIFO valuation or proof of a supplier invoice. Correct underlying purchase rates remain a data-quality prerequisite. Historical bills, unsupported pack costs and missing/unsafe costs remain unavailable permanently; no automatic repair/backfill is provided.
4. A single stall using the existing validated location-mode foundation captures snapshots without requiring another stall. Explicit legacy mode retains existing checkout/financial behavior; writers without an authenticated location actor do not acquire invented scoped costs, and its existing privileged cost summary remains unavailable. No mode flag, original-stall identity or old bill is rewritten.
5. Physical Android, optical QR and deployed runtime checks were not repeated and remain outside this focused change. No new Reports page, Settings workflow, inventory valuation or financial mutation workflow was implemented. This foundation alone does not close the release's Reports/Settings or final acceptance blockers.
