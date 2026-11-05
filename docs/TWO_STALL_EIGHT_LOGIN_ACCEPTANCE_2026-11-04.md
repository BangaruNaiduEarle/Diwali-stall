# Two-stall launch-critical billing acceptance — 8 logins each

**PASS for the focused local server/protocol checks and explicitly retained desktop evidence below.** Final new run: **7 Node entries PASS (six scenarios plus parent), 0 FAIL, 0 skipped**. Sixteen-browser/device operation remains NOT TESTED. This is not deployment/release approval.

## Scope, preparation and missing scenarios

Reviewed the existing Multi-Stall, Phase 3 roles/isolation, Phase 4 billing/payment, Phase 5 concurrency, Phase 6 offline/QR, G07 desktop cache fix and final Reports/Settings evidence. Individual lifecycle, QR, browser switching, offline restart/lost-acknowledgement and report cases already pass in their documented scopes; their suites were not repeated.

The missing capacity checks were **16 distinct password sessions, eight simultaneous operation streams per stall, and role/data/report boundaries with those two eight-login teams**. Added only a new acceptance test and disposable fixture helper to execute these checks. Application code and migration files were not changed.

Fixture: fresh memory-only copy from the checksum-verified retained post-0020 backup, with the already-qualified 0021–0027 files used only to initialize the current-release fixture. 0020 was not replayed; migration acceptance tests were not rerun. No existing persistence directory, production binding or deployed service was used. Backup opens immutable/read-only and its checksum remains unchanged.

Created a new disposable business with two new stall fixtures, leaving both retained stalls and their original records untouched. **Each new stall has eight distinct accounts: one Owner, one Super Admin and six Admins.** All global account roles are Admin, so privileged operation successes must come from actual season/stall memberships. Actors use real password login/session cookies and the current `worker.fetch` handler with native Miniflare D1. Worker handler code executes in Node; there is no browser/network transport or deployed-runtime claim.

All data writes belong to these new fixture identities/scopes and their authentication records. Test runtime disables persistence and closes afterward. Original fixture rows, including prior financial/QR/offline records, are compared against the pre-acceptance baseline; final foreign-key check is clean. No original local D1, production resource, existing database or application/deployment configuration was modified.

## Acceptance matrix

| Workflow | Result | New versus retained evidence |
| --- | --- | --- |
| Login and role permissions | **PASS** | **New E8-01/04/05:** 16 distinct password sessions; correct effective Owner/Super Admin/Admin roles; 12 Admin finalization, purchase-rate and payment denials. Four privileged actors finalize/pay despite global Admin roles. **Retained Phase 3:** broader demotion/revocation/last-owner and cross-role checks. |
| Stall switching and strict isolation | **PASS — API/new; browser/retained** | **New E8-01/02/04/05:** 16 foreign-stall selections denied; 16 foreign product IDs and 16 foreign request IDs denied; each request list contains exactly its own eight requests; four foreign payment reads denied. **Retained Multi-Stall BROWSER-01/02/03 and Phase 3:** authorized same-user switching, role downgrade, transient reset and IndexedDB/outbox separation. No new eight-profile switching UI result is claimed. |
| Products, prices and stock | **PASS — stock status only** | **New E8-02:** all 16 sessions see only their two local catalogue products, A/B selling prices 10,000/25,000 paise and independent sold-out/available markers. Twelve Admin responses omit private Purchase/Final prices. **Retained Multi-Stall Scenario 5 stock/pricing:** actual stock-status changes and sold-out checkout rejection, independent selling/purchase/X4 prices and cross-stall write denial. Quantity movement tracking is outside the approved launch scope. |
| Bill creation, payment and bill history | **PASS** | **New E8-03/04/05:** 16 distinct request/quotation creations through concurrent sync, 16 scoped histories with contiguous revisions, four finalized bills, four exact partial payments and unchanged foreign scopes. **Retained Phase 4:** full/partial/HOLD/multiple methods, frozen prices, amendments, retry and closure-conflict coverage. |
| Customer requests | **PASS** | **New E8-04:** saved customer name/details and own-eight request lists are readable in the correct stall; reciprocal foreign requests are inaccessible. **Retained Phase 4 P4-01 and Multi-Stall Scenario 5:** embedded customer details, quantity/line changes and quotation lifecycle. Standalone Customer Directory remains owner-deferred after Diwali. |
| QR handover | **PASS — retained desktop/server scope** | **Retained Phase 5 P5-07/08, Phase 3 P3-QR-01/02, Phase 6 P6-01/02/03/05:** signed normal/mixed transfers, intended recipient/role/scope guards, explicit acceptance, duplicate handling and reconciliation. Phase 6 camera evidence is synthetic desktop input. QR suites were not repeated and no new sixteen-user optical-camera claim is made. |
| Offline billing and reconnect sync | **PASS — protocol/new; desktop/retained** | **New E8-03:** 16 unique user/device envelopes submitted together (8 per stall); 16 requests and receipts; 16 unchanged-ID retries return original identities. **Retained Phase 5 P5-01..09 / Phase 6 P6-04/05 / G07 fix:** actual desktop offline draft/outbox storage, four-profile concurrent recovery, lost acknowledgements, restarts, demotion/revocation and preserved conflicts. New envelopes are queued in test memory, not browser IndexedDB or airplane mode. |
| Basic reports | **PASS** | **New E8-06:** A has 2 finalized bills, due **20,000**, received **10,000** paise; B has 2, due **50,000**, received **25,000** paise. Own-stall bill/collection totals reconcile; Admin bill reads succeed and collections are denied. **Retained Reports/Settings final 17-case matrix:** broader totals, dates, financial projections, switching, paging and read-only behavior. |
| Sixteen simultaneous browser/PWA/IndexedDB profiles | **NOT TESTED** | No 8+8 browser run was performed. Existing desktop concurrency evidence covers four Admin profiles plus privileged profiles; API concurrency is not sixteen-browser acceptance. |
| Physical Android/optical QR and deployed-runtime parity | **NOT TESTED — owner-deferred until after deployment** | No physical devices or deployed environment used. Existing deferral and NO-GO decisions remain unchanged. |

## Exact new execution evidence

Command:

```text
node --test --test-concurrency=1 server/tests/twoStallEightLoginAcceptance.test.js
```

Final sanitized result: [af9c21a5-d68e-47c9-a5db-a0cb93f8de27.json](report-evidence/two-stall-eight-logins-2026-11-04/af9c21a5-d68e-47c9-a5db-a0cb93f8de27.json). Includes all six PASS scenarios, exact totals, baseline SHA-256, migration checksums used for fixture preparation and verification limits. Source backup SHA-256: `30541ce6067a9c3eac588d433f8f04f2fbc31fd00ff820d5c0d013c8c5f9f3b5`.

Retained canonical evidence: [Multi-Stall](MULTI_STALL_ACCEPTANCE_2026-11-03.md), [roles/isolation](ROLES_SEASONS_ISOLATION_ACCEPTANCE_2026-11-03.md), [billing/payment](BILLING_PAYMENT_ACCEPTANCE_2026-11-03.md), [four-Admin concurrency](FOUR_ADMIN_CONCURRENCY_ACCEPTANCE_2026-11-03.md), [offline/QR](OFFLINE_QR_FAMILY_PACK_ACCEPTANCE_2026-11-03.md), [G07 desktop fix](CACHE_DEMOTION_RECOVERY_ACCEPTANCE_2026-11-04.md), [Reports/Settings final acceptance](REPORTS_SETTINGS_FINAL_ACCEPTANCE_2026-11-03.md). Their original exclusions, historical failures and limits remain intact; historical unsupported Reports/Settings statements are superseded by the final acceptance report.

Four earlier harness attempts are preserved beside the final JSON. The first three stopped at existing validation guards because the harness initially omitted timestamp milliseconds, used noncanonical product IDs, then supplied catalogue entries outside the cart. The fourth reached payment creation but expected 200 instead of the documented 201 success status. Corrected only synthetic inputs/assertions; final report collection field uses the existing `collectedPaise` contract. These diagnostics are not application defect findings. Do not sum repeated setup/check counts across attempts or add retained phase totals into a unique test total.

No new application failure remains reproduced in the completed focused checks. Full 8+8 browser/device qualification remains NOT TESTED; production recovery/security/cutover approval is not implied.
