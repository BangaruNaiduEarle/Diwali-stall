# Performance optimization changes

Only files edited by this task are listed here. No deployment, schema changes or production data writes.

## Quick Bill
- `server/src/services/adminQuickBill.js`: Read distinct cart products in bounded batches; retain per-line validation and atomic checkout guards.

## Request and quotation ownership
- `server/src/lib/adminCustomerRequestScope.js`: Batch ownership reads; reuse successful checks only inside a scoped request, invalidate around writes, and retain commit-time guards. Support scoped purchase-rate batches.

## Product search
- `server/src/services/adminProducts.js`: Scan narrow search candidates with unchanged matching/order/filter semantics; hydrate only the matched page with role-filtered product data.

## Product creation
- `src/admin/lib/adminProductCreateHandoff.js`: One-use, expiring, context-generation-bound in-memory handoff; private fields are not stored in browser history.
- `src/admin/pages/AdminProductCreatePage.jsx`: Pass saved product/categories to the edit page after purchase-rate success; preserve upload and failure paths.
- `src/admin/pages/AdminProductEditPage.jsx`: Reuse creation handoff and successful edit/rate responses; direct navigation and expired/changed-context handoffs still fetch fresh data.

## Purchase estimate
- `server/src/lib/billPurchaseSummary.js`: Batch current purchase rates and return only the pending purchase subtotal; historical snapshot calculations remain unchanged.
- `src/admin/pages/AdminCustomerRequestDetailPage.jsx`: Pending estimate displays only purchase subtotal; finalized historical display remains unchanged. Apply payment-response summary/revision locally without redundant GETs.

## Payments
- `src/admin/components/AdminRequestPayments.jsx`: Pass authoritative recorded summary to the parent; retain ledger pagination and retry behavior.

## Task record
- `docs/PERFORMANCE_OPTIMIZATION_CHANGELOG.md`: Maintain this task's explicit change list and verification results.

## Targeted regression coverage
- `server/tests/performanceOptimization.test.js`: Small disposable SQLite check for batched reads, loose rounding, foreign ownership, subtotal/missing rates and search matching/order.
- `server/tests/billAdjustmentsHandover.test.js`: Update pending estimate contract to subtotal only.
- `src/admin/pages/AdminCustomerRequestDetailPage.loading.test.js`: Verify payment success avoids both GETs and the next payment uses the returned revision.

## Verification
- Targeted Node regression selection: 20 backend tests passed (checkout atomicity/retry, ownership/price/stock guards, subtotal contract and the new query-count/search assertions); 16 tests outside the selected names skipped. Initial sandbox launch was blocked by EPERM; the permitted retry executed the tests. Browser file initially required Node's WebSocket flag.
- Browser-only check with `--experimental-websocket`: five child tests passed, including payment revision/history and no redundant GETs. One child failed on a quoting error in the new subtotal DOM assertion. Corrected that assertion; not rerun, respecting the two-check limit. No application failure was reported by the browser check, but the corrected assertion remains unverified.
- No broad suites, benchmarks or production measurements. Product creation handoff and historical display were not exercised in these checks.

## Browser caching and request reduction
- `src/admin/api/adminSeasonRequest.js`: Include confirmed user and permission identity in the request generation/scope; clear identity on logout/reset.
- `src/admin/context/AdminSessionContext.jsx`: Publish cache identity only after accepting server-confirmed session fields.
- `src/admin/api/adminReadCache.js`: Memory-only categories (60 seconds) and opt-in product searches (2 seconds), bounded to 40 entries; coalesce requests, clone responses, cancel unused searches, and reject results after scope/mutation changes. Clear on window focus.
- `src/admin/api/adminReadCache.test.js`: Focused API checks for coalescing, expiry, mutation invalidation, user/permission/scope isolation, subscriber cancellation, stale responses, authorization failures and uncached financial responses.
- `src/admin/api/client.js`: Opt-in cached GET wrapper, cancellation handling, and invalidation around catalogue/auth/permission mutations or authorization failures. Financial APIs remain uncached.
- `src/admin/api/adminApi.js`: Reuse categories across pages and expose opt-in cached/cancellable paginated product searches.
- `src/admin/pages/AdminQuickBillPage.jsx`: Retain 280 ms search debounce; reuse query/category results, cancel obsolete work, clear stale rows, and reload on scope/permission changes.
- `src/admin/components/AdminCustomerRequestAdjustBillPanel.jsx`: Retain 260 ms debounce and use the same cached/cancellable search behavior.
- `docs/PERFORMANCE_OPTIMIZATION_CHANGELOG.md`: Record this additional feature and its exact files.

Browser caching verification (two targeted checks):
- `node --test --test-concurrency=1 src/admin/api/adminReadCache.test.js src/admin/api/adminLocationContext.test.js`: 32 tests passed, no failures/skips. Ran with process-launch permission because this environment previously blocked Node test subprocesses.
- Targeted `oxlint` on the eight changed JS/JSX files: exit 0, no errors, six React warnings (effect state updates, cancellation variables and Fast Refresh exports). No unrelated warning cleanup was performed.
- No browser automation, broad suites or production measurements were run for this increment. Cached catalogue/search data can be stale within its TTL; checkout still validates current pricing and availability on the server. Server authorization and financial APIs remain unchanged.
