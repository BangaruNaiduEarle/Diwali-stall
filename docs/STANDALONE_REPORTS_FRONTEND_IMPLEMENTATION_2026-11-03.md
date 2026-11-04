# Standalone Reports Frontend Implementation — 3 November 2026

**Implemented `/admin/reports` and verified all six existing backend report APIs through the actual local Worker and disposable D1.** Owner/Super Admin receive six report choices. Admin receives only bill records and product quantities, matching the backend's default-deny financial aggregate policy. No backend correction or migration was necessary.

Read the [approved gap analysis](REPORTS_SETTINGS_GAP_ANALYSIS_2026-11-03.md), [Reports backend implementation](STANDALONE_REPORTS_BACKEND_IMPLEMENTATION_2026-11-03.md), [Stall Settings frontend report](STALL_SETTINGS_FRONTEND_INTEGRATION_2026-11-03.md) and existing workspace/session, scoped API, navigation, UI and Settings code. Earlier acceptance reports retain their original dispositions and were not edited.

## Integration and screens

Added Reports to the existing operational route allowlist, guarded routes and desktop/mobile navigation. The page uses existing `admin-page`, `admin-panel`, form/state styles and Button components. Each section has full filtered summary values, responsive record cards, pagination, explicit scope, date basis and generation time. Cards use one column on narrow screens and expand on wider screens; long IDs wrap within the viewport.

| Section | Existing GET API | Display and permission behavior |
| --- | --- | --- |
| Date-wise Sales Summary | `/api/admin/reports/sales-by-date` | Server-finalized sales grouped by business date; known/unavailable amount and unknown-date coverage. Owner/Super Admin only. |
| Bill-wise Report | `/api/admin/reports/bills` | Recorded reference, customer, date, creator, handover recipient, finalizer, frozen due and current received/outstanding/status. Privileged saved quotation/adjustment fields appear only for Owner/Super Admin. Admin monetary aggregate summaries are absent. |
| Payment Collection Report | `/api/admin/reports/collections` | Recorded collections by business date, method and ONLINE/OFFLINE mode; selected timestamp coverage. Owner/Super Admin only. |
| Product-wise Sales Report | `/api/admin/reports/products` | Saved product/Family Pack identity/name, unit, line/bill counts and quantities. Owner/Super Admin may see saved line gross before bill agreement; Admin sees quantities only. No final revenue allocation is invented. |
| Season-wise Sales Report | `/api/admin/reports/seasons` | Only the selected authorized season and its server totals. The workspace Season selector changes the request context. No all-season permission or client aggregation is added. |
| Historical Profit Report | `/api/admin/reports/profit` | Server-provided frozen cost/profit and complete/missing coverage. Overall unavailable totals and complete-cost-bill subset values have distinct labels. Owner/Super Admin only. |

The page first loads `/api/admin/reports` discovery and intersects its choices with the current effective role. Existing backend authentication, membership and field projection remain authoritative. Forced direct Admin requests to sales, collections, seasons and profit return **403**; hiding options is not treated as authorization.

The API adapter reuses the existing session-cookie client and confirmed stall/season headers. It verifies business/location/season, report identity, timezone, currency, pagination, row shape and safe scalar numeric values before rendering. Admin responses containing cost/profit, purchase, margin, quotation adjustment, line money or forbidden aggregate fields fail closed. Display uses allowlisted field descriptors, never arbitrary API keys or raw JSON.

## Scope, filters and state

- Every request uses the **active workspace context**. The existing Season and Active stall selectors are the season/stall filters; report text explains them. Scope IDs are not unrestricted report query fields.
- The page instance is keyed by user/context/stall/season/effective permission role. A switch immediately unmounts previous filters/results and reloads discovery/data for the confirmed context. Delayed old responses are ignored by component cleanup and the shared API generation guard. Switching to a stall where the same user is Admin reduces the choices to bills/products.
- Common filters: start date included, end date excluded, rows per page and optional request ID. Collections adds received/occurred date basis, method and recording mode. Products adds mutually exclusive product/Family Pack ID filters and unit. The backend remains responsible for validation, including invalid ranges or unsupported combinations; errors are shown explicitly.
- Dates are sent unchanged as `from` and `toExclusive`; the backend owns Asia/Kolkata conversion and half-open boundaries. No browser-local timezone arithmetic or financial calculation is introduced.
- Apply, report selection and Reset return to page 1. Previous/Next use server pagination; summary values always come from the full server result set. Page limits remain bounded by the existing contract. Context/report switches clear inapplicable filters.
- Initial/discovery loading, report loading, empty results, API/network errors and Retry are explicit states. A failed load removes previous results. HTTP 401 identifies session expiry; 403 identifies changed membership/role access. Retry never falls back to cached data or another stall.
- Reports are online authoritative and held only in current component memory. No Reports localStorage, IndexedDB, outbox operation, service-worker cache or offline transaction count was added. Existing service-worker handling excludes these API paths.
- Explicitly unscoped legacy mode shows the workspace requirement. Existing single-stall billing/settings behavior remains unchanged; scoped single-stall installations use the same page.

## Financial presentation

All totals, quantities, cost coverage and row values come directly from the APIs. The frontend formats recorded integer paise; it does not sum lines, allocate discounts, calculate profit/margin, reprice products or substitute quote totals for final amounts. Zero remains zero, negative recorded profit/adjustments retain their sign, and null values read **Unavailable**.

The profit section explains that immutable transaction-time snapshots are required and that **Family Pack profit is unavailable until its valuation model is defined**. Missing/incomplete/unsupported cost rows show an unavailable message. Complete aggregate cost/profit stay unavailable when the API reports incomplete coverage; known-subset values are labelled as complete-cost bills only. No current catalogue rate or estimated cost is requested.

The profit API supplies a generic missing/incomplete/unsupported reason rather than a separate per-bill Family Pack classification. The frontend preserves that distinction: it explains the Family Pack rule globally and does not guess which missing-cost row contains a pack. Product reports retain actual saved pack IDs/units separately.

Bill balances are labelled current balances, not historical balances at the date cutoff. Unknown-date coverage is labelled as scope-wide; unknown dates do not silently become the selected date. Missing historical values are never displayed as zero merely to fill a card.

## Changed files

| File | Change |
| --- | --- |
| `src/admin/pages/AdminReportsPage.jsx` | Report discovery, six sections, role-aware presentation, filters, responsive records, scope reset, state/error/retry handling and pagination. |
| `src/admin/api/adminReports.js` | Existing GET adapters, scope/contract validation, no-store fetch and Admin payload defense. |
| `src/admin/lib/reports.js` | Allowlisted report/field labels, role projections, query serialization and recorded-value formatting. |
| `src/admin/AdminRoutes.jsx` | Register guarded `/admin/reports`. |
| `src/admin/lib/adminWorkspaceAccess.js` | Add Reports to allowed local destinations using existing scope/capability rules. |
| `src/admin/lib/adminNavigation.js` | Add Reports for readable location workspaces. |
| `src/admin/api/adminReports.test.js` | Ten focused API adapter/security/context/error tests. |
| `src/admin/lib/reports.test.js` | Five focused presentation/query/permission/navigation tests. |
| `server/scripts/reports-frontend-rehearsal.mjs` | Local frontend build and four-profile browser/API integration harness; no backend application changes. |
| `server/scripts/reports-frontend-db.py` | Guarded disposable-copy initialization and read-only preservation checks; no migration execution. |
| This report and `docs/report-evidence/standalone-reports-2026-11-03/` | Portable selected screenshots, browser results/console and preservation evidence. |

No billing/dashboard/settings application implementation, backend API, dependency, configuration, existing test, migration or prior report was changed. No Git command, deployment, production access, original local D1 access or migration occurred. No application database rows were added/updated by the Reports scenarios. Login/session bookkeeping was confined to the new disposable copy.

## Focused test results

**PASS — 30 tests, 0 failures, 0 skipped:**

```text
node --test --test-concurrency=1 src/admin/api/adminReports.test.js src/admin/lib/reports.test.js src/admin/lib/adminWorkspaceAccess.test.js src/admin/lib/adminNavigation.test.js
```

Fifteen new focused tests plus fifteen existing workspace/navigation regressions. Mocked-network API tests are explicitly separate from the actual browser checks below.

| Focused coverage | Status | Evidence |
| --- | --- | --- |
| All six API routes and scoped credentials/no-store | PASS | `report GET attaches confirmed stall/season credentials and no-store; query is forwarded unchanged`; `all six existing report routes are supported without client calculations`. |
| Role choices, direct client denial and unexpected Admin payloads | PASS | Discovery intersection, financial-call default deny, private-value/aggregate rejection, allowlisted field and Reports navigation tests. |
| Scope substitution and stale responses | PASS | Foreign business/stall/season payload rejection and late stall/season generation checks. |
| Missing, zero and negative financial values | PASS | Null profit stays null; zero/loss formatting is explicit. No costs are fabricated. |
| Dates, pagination errors and states | PASS | Query forwarding without timezone arithmetic; malformed pagination/money/report identity rejection; 401/403/network/empty states; switching/legacy fetch prevention. |
| Existing navigation/workspace behavior | PASS | Fifteen existing route, role, landing, drawer and context regressions. |

**PASS — nine actual browser scenarios:** Four independent headless Chrome profiles (Owner, Super Admin, Admin, Owner B) used ordinary password authentication against the actual bundled local Worker and native Miniflare D1. Nonlocal browser requests were blocked. The frontend was built with environment-file loading disabled and a same-origin local API. The source was the established already-migrated disposable `chain-687017a4` fixture, copied to a new D1 identity/persistence directory; no migration was applied.

Run directory:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79\reports-ui-e25c1111
```

Harness entry points are `prepare`, `build <directory>`, `browser <directory>`, `browser-resume <directory>` and `verify <directory>`. Browser invocation uses `node --experimental-websocket server/scripts/reports-frontend-rehearsal.mjs ...` on the installed Node 20 runtime. These invoke no npm migration hook.

| Actual browser test | Status | Evidence |
| --- | --- | --- |
| `REPORT-UI-01` — all six sections | PASS | All six actual APIs return 200. Date/season groups 1 each; bills/profit rows 2 each; product/collection groups 2 each. Missing overall profit and Family Pack explanation visible. Six desktop screenshots. |
| `REPORT-UI-02` — permissions / Stall B | PASS | Admin choices exactly bills/products, no private financial display; four forced direct API calls 403. Super Admin profit loads. Owner B cannot select A's bill (404). Four independent profiles. |
| `REPORT-UI-03` — filters / empty / reset | PASS | `[2099-01-01,2099-01-02)` yields empty; Reset restores recorded data. Actual request trace includes the exact half-open dates, occurred/UPI/OFFLINE and saved Family Pack ID/unit filters. |
| `REPORT-UI-04` — pagination | PASS | Limit 1 traverses two independent bill rows, Page 1/2 and 2/2 with disabled final Next; Previous restores the first record. Full server totals stay unchanged. |
| `REPORT-UI-05` — error/retry / late response | PASS | Simulated 503 hides results and Retry recovers. Held A response shows loading; switch to B applies lower Admin role, resets page-size/filter state and ignores released A data. |
| `REPORT-UI-06` — season isolation | PASS | Workspace season change reloads requests under the new header and displays only that authorized season; return to A/2026 restores the selected context. |
| `REPORT-UI-07` — mobile | PASS | All six reports at both 360px and 390px: 12 layouts with document scroll width within viewport, and 12 screenshots. Desktop Chrome emulation, not physical Android. |
| `REPORT-UI-08` — exact value reconciliation | PASS | Every displayed allowlisted summary and row value for all six reports equals the corresponding actual API value after presentation formatting, including null cost/profit. |
| `REPORT-UI-09` — existing screens / mobile navigation | PASS | Owner workspace, existing Quick Bill and Settings load. At 360px the drawer contains Reports; activating it opens the page and closes the drawer. No financial write performed. |

The fixture's selected stall has two bills totalling **47,000 paise**, two recorded payment entries totalling **5,500 paise**, one complete-cost bill (10,000 paise frozen cost, 7,000 paise profit) and one bill with unavailable Family Pack valuation. The UI preserves those server distinctions rather than combining a known profit subset into a complete total.

Completed scenarios were checkpointed and retained during subsequent runs; only new/failed checks were resumed. Initial Admin presentation checking also matched generic privileged explanatory text; that copy now explicitly describes the quantities-only view. No private monetary data was leaked. The Quick Bill smoke test initially looked for an h1 while the existing page uses h2; only its test selector was corrected. A browser-close teardown wait was bounded after the scenarios completed, then cleanup and preservation verification succeeded. No application backend or completed billing workflow was changed to satisfy a test.

## Screenshots and preserved evidence

Representative screenshots copied into this repository:

- [Payment collections, desktop](report-evidence/standalone-reports-2026-11-03/desktop-collections.png).
- [Historical profit, 360px](report-evidence/standalone-reports-2026-11-03/mobile-360-profit.png).
- [Admin product quantities](report-evidence/standalone-reports-2026-11-03/admin-products.png).
- [Mobile Reports navigation](report-evidence/standalone-reports-2026-11-03/mobile-reports-navigation.png).

All 22 screenshots remain in the private run directory, together with HTTP traces and attempt diagnostics. Portable final [browser results](report-evidence/standalone-reports-2026-11-03/browser-results.json), [console results](report-evidence/standalone-reports-2026-11-03/browser-console.json) and [preservation results](report-evidence/standalone-reports-2026-11-03/preservation.json) accompany this report. Final profiles recorded **zero uncaught JavaScript exceptions**.

**PASS — preservation:** The complete disposable source fingerprint is unchanged. Test-copy schema/migration history and all **32 non-authentication tables** match their pre-test fingerprints, including settings, memberships, products/rates, Family Packs, requests/quotes, bills/payments, cost snapshots, workflow events, device keys, receipts and QR claims. Only authentication user/session/login-attempt bookkeeping is exempted in the new copy. SQLite integrity is `ok`; foreign-key violations are zero. Existing root-level reports were checked for unchanged SHA-256 hashes.

**PASS — build/lint:** Temporary frontend production build succeeded. The existing Vite >500 kB chunk-size advisory remains; no unrelated bundle redesign was attempted. Targeted lint of all changed frontend JS/JSX and the browser harness exits 0 with zero diagnostics. Windows sandbox child-process `spawn EPERM` required authorized local test/runtime reruns; successful test results above are from those executions.

## Remaining gaps and verdict

- **NOT TESTED:** physical Android, touch/camera/device behavior and installed Android PWA. Mobile evidence is desktop Chrome viewport emulation only.
- **NOT TESTED:** deployed runtime/HTTPS parity; staging/runtime access remains unavailable. Local Worker testing uses the established `2026-05-01` compatibility date; deployed `2026-10-01` parity is not claimed.
- **NOT TESTED:** representative production-volume latency and pagination during concurrent writes. Existing bounded offset pagination can shift later pages when records change; it is not a point-in-time export cursor.
- **Not supplied by the existing contract:** all-season comparisons, exports, as-of balances, allocated product revenue or per-bill Family Pack classification in the profit endpoint. No frontend estimate or invented API was added for these.
- Historical missing-cost and Family Pack profit remain explicitly unavailable until reliable source data or an approved valuation model exists. This is not converted into a passed valuation requirement.

**Verdict: PASS for the standalone Reports frontend integration in the isolated local environment.** All six sections, backend permissions, scope switching, filters, pagination and tested responsive states are verified. No unresolved reproducible integration defect remains in this scope. This does not mark pending Android, deployed parity or wider release acceptance gaps passed, and does not itself declare release GO.
