# Request Search verification — 4 November 2026

**PASS for all six requested checks in the focused local scope.** Application code was already implemented and required no changes. This verification does not change the deployment **NO-GO** decision.

## Changes

- Updated the existing `server/tests/adminRequestSearch.test.js` fixture with `revision INTEGER NOT NULL DEFAULT 0` and explicit insert columns. Actual execution also exposed missing scope-validation dependencies: added empty in-memory `customer_request_items` / `quotations` tables and the mock statement's `first()` method. Existing scope validation remains active.
- Added `src/admin/pages/AdminCustomerRequestsPage.search.test.js` to exercise the actual page, React hooks and DOM events in headless Chrome. Uses a fresh temporary browser profile, an in-memory esbuild bundle and controlled API/session responses. Child request card/audit components are stubbed; the page's search, filters, desktop table, results summary, pagination and empty states are actual code. All browser network requests are blocked. No application server or database is connected.

## Results

| Requested check | Status | Executed evidence |
| --- | --- | --- |
| Partial Reference ID search | PASS | Actual scoped SQLite SQL matches `DWL-TKTSWMFM`, `tkts` and `WMFM`; internal ID search returns no rows. Existing Worker/mock-D1 search tests also pass. |
| Customer name and normalized phone | PASS | Partial names/digits and full formatted `+91 (987) 654-3210` match in SQLite; existing Worker tests cover full/partial names, case-insensitive text and formatted phone queries. |
| Stall/season isolation | PASS | Same matching name/phone/reference fragments in foreign `loc-b` and the previous operating season are excluded by the actual `customerRequestDb` wrapper. Own matching records remain visible. |
| Filters, sorting and pagination | PASS | Scoped SQL combines status, finalization and assignee filters, retains newest-first order and returns the expected offset page. Existing Worker tests verify search beyond the first page and totals. Browser confirms a new search resets page 2 to page 1, subsequent paging retains the query, and clearing retains the selected status filter. |
| Debounce, clear and empty state | PASS | Rapid partial-reference input produces no intermediate request; the eventual query is trimmed. Clear icon and empty-state Clear search both remove the query. Search-specific no-match text and original filter-only empty state render correctly. |
| Stale-response protection | PASS | Held old success and error responses cannot replace newer search results. A response held before clearing cannot replace the cleared results. |

Additional focused check: literal `%`, `_` and SQL-like input do not match every record or escape the bound search predicate.

## Commands and final counts

Direct Node commands only; no npm test lifecycle hooks:

```text
node --test --test-concurrency=1 server/tests/adminRequestSearch.test.js
4 tests PASS, 0 FAIL, 0 skipped

node --test --test-concurrency=1 --test-name-pattern="admin customer request search|admin customer request list query validation" server/tests/adminCustomerRequests.test.js
13 tests PASS, 0 FAIL, 15 unrelated tests excluded by name filter

node --experimental-websocket --test --test-concurrency=1 src/admin/pages/AdminCustomerRequestsPage.search.test.js
4 browser scenarios PASS (5 Node test entries including parent), 0 FAIL, 0 skipped
```

The final UI run includes the additional outstanding-search/clear case. The earlier three-scenario UI pass is superseded by that final run; no unrelated completed suites were repeated.

Diagnostics retained here: the initial sandbox attempt was blocked by `spawn EPERM`. Approved child-process execution allowed focused Node/Python and Chrome/esbuild runs. After the requested revision fix, the first executable SQLite run had 1 PASS / 3 FAIL because the existing scope wrapper also queried missing fixture tables. Completing only those fixture dependencies produced the final 4 PASS result. These were test-fixture failures; no application defect was reproduced.

## Limits and preservation

**NOT TESTED:** combined authenticated browser-to-live-Worker/D1 integration, deployed runtime, physical Android, visual/mobile layout and representative-volume performance. Browser API/session responses are controlled, existing Worker tests use mock D1, and the scoped SQL checks use Python's SQLite `:memory:` through the existing JavaScript test harness. These bounded results are not a deployed-environment sign-off.

Only the existing focused fixture, new focused UI test and this evidence report were changed for this task. No production/original D1 access, existing disposable database reuse, migrations (including 0027), environment/configuration edits, dependency changes, deployment or Git commands occurred. Fresh Chrome profiles are left in temporary storage; no existing browser profile or pending work was altered.
