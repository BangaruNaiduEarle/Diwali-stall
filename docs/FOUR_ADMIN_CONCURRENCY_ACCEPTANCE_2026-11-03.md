# Phase 5 — Four-Admin Concurrent Synchronization acceptance

**15 requested scenarios PASS; zero FAIL, NOT TESTED or NOT IMPLEMENTED in the verified local/desktop concurrency matrix.** Nine focused browser/Worker checks and the final read-only database audit passed. The verified run uses four independent Admin accounts and Chrome profiles plus separate Owner and Super Admin profiles. No critical requested concurrency scenario remains unverified within this scope. Overall release approval is not declared.

Read the [original release report](RELEASE_READINESS_2026-11-03.md), [blocker fixes](RELEASE_BLOCKER_FIXES_2026-11-03.md), [Multi-Stall acceptance](MULTI_STALL_ACCEPTANCE_2026-11-03.md), [Phase 3](ROLES_SEASONS_ISOLATION_ACCEPTANCE_2026-11-03.md), [Phase 4](BILLING_PAYMENT_ACCEPTANCE_2026-11-03.md), and the newer [server-tooling security report](SERVER_TOOLING_SECURITY_2026-11-03.md). Earlier completed phases were not rerun. The security follow-up resolves the server-tooling findings that were still listed as outstanding in Phase 4; this phase does not repeat that registry audit.

## Established environment and new fixtures

Same isolated clone/disposable D1 root, abbreviated `RUN`:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

Phase 5 evidence, abbreviated `P5`: `RUN/p5-218d6b5a`.

- Actual Worker: `http://localhost:8793`, existing isolated configuration and `persist` directory. Location mode enabled; password/session authentication enabled; local auth bypass disabled.
- Existing isolated frontend build: `http://localhost:5193`, `RUN/frontend-dist`. Already running; no rebuild or deployment.
- New business: `p5-218d6b5a-business`; new stalls `p5-218d6b5a-a` and `p5-218d6b5a-b`; three new products.
- Operating seasons: existing `season-2026` and new active fixture season `p5-218d6b5a-alt`. Explicit memberships in both stalls/seasons allow scope rejection to be tested independently of missing membership.
- New accounts: Admin 1–4, Owner and Super Admin. Each has its own password login/session and registered device context. Effective Admin authority remains Admin despite a higher global account role.
- Verified profiles: `P5/browser-admin1-verified` through `browser-admin4-verified`, `browser-owner-verified`, `browser-super-verified`; six independent headless Chrome processes/IndexedDB contexts. Browsers were closed after evidence capture.

Preparation captured `P5/before.sqlite` read-only before adding any fixtures. Only new Phase 5 records were written. No original databases or production were accessed; no migration, deployment or Git command ran. No runtime, shared workflow, UI, dependency or configuration code changed. Only acceptance tooling and this report/matrix were added.

## Requested scenario matrix

| # | Scenario | Result | Test names and evidence |
| --- | --- | --- | --- |
| 1 | Four Admins create different requests simultaneously | **PASS** | P5-01/02: four independent profiles create distinct offline drafts; their first CREATE requests are all held at a browser network barrier, then released together. Four distinct server requests result. Release acknowledgements span 120 ms. |
| 2 | Each Admin adds/removes products and changes quantities offline | **PASS** | P5-01: each adds two products, queues CREATE, changes the retained product quantity to 2/3/4/5, removes the second product and queues dependent EDIT, with no network. Separate IndexedDB outboxes retain all eight identities and the CREATE→EDIT dependencies. |
| 3 | All four reconnect and synchronize concurrently | **PASS** | P5-02: four outstanding browser sync requests released together; remaining operations/recovery use the real application sync controls and Worker/D1. Two unaffected profiles finish while the faulted profiles remain pending. |
| 4 | Every request created exactly once | **PASS** | P5-02/03/09 and SQL audit: the four primary requests each have one CREATE receipt. All eight expected final requests exist; no unexpected request or duplicate active quotation exists. |
| 5 | Retry after simulated timeout/lost response | **PASS** | P5-02: Admin 1's successful CREATE response is inspected at Chrome's response stage, then discarded before client delivery; connection goes offline. The server commit exists but the browser retains the operation as pending. Retry uses the identical operation ID and returns the original receipt/request; its dependent edit then completes. This is lost-response/network-failure simulation, not a wall-clock timeout benchmark. |
| 6 | Concurrent duplicate operations | **PASS** | P5-03: one previously uncommitted browser CREATE and three simultaneous direct copies using that same authenticated device/payload produce one winning commit and three replays, all pointing to one request. P5-07 repeats concurrent same-identity delivery for payment and QR acceptance. |
| 7 | Unique operation IDs and atomic sync receipts | **PASS** | P5-03/09 plus SQL: 21 distinct durable operation IDs, exactly one receipt for each of 16 acknowledgements, no receipts for five conflicts. Every receipt matches its completed request revision and audit event. No partial receipt/request/quotation/payment/claim is present. |
| 8 | Partial synchronization and interrupted connections | **PASS** | P5-02: Admin 2's CREATE is acknowledged, then its dependent EDIT is interrupted before dispatch and the browser is disconnected. CREATE remains synced, EDIT pending; retry sends the same EDIT. Admin 1 independently retains an unacknowledged committed CREATE. Other profiles finish without waiting for them. |
| 9 | Acknowledged operations never become new transactions on retry | **PASS** | P5-02: a later manual sync after recovery produces zero additional sync POSTs for the acknowledged outboxes. P5-03/07: direct duplicate retries return original identities. P5-09/SQL retain acknowledgement/receipt identity across browser resumption. |
| 10 | Two Admins edit the same request offline; stale conflict preserved | **PASS** | P5-04: both download the same revision, queue distinct 18/19 quantities offline, then release EDITs together. Admin 2 wins with 19; Admin 1 gets 409 and retains quantity 18 plus the server version. An earlier retained race also preserves its losing operation and shows independent CREATEs behind that conflict still completing. |
| 11 | Owner finalizes while an Admin has an older pending revision | **PASS** | P5-05: Admin 4 queues quantity 99 offline; Owner saves ₹420 agreement and finalizes the server bill. Later Admin EDIT returns 409 with a closed server snapshot; quantity 99 remains local, server quantity 5/due 42,000 paise and finalization history remain unchanged. |
| 12 | Competing Owner/Super Admin offline closures become explicit conflicts | **PASS** | P5-06: both prepare the same agreed request revision, queue CLOSE offline and release together. Owner wins; Super Admin gets 409, keeps the provisional closure and closed server snapshot. Exactly one finalizer/account persists. |
| 13 | Payments and QR remain idempotent | **PASS** | P5-07: a queued offline payment and three concurrent direct copies yield one ₹100 ledger entry/receipt. A real Admin-generated signed QR is accepted twice locally, retaining one HANDOVER; browser sync plus three copies retain one server claim/receipt/request. Signature independently verified. The late source CREATE becomes a preserved conflict rather than a second request. |
| 14 | Cross-stall/cross-season operations rejected | **PASS** | P5-08: three payload scope mutations and two mismatched request-context submissions all return 409. Actual foreign request snapshot reads return 404 in both other-stall and other-active-season contexts despite explicit memberships. SQL confirms all new business writes stay in A/2026. Earlier phases' broader scope suites were not repeated. |
| 15 | Actor, device, occurred_at and received_at metadata | **PASS** | P5-01/09 and SQL: four distinct Admin/device identities; all 16 receipts match payload actor/device/captured role/occurrence time, acknowledgement revision and final operation audit event. Receipt/event received times are populated. Payment and QR creator/recipient device histories are independently validated. |

[Machine-readable matrix](FOUR_ADMIN_CONCURRENCY_ACCEPTANCE_2026-11-03.json) contains the same 15 dispositions and evidence references. Scenario rows are not a count of unique automated checks.

## Four-profile interruption and recovery

This table describes the initial four-way recovery, before the later intentional edit/finalization races:

| Profile | Fault / partial state | CREATE attempts | EDIT attempts | Final request items after recovery |
| --- | --- | --- | --- | --- |
| Admin 1 | Committed CREATE response lost; both operations remain pending locally | 2 | 1 | One product, quantity 2 |
| Admin 2 | CREATE acknowledged; EDIT interrupted before dispatch | 1 | 2 | One product, quantity 3 |
| Admin 3 | No injected interruption | 1 | 1 | One product, quantity 4 |
| Admin 4 | No injected interruption | 1 | 1 | One product, quantity 5 |

The barrier retains all four request interceptions before continuing them in one concurrent release. The first/last continuation acknowledgements differ by **120 ms**; no request waits for a previous profile's application response before its own submission. D1 may serialize writes internally, as expected. This is concurrent submission/recovery evidence, not a throughput or physical-device timing benchmark.

Admin 1's lost response carried a real successful acknowledgement before being dropped: original request `bc5026bc-60c9-4566-9f34-b2d1214a702a`, CREATE operation `d2a5e2db-af77-4f78-bcaa-bfac75ca627f`. Recovery returns that same identity. Admin 2's acknowledged prefix survives its independent connection interruption. Admin 3/4 completed while 1/2 remained pending; independent requests are not held behind another device's failed chain.

Later, independent CREATEs behind an Admin's 409 conflict were also processed. The synchronizer preserves the conflicting chain without blocking unrelated drafts. All acknowledgements and conflicts survive a full close/reopen of the six profiles during focused resumption.

## Database and local-state integrity

Final read-only audit verifies:

- **3,127 pre-existing rows across 34 tables unchanged**, including all previous phase transactions, users, sessions, offline/QR and Family Pack data. SQLite/Cloudflare internal counters excluded.
- Schema and complete migration records unchanged; SQLite integrity `ok`; zero foreign-key violations.
- Exactly **8 expected new requests**: four primary requests, one virgin duplicate-delivery fixture, two independent requests behind the first edit race, and one QR source/recipient request. Every request has one active quotation; no extra request exists from any retry.
- **21 unique durable operations** in the six verified profiles: **16 acknowledged**, **5 preserved conflicts**, no pending/syncing/failed operations in that verified run.
- Exactly **16 immutable sync receipts**, one per acknowledged operation. All five conflicting IDs have **no receipt**. Receipt/request revisions and business/location/season/user/device scopes agree with saved browser acknowledgements and workflow events.
- **91 workflow events**, with contiguous revisions from 1 to each request's latest revision; no audit gaps or foreign scope writes.
- Exactly **2 finalized accounts**, **1 payment ledger entry** and **1 QR claim**. The paid bill remains due 42,000, received 10,000, outstanding 32,000 paise. Concurrent retries add neither another payment nor another QR claim.
- The shared-edit winner remains quantity **19**. The finalized bill remains quantity **5**, not the Admin's stale **99**. The winning finalizer matches the recorded Owner closure; the losing Super Admin operation remains local.
- Original QR creator remains Admin 3, recipient Owner; claim/device/receipt histories preserve both identities. The source CREATE is not counted as a second request.

The five deliberately preserved conflicts are: two losing shared-edit attempts (one diagnostic attempt plus the properly loaded-snapshot race), the older Admin edit after Owner finalization, the losing Super Admin closure, and the late QR source CREATE. Four have server snapshots; the unsynchronized CREATE conflict has no server snapshot attached automatically, but its source payload and the single corresponding server request/claim remain preserved. No automatic merge or conflict discard was performed.

The HANDOVER transport envelope resolves to a CREATE for this unsynchronized QR source. The existing receipt schema therefore records operation type CREATE, while `request_handover_claims` records transfer/initiator/recipient identities. The read-only audit checks that existing model rather than expecting a new HANDOVER receipt enum. No schema or runtime change was made.

## Focused test index

| Test | Name | Result |
| --- | --- | --- |
| P5-01 | Four isolated Admin profiles create and edit independent requests offline | PASS |
| P5-02 | Four-way barrier release, lost committed response, partial prefix and unchanged-ID recovery | PASS |
| P5-03 | A virgin browser CREATE and concurrent duplicate submissions share one atomic receipt | PASS |
| P5-04 | Two Admins race an offline edit; conflict keeps both versions while independent drafts sync | PASS |
| P5-05 | Owner finalization cannot be overwritten by older Admin offline items | PASS |
| P5-06 | Competing Owner and Super Admin offline closures retain one winner and one conflict | PASS |
| P5-07 | Offline payment duplicate delivery and QR duplicate acceptance stay idempotent during recovery | PASS |
| P5-08 | Mutated scopes and foreign direct IDs are rejected after concurrent synchronization | PASS |
| P5-09 | All profiles retain immutable operations and conflict snapshots with independent acknowledgements | PASS |
| DB-PRESERVATION | Pre-existing rows/schema/migrations, complete request/receipt/audit/payment/claim integrity | PASS |

Browser requests outside the local frontend/API were blocked, including the attempted Google Fonts request. QR uses the application's real generation, pasted-frame verification/preview and acceptance controls. It does not exercise a physical camera. Duplicate network copies use the original profile's authenticated cookie, registered device token and unchanged operation payload; separate accounts do not impersonate one another.

No reproducible application critical defect was found. Only harness readiness, serialization assertions and diagnostics were corrected. Focused lint of all three new JavaScript files passes without diagnostics. No application fix requiring regression tests was made; completed billing, isolation, offline, QR and Family Pack suites were not rerun.

## Evidence and harness failures retained

All private evidence is under `P5`; credentials/tokens remain in private fixture/profile storage, not this report or the public matrix.

- `before.sqlite`, `state.json`, `seed.sql`: baseline and newly added fixture identities/scope.
- `browser-progress-verified.json`: checkpointed nine PASS results, sanitized browser/HTTP traces, fault/barrier records, immutable operation payloads and final six-profile summaries.
- `browser-results-1793709828200.json`: final **9 PASS / 0 FAIL** verified browser result, including prior diagnostics/resumption references.
- `preservation-1793710159232089700.json`: final read-only **PASS**, 3,127 preserved rows plus the complete 8-request/16-receipt/91-event audit and per-receipt metadata, including explicit actor name/effective-role checks.
- `preservation-1793709897396258300.json`: preceding passing audit retained before the additional actor name/effective-role assertions.
- `browser-results-1793709716471.json`: first verified-profile execution, three PASS checks followed by the shared-edit harness assertion failure. Its completed tests and business records were retained.
- `browser-results-1793709381882.json`, `browser-results-1793709434010.json`, `browser-results-1793709564208.json`, `browser-progress.json`: earlier login/diagnostic/queue-readiness failures. These did not send a business sync request. Their unsynchronized profiles/drafts are retained separately; they are not included in the verified six-profile operation totals and must not be synchronized merely to inspect evidence.
- `browser-admin1`, `browser-*-concurrency`: earlier diagnostic profiles, preserved. The accepted run uses only the distinct `browser-*-verified` profiles listed above.

Harness corrections and their impact:

1. A login readiness expression returned a DOM element that Chrome could not serialize by value. Changed it to an explicit Boolean. The failed attempt was before authentication/request creation.
2. A storage-diagnostic expression had a syntax error, and initial queue actions lacked waits for completed durable writes. Added safe pre-initialization diagnostics, deterministic outbox ordering, durable queue completion/readiness waits, and startup dispatch suspension. Preserved the unsynchronized diagnostic profiles and moved to fresh profiles using the same new accounts and disposable database. No business request from those earlier profiles was submitted or deleted.
3. The first shared-edit attempt changed an older editor while a fresh snapshot was still downloading. The server correctly retained one winner and one 409; the harness's intended quantity assertion failed. Preserved both operations, their local versions/conflict, and the two independent requests that had already synced. Added an explicit wait for a newly persisted downloaded draft and completed UI readiness. Resumed only P5-04 and remaining work, using freshly loaded revision and explicit quantities 18/19. P5-01/02/03 were not repeated. The additional race adds one valid receipt and one retained conflict, explaining the final 21-operation/16-receipt totals.
4. The first read-only audit expected a HANDOVER receipt type. Corrected that test assertion after inspecting the existing resolved-CREATE/claim schema; no business writes or browser cases were repeated for this correction.

Failed harness attempts are not erased or relabeled as successful executions. The final scenario PASS dispositions rest on the completed verified browser observations plus the independently checked D1 rows. The report distinguishes earlier unsynchronized diagnostic drafts from server business transactions.

Added tooling: `server/scripts/concurrent-sync-prepare.mjs`, `concurrent-sync-browser-client.mjs`, `concurrent-sync-browser.mjs`, `concurrent-sync-db.py`. Do not rerun preparation or synchronize abandoned diagnostic profiles to read results. The saved verified PASS checks are checkpointed and should not be repeated merely for inspection.

## Unresolved risks and disposition

All requested local concurrency boundaries have verified PASS evidence. Five conflicts intentionally remain available for explicit user review; the test does not silently resolve or overwrite them. No lost/duplicate server request, bill, receipt, payment or claim was found.

Remaining acceptance limits:

- Four physical Android devices, real mobile-network timing, device storage/reboot behavior and physical QR camera scanning remain unverified; this run proves desktop Chrome/IndexedDB with controlled network faults.
- Production HTTPS/cookies/routing and deployment/runtime parity remain outside the isolated Worker configuration, including its existing compatibility-date limit.
- Four simultaneous Admins are tested; this is not an unbounded load/soak or throughput qualification.
- Earlier standalone report/settings and related feature-acceptance gaps retain their prior dispositions. No missing feature was implemented here.

The newer server-tooling security report records the prior audit findings resolved; no fresh vulnerability finding or tooling remediation is claimed in this phase. **Phase 5 is verified for the requested local/desktop scope. Overall final release readiness still requires the remaining device, parity and earlier feature-acceptance decisions.**
