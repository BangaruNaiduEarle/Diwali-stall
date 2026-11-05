# Phase 2 — Multi-Stall acceptance testing

**All 14 requested scenarios are accounted for: 13 PASS, 0 FAIL, 1 partially NOT TESTED.** Supported behavior passed the actual Worker/D1 and desktop-browser checks. Full acceptance is **not declared complete** because scenario 5 includes standalone reports and stall-specific settings that are not implemented. Android/physical-device acceptance is also outside this desktop run.

## Existing work inspected and preserved

At resumption, inspected the two existing modified scripts:

- `server/scripts/multistall-acceptance-prepare.mjs`: had already created six separate fixture identities, a seasonal fixture business/Stall A, another business/location, a historical season/location, and a verified `before.sqlite` snapshot **inside the established disposable environment**.
- `server/scripts/multistall-acceptance-http.mjs`: had already completed **12 PASS** checks, provisioned Stall B through the real Platform API, and recorded four unavailable standalone features as NOT TESTED.

The saved `state.json`, `before.sqlite`, `fixture-seed.sql` and `http-results.json` were retained. Neither fixture preparation nor the completed HTTP suite was rerun on resumption. No existing business/request fixtures were reset or overwritten.

Remaining work was completed separately: browser state/storage switching, independent Owner B browser checkout, verification of all pre-existing clone rows, and two narrowly targeted supplemental checks for private prices and signature-valid business/season boundaries. No application bug was reproduced, so no application code or authorization behavior was changed.

Read the release-readiness/fix/security reports, `server/docs/ADMIN_LOCATION_CONTEXT.md`, `server/docs/ADMIN_LOCATION_MEMBERS.md`, and the offline/QR documentation before testing. The earlier broad user-management audit was not repeated.

## Established environment and evidence

Only this existing disposable D1 was used:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

Phase 2 evidence directory, abbreviated `P2` below:

```text
<above directory>\p2-d8b31a19
```

The Worker used its existing isolated configuration/persistence directory at `http://localhost:8793`; the existing production build was served at `http://localhost:5193`. Location mode was enabled and local authentication bypass disabled. Separate test identities signed in using real passwords/session cookies. Browser profiles are private directories under `P2`; requests outside the local frontend/API origins were blocked.

Fixtures:

- Seasonal business: `p2-d8b31a19-business`.
- Stall A: `p2-d8b31a19-a`.
- Stall B created by the Platform API: `location-c78ed5639b952ebbeb3b638c91aa0945`.
- A separate permanent business/location provided a cross-business control and multi-season catalogue context.
- Active season: `season-2026`; archived fixture season: `season-p2-d8b31a19`.

The shared test user was initially Owner in A and Admin in B. The membership-removal test removed only A; its A membership was then explicitly restored as **Super Admin**, as permitted by the existing invitation rules, for the later browser switch test. B remained Admin throughout. Owner B's global account role was Admin, demonstrating that operational Owner authority comes from the validated season/location memberships.

Credentials, cookies, device secrets, browser profiles and the SQLite backup stay in the private disposable directory. They are not copied into this report.

## Complete acceptance matrix

| # | Requested scenario | Result | Tests and evidence | Affected modules |
| --- | --- | --- | --- | --- |
| 1 | Platform Admin creates Stall B and assigns its Owner | **PASS** | HTTP-01: provisioning returned 201 with B/location/Owner identities; duplicate provisioning returned 409 | `adminPlatformRoutes`, `adminPlatformLocations` |
| 2 | Owner independently logs in and operates Stall B | **PASS** | HTTP-02/03 and BROWSER-04: independent password login, B catalogue operations and actual browser bill/quotation save | `adminPasswordAuth`, session/location context, `AdminQuickBillPage` |
| 3 | Same user has different roles in A/B | **PASS** | HTTP-02/12: A Owner versus B Admin; browser subsequently verified A Super Admin versus B Admin after the explicit membership restoration | `adminLocationContext`, `adminLocationMembers`, `AdminSessionContext` |
| 4 | Independent Owner, Super Admin and Admin permissions | **PASS** | HTTP-06, SUPPLEMENT-01, BROWSER-01/04: Owner/Super Admin finalize and pay; Admin creates but cannot finalize, pay, access private rates or retain privileged UI | `adminQuickBill`, `adminCustomerRequests`, `adminPayments`, role filters |
| 5 | All listed business areas are stall-specific | **NOT TESTED — partial** | Supported catalogue/pricing/stock/customer/request/quotation/bill/payment areas PASS; standalone reports/settings and additional unsupported models remain unverified. See submatrix below | Catalogue/transaction scope wrappers; absent route/features |
| 6 | Active/historical season isolation | **PASS** | HTTP-08: historical request readable only in the correct historical context; archived writes and mismatched season/location denied. Permanent-location catalogue reuse across operating seasons is intentional | `adminSeasonGuards`, `adminLocationContext`, `adminCustomerRequestScope` |
| 7 | Switching clears frontend state and isolates IndexedDB/catalogues/drafts/outbox | **PASS** | BROWSER-01/02/03: Quick Bill A cart/customer state cleared in B; role controls updated; B API headers used B; A/B durable records and original operation IDs remained separate | `AdminWorkspaceShell`, `AdminSessionContext`, `AdminQuickBillPage`, `AdminOfflineBillingPage`, `offline/storage` |
| 8 | Modified IDs/direct cross-stall reads and writes rejected | **PASS** | HTTP-04/07/08/10 and SUPPLEMENT-01: reciprocal product/category/request/quotation/payment/status/private-rate and scope-injection denials | Catalogue/request scope wrappers, pricing services, offline routes |
| 9 | QR/offline transfers cannot cross business/location/season | **PASS** | HTTP-10 and SUPPLEMENT-02: same-scope signed acceptance succeeded; other location/business rejected; mutated operation scopes rejected; signature-valid same-recipient cross-business handover and archived-season acceptance denied | `adminHandover`, `handoverProtocol`, `adminOfflineSync` |
| 10 | Role in A grants no extra authority in B | **PASS** | HTTP-02/06/12, SUPPLEMENT-01, BROWSER-01: A privileged user remains B Admin; B financial/private-price operations and privileged controls unavailable | Effective-role intersection, route guards, pricing filters |
| 11 | Removing one stall membership preserves the other | **PASS** | HTTP-12: A access became 403; B remained readable as Admin using the same session cookie; no global session revocation | `adminUsersManagement`, `adminLocationMembers`, session resolver |
| 12 | Last-owner protection and ownership rules | **PASS** | HTTP-01/11: duplicate provisioning conflicted; Platform season demotion/disable of B's sole effective Owner returned 409; self-removal returned validation denial 400 | `adminPlatformLocations`, `adminPlatformSeasonMembers`, location membership guards |
| 13 | Platform Admin separate from normal membership | **PASS** | HTTP-09: Platform session/global-setting read allowed; B operational access without membership returned 403; operational Owner could not access Platform routes/settings | `adminPlatformRoutes`, Platform and operational guards |
| 14 | Existing Stall A data intact; B independent | **PASS** | PRESERVATION: all **2,571 pre-existing rows across 34 tables** retained; schema/migrations unchanged. HTTP-03/04/05/07 and BROWSER-03 confirm independent new A/B records | D1 constraints/scope wrappers; read-only preservation checker |

### Scenario 5 submatrix

| Area | Result | Evidence / precise scope |
| --- | --- | --- |
| Products and categories | PASS | Independent A/B creation/listing; foreign IDs/categories cannot be read, moved or modified |
| Selling prices | PASS | A ₹100 versus B ₹250; a cross-stall price write was rejected and B remained unchanged |
| Purchase and X4 rates | PASS | Independent purchase A ₹30/B ₹80 and X4 A ₹110/B ₹270; cross-stall reads/writes return 404 and B Admin access returns 403 |
| Inventory currently implemented as stock status | PASS | Marking B sold-out leaves A available; B checkout denied while sold out; fixture B stock restored |
| Customer data embedded in requests/bills | PASS | Each location's request list contains its own request/customer and excludes the reciprocal foreign request |
| Requests, quotations and Quick Bills | PASS | Independent requests/quotations; reciprocal foreign detail/status/quotation access denied |
| Finalized bills and payments | PASS | Owner/Super Admin finalization/payment successes; independent fully paid bills; one ledger entry per tested finalized bill; business/location/season account scope validated in D1 |
| Standalone reports | NOT TESTED | No `/api/admin/reports` implementation; authenticated scoped probe returned 404 |
| Stall-specific settings | NOT TESTED | No `/api/admin/settings` implementation; probe returned 404. The implemented public-catalogue setting is **Platform-global**, not a stall setting |
| Standalone customer directory | NOT TESTED | No `/api/admin/customers` implementation; probe returned 404. Embedded customer isolation passed |
| Quantity/stock-movement ledger | NOT TESTED | No `/api/admin/inventory` implementation; probe returned 404. Existing stock-status behavior passed |

These missing features were not implemented in this testing task. A 404 is evidence that a feature is unavailable, not a successful isolation test for that feature.

## Test names and results

The original `P2/http-results.json` retains the full test names, affected modules and sanitized request/status trace for HTTP-01–12. All remain PASS:

1. **HTTP-01:** Platform provisions new Stall B and its existing Owner atomically.
2. **HTTP-02:** Owner B independently authenticates; existing users receive only explicit B roles.
3. **HTTP-03:** Each stall creates its own category/product and reads independent prices.
4. **HTTP-04:** Cross-stall modified product/category IDs cannot be read or written.
5. **HTTP-05:** Stock status is stall-specific and sold-out checkout is rejected.
6. **HTTP-06:** Owner and Super Admin finalize/pay independently; Admin creates but cannot finalize or pay.
7. **HTTP-07:** Customer/request/quotation/final bill/payment views exclude other stalls.
8. **HTTP-08:** Historical seasonal location is readable but archived writes and cross-season transaction reads fail.
9. **HTTP-09:** Platform authority is separate from stall membership and global settings.
10. **HTTP-10:** Signed QR and offline operations reject location/business/season boundary changes.
11. **HTTP-11:** Last B Owner cannot be removed by platform season demotion/disable.
12. **HTTP-12:** Removing only A membership preserves the same session and B Admin access.

Remaining/new checks, all PASS:

- **BROWSER-01:** Switching A to B clears the Quick Bill cart and privileged pricing controls. Customer name resets to the new workspace default too.
- **BROWSER-02:** A/B drafts, catalogue snapshots and pending outbox remain distinct; B API calls use only B scope. Actual IndexedDB contained two separately scoped drafts/catalogues and two pending CREATE operations.
- **BROWSER-03:** Returning to A restores only A while preserving both original operation identities.
- **BROWSER-04:** Owner B independently signs in and saves a real B bill in a separate profile.
- **SUPPLEMENT-01:** Purchase and X4 prices are independently scoped and hidden from B Admin. Existing finalized bill amounts remain unchanged by private-rate preparation.
- **SUPPLEMENT-02:** Valid signed transfer cannot cross businesses with the same recipient identity. The signature was independently verified using the actual preparation's public root key before testing rejection. An archived-season request at the same permanent location also returned 403.
- **PRESERVATION:** Read-only verification of every pre-existing clone row, unchanged schema/migration records, zero foreign-key violations, integrity `ok`, and correct request/quotation/payment-account scope for the fixture bills.

Totals at the check level: **14 HTTP checks + 4 browser checks + preservation passed**. Four unavailable-feature probes remain NOT TESTED. These counts are different from the 14 requested scenario statuses above.

## Browser resumption and harness corrections

The multi-season fixture user requires an explicit season choice before selecting a stall. The first browser attempt omitted that UI step; authenticated API inspection confirmed the memberships were present. Corrected the harness to select the season normally.

The next attempt passed BROWSER-01–03 but encountered a form-readiness race in BROWSER-04. Preserved those three PASS results and resumed **only BROWSER-04**, adding readiness waits. No application change was necessary, and the completed switching/storage steps were not rerun afterward.

Each attempt/profile has its own timestamped evidence file; earlier files were not overwritten. The final passing browser report references the earlier three-check result in `resumedFrom`. A previously mislabeled test metadata component name is identified here correctly as `AdminWorkspaceShell`; the original raw evidence remains intact.

## Data preservation and safety

The preservation checker opens only `P2/before.sqlite` and the verified disposable database under the established root's `persist` directory, both read-only. It never opens an original database.

- All 2,571 rows present before Phase 2 remain unchanged across all 34 non-internal tables, including the historical Stall A records and prior test transactions.
- SQLite/Cloudflare internal counters are excluded from row preservation because new fixtures advance them.
- Database schema and the complete existing migration record list are unchanged; no migrations were applied.
- Integrity is `ok`; foreign-key violations are zero.
- New A/B fixture transaction/quotation/payment-account records carry their expected business, location and season. Their creator/recorder identities do not replace business ownership.
- Original local databases were never used or modified; production was not accessed.

No reproducible application bug was found. No source, dependency or configuration fix was made, and no authorization check was relaxed. Only test harness timing/expected workflow handling required correction. Focused lint of all acceptance JavaScript scripts passed with no diagnostics. Previously completed broad user-management and release regression suites were not repeated because runtime code was unchanged.

## Evidence files and acceptance tooling

Retained existing files:

- `server/scripts/multistall-acceptance-prepare.mjs`
- `server/scripts/multistall-acceptance-http.mjs`
- `P2/state.json`, `P2/fixture-seed.sql`, `P2/before.sqlite`, `P2/http-results.json`

Added for remaining work:

- `server/scripts/multistall-acceptance-browser.mjs`
- `server/scripts/multistall-acceptance-supplement.mjs`
- `server/scripts/multistall-acceptance-preservation.py`
- This acceptance report.

Final evidence, all in `P2`:

- `browser-attempt-1793694411907.json`: four PASS browser results; three inherited from the preserved completed attempt and Owner B executed on resumption.
- `browser-attempt-1793694286129.json`: original three passed switching/storage checks.
- `supplement-1793694667553.json`: two additional targeted HTTP checks.
- `preservation-1793694739483325800.json`: final preservation/scope/integrity verification after supplemental fixture writes.
- `acceptance-matrix.json`: machine-readable PASS/FAIL/NOT TESTED for all 14 scenarios.

The browser runner supports resuming the unfinished Owner B step from an existing three-PASS report. Do not rerun fixture preparation or the completed HTTP suite against this saved run merely to inspect the results. Node 20 browser automation uses `--experimental-websocket`.

## Unresolved acceptance limits

Scenario 5 cannot receive an unconditional PASS while required reports/stall settings are absent. Customer-directory and quantity-ledger scenarios are likewise unsupported beyond the existing embedded-customer and stock-status models. No new features were added to fill these gaps.

Physical Android install/camera/device testing remains pending. Seasonal provisioning is deliberately restricted to the existing 2026 flow; historical seasonal locations use separate physical identities, while permanent-location catalogues can be reused across operating seasons. This phase verifies those current rules rather than broadening them.

All requested checks now have a recorded disposition. **Multi-Stall acceptance is not fully passed, and the project is not declared release-ready.**
