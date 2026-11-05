# Phase 3 — Roles, Seasons & Isolation acceptance

**12 PASS, 0 FAIL, 0 NOT TESTED, 0 NOT IMPLEMENTED for the requested Phase 3 matrix, within the existing desktop/local implementation.** This combines retained Phase 2 evidence with six new focused acceptance checks. The 13 completed Phase 2 PASS scenarios were not rerun. No critical requested boundary remains unverified within this scope. This does not declare the overall release ready: Phase 2's unavailable reports/settings and physical Android acceptance remain outstanding.

Read and retained [the previous Multi-Stall report](MULTI_STALL_ACCEPTANCE_2026-11-03.md). A PASS marked **retained** below refers to its saved runtime evidence, not a new execution or a code-review inference.

## Environment and preservation

Used the same established isolated clone and disposable D1:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

Evidence abbreviations:

- `P2`: the root's existing `p2-d8b31a19` directory; saved artifacts unchanged.
- `P3`: the root's new `p3-4d7319f8` directory.
- Worker: `http://localhost:8793`, using the existing isolated configuration and persistence directory, location mode enabled, local auth bypass disabled.
- Frontend: `http://localhost:5193`, serving the existing isolated `frontend-dist` build. No rebuild or deployment.

New work used four new password-authenticated identities: controller, subject, sender and recipient. New memberships reference the established fixture stalls. Only these new identities' memberships were changed/removed. The subject began as A Super Admin / B Admin; its A role was demoted to Admin during an actual browser network disconnection, then A membership was removed. The QR sender's new A membership was removed, and the recipient's new A role was demoted. Two new historical memberships were subsequently inserted for the controller's archived-season browser check. Existing users, memberships, prices and transactions were not changed.

`P3/before.sqlite` was captured read-only before fixture insertion. Final read-only verification against the disposable database confirms **all 2,751 pre-existing rows across 34 tables are unchanged**, including Phase 2 fixtures, sessions and historical records. Schema and migration records are unchanged; integrity is `ok`; foreign-key violations are zero. Only SQLite/Cloudflare internal counters are excluded. Verification never opens an original database.

No migrations, Git commands, production access or deployment occurred. No missing reports/settings or other enhancements were implemented. No release-blocking application defect was reproduced, so no runtime fix was made.

## Requested scenario matrix

| # | Scenario | Result | Evidence and observed boundary |
| --- | --- | --- | --- |
| 1 | Owner, Super Admin, Admin and Platform Admin authorization | **PASS** | **Retained:** P2 HTTP-06/09, SUPPLEMENT-01, BROWSER-01/04. Operational authority follows effective memberships; Platform Admin without stall membership receives 403 on operational routes; operational Owner receives 403 on Platform routes. **New:** P3-OFFLINE-01 confirms current Admin authority supersedes captured Super Admin authority. |
| 2 | Same user with different roles across two stalls | **PASS** | **Retained:** P2 HTTP-02/12 and BROWSER-01 establish A Owner, later Super Admin, versus B Admin. **New:** subject captures operations as A Super Admin, becomes A Admin, then loses A; the same cookie continues to identify B Admin. |
| 3 | Membership removal from one stall preserves another | **PASS** | **Retained:** P2 HTTP-12. **New:** P3-OFFLINE-02: A sync/receipt replay returns 403 after removal; B session and catalogue return 200, effective role Admin, same cookie; all local operation IDs retained. |
| 4 | Last-owner protection | **PASS** | **Retained:** P2 HTTP-11, before new Phase 3 memberships were inserted: sole B Owner season demotion and disable each returned 409; self-removal returned 400. P2 HTTP-01 also records duplicate ownership/provisioning conflict 409. These destructive boundary attempts were not repeated. |
| 5 | Owner/Super Admin-only pricing, finalization and payment | **PASS** | **Retained:** P2 HTTP-06 and SUPPLEMENT-01: Owner/Super Admin finalize/pay; Admin cannot finalize/pay or access private purchase/X4 rates. **New:** P3-OFFLINE-01: agreement, closure and payment direct sync requests with captured Super Admin role each return 403 after demotion; financial edit also 403. |
| 6 | Admin restrictions on purchase price, profit and financial modifications | **PASS** | **Retained:** P2 SUPPLEMENT-01 GET/PUT purchase/private rates 403; BROWSER-01 hides privileged pricing controls. **New:** P3-OFFLINE-01 Admin offline-request snapshot excludes purchase/profit/margin/finalSubtotal/bargainFloor data, financial unit-rate override returns 403, server request remains quoted at revision 6. Focused local regression also rejects Admin payment/financial draft operations atomically. |
| 7 | Active-season isolation within each stall | **PASS** | **Retained:** P2 HTTP-08 transaction/season separation and HTTP-10 mutated offline season denial. **New:** P3-HISTORY-01: both A and B reject archived-season catalogue context with 403. P3-SEASON-BROWSER-01: actual active-to-archived switch prevents active draft dispatch; return to active A restores the original local draft/outbox IDs and catalogue. |
| 8 | Historical-season read/access restrictions | **PASS** | **Retained:** P2 HTTP-08: authorized historical read succeeds, archived writes fail, active/historical transaction IDs do not cross. **New:** P3-HISTORY-01 denies a historical request without historical membership (403). After explicit new historical membership grant, P3-SEASON-BROWSER-01 reads that request (200), rejects archived device registration (403), and creates no writable archived offline profile. |
| 9 | Direct API requests with foreign stall/season IDs | **PASS** | **Retained:** P2 HTTP-04/07/08/10 and SUPPLEMENT-01/02 cover product/category/request/quotation/payment/status/private-rate IDs, scope injection and signature-valid foreign business/season transfers. **New:** P3-HISTORY-01 rejects mismatched A/B historical contexts; direct demoted/revoked-user sync requests are denied independently of UI controls. |
| 10 | Frontend, API, IndexedDB, catalogue and outbox scope consistency | **PASS** | **Retained:** P2 BROWSER-01/02/03 verify actual A/B UI reset, API headers and separate IndexedDB drafts/catalogues/outbox. **New:** P3-SEASON-BROWSER-01 verifies historical API headers, hidden active draft, disabled dispatch, unchanged IndexedDB state and restoration to A. P3-OFFLINE-01/02 retain immutable operation IDs across role/membership changes. Focused storage regression checks business/location/season/user/device key separation using fake IndexedDB. |
| 11 | Offline role changes and server revalidation during synchronization | **PASS** | **New:** P3-OFFLINE-01/02, detailed below. Actual offline capture, API role demotion, reconnect/sync denial, retained pending descendants, refreshed local role and independent direct API denials; removed membership also blocks replay of a previously acknowledged CREATE. |
| 12 | QR recipient and business/season authorization | **PASS** | **Retained:** P2 HTTP-10 and SUPPLEMENT-02 cover signed business/location/season boundaries. **New:** P3-QR-01 independently verifies the signature, rejects a different authorized Owner with 400 `invalid_transfer`, then accepts the intended recipient with 200. P3-QR-02 returns 403 `sender_denied` after sender removal and 403 `forbidden` after recipient demotion despite prepared certificates. Admin is excluded from eligible recipients. |

## New focused execution

**P3-OFFLINE-01:** In a new Chrome profile, the subject prepared A as Super Admin, created and synchronized a new fixture request, then disconnected using Chrome network emulation. It queued AGREEMENT, CLOSE and PAYMENT while offline. A separate controller session changed only this new subject's A role to Admin through the real role API. Upon reconnection, synchronization refreshed the saved profile to Admin and the agreement failed with 403; closure/payment remained pending behind it. All four original IDs, including the acknowledged CREATE, survived. The closure control became unavailable. Independent direct API submissions for all three privileged operation types and a financial unit-rate EDIT returned 403. The request stayed quoted at revision 6.

**P3-OFFLINE-02:** After removal of the subject's A membership, replaying its original acknowledged CREATE returned 403. Its B session/catalogue remained usable as Admin with the same session cookie. No queued local operation was deleted or rewritten.

**P3-QR-01/02:** Real registered device keys and server-signed preparation certificates were used. Transfer signatures were independently verified with the public root before the rejection checks. The wrong Owner could not consume the intended recipient's transfer; the intended recipient then successfully accepted it. New transfers prepared before sender removal or recipient demotion were rejected after those changes. These checks supplement the retained signed business/season evidence; they do not replay the Phase 2 cross-business suite.

**P3-HISTORY-01 / P3-SEASON-BROWSER-01:** A current controller membership initially grants no historical access. After inserting explicit historical memberships for this new controller only, a new browser profile queues an active A draft, switches to the archived season/location, and confirms that the A draft cannot be viewed/dispatched there. Historical read is allowed and archived device registration denied. Actual historical requests carry the historical location/season headers. All stored profiles, catalogue snapshots, drafts and outbox entries remain unchanged; switching back restores A's original operation identity. Seasonal historical locations use distinct physical identities under the existing implementation. Permanent-location catalogue reuse across seasons remains intentional, as documented in Phase 2.

Three additional focused regressions passed in `src/admin/offline/offline.test.js`:

```text
node --test --test-name-pattern='all local stores|atomic draft/outbox|expired authentication and permission' src/admin/offline/offline.test.js
3 PASS, 0 FAIL, 8 skipped by name filter
```

These exercise storage scope separation, atomic rejection of Admin financial operations, and retention/dispatch stopping after permission or authentication errors. They use `fake-indexeddb`; actual Chrome IndexedDB behavior is separately covered by the browser evidence above. No server unit suite that constructs/migrates another database was run. Focused lint of all four added JavaScript harnesses passed without diagnostics.

## Evidence and harness corrections

Private evidence stays under `P3`:

- `state.json`, `seed.sql`, `historical-controller-membership.sql`, `before.sqlite`: new fixtures and preservation baseline. Credentials remain private.
- `offline-browser-1793707453243.json`: original capture/demotion attempt. Core rejection/storage observations reached, then the harness incorrectly assumed optional QR preparation existed.
- `offline-browser-1793707504463.json`: resume-only harness failure opening an existing profile directory.
- `offline-browser-1793707520657.json`: resume-only harness failure waiting for a login form despite an existing authenticated session.
- `offline-browser-1793707607967.json`: final **two PASS** offline checks, resumed from the original capture. No recreation, second demotion or Phase 2 scenario replay. It references the original attempt and preserves its traces.
- `qr-history-1793707582109.json`: **three PASS** QR/history checks and sanitized HTTP statuses/errors.
- `season-browser-1793707717321.json`: **one PASS** season-switch browser check and scoped API trace.
- `preservation.json`: first successful preservation check.
- `preservation-1793707754120826200.json`: final preservation check after the additional historical membership/browser work.

Earlier harness FAIL entries are retained, not erased or classified as application failures. Corrections made optional-preparation assertions accurate and allowed resumption of the existing profile/session. Completed test actions were not restarted. Browser requests outside the local frontend/API were blocked; the attempted Google Fonts origin was recorded as blocked. Credentials, cookies, tokens, signing secrets and browser profiles were not copied into this report.

Added acceptance tooling:

- `server/scripts/roles-isolation-prepare.mjs`
- `server/scripts/roles-isolation-browser.mjs`
- `server/scripts/roles-isolation-qr.mjs`
- `server/scripts/roles-isolation-season-browser.mjs`
- `server/scripts/roles-isolation-db.py`

Do not rerun fixture preparation or mutate the saved run simply to inspect evidence. The browser runner accepts the original attempt path to resume its unfinished offline checks; that completed resume should not now be rerun after membership removal.

## Release disposition

Phase 3's requested authorization, season and isolation boundaries are verified for the existing desktop/local implementation, using retained evidence where reruns were prohibited. New focused acceptance: **6 PASS**, plus **3 PASS** storage regressions and final preservation **PASS**. No application changes require a wider regression run.

The tests establish server enforcement at reconnect/synchronization. A disconnected device cannot learn a remote role change until it reconnects; provisional operations remain local until acknowledged. The test did not prepare a privileged QR private catalogue in the subject browser, so its empty private-catalogue observation is not evidence of purging a previously populated private QR cache.

Physical Android installation/camera/device behavior remains outside this desktop phase. Phase 2's unavailable standalone reports and stall settings, customer directory and quantity ledger retain their prior dispositions; they were neither retested nor implemented. Overall final release readiness remains conditional on those earlier acceptance decisions and device testing.
