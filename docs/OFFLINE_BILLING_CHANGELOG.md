# Offline Billing changelog

## 2026-11-07 - Safe bill deletion blocked by core-change restriction

Task files only:

- `docs/OFFLINE_BILLING_CHANGELOG.md`: record the blocker; no application changes made.

Focused inspection of Bills & Sync cards and offline draft/status storage found no existing draft deletion or recoverable archive operation. Existing discard behavior belongs to failed/conflicted operation reconciliation and can cancel dependent operations; it is not a safe draft-delete handler. Saved operations enter the pending outbox, and drafts use revision checks and preserved versions for concurrent saves. Safe deletion requires a new atomic storage operation that checks current draft, operation and QR records and coordinates with saves; merely hiding a card would leave stored work and pending operations intact. These storage/workflow changes exceed the explicit instruction to leave existing core functionality unchanged. Delete was therefore not implemented, as requested for this blocker.

No checks run (documentation only). Existing application changes, QR records, payments, reconciliation data and history preserved. No Git commands, commit, push or deployment.

## 2026-11-07 - New Bill product company names

Task files only:

- `src/admin/components/OfflinePosWorkspace.jsx`: display each product's existing `company` field below its name when present, using the existing muted paragraph styling and wrapping long names on mobile, tablet and desktop. Catalogue products already retain this field; no snapshot/storage change required. Selection, actions, prices, cart, QR and sync unchanged.
- `docs/OFFLINE_BILLING_CHANGELOG.md`: this record. Existing changes preserved.

Verification: one targeted check, `node_modules/.bin/oxlint.cmd src/admin/components/OfflinePosWorkspace.jsx`, exited 0 with two existing react(set-state-in-effect) warnings at lines 37 and 77. No other checks, Git commands or deployment.

## 2026-11-07 - Mobile UI layout only

Task files only:

- `src/styles/offline-pos.css`: separate and stack mobile box/piece purchase rows, permit price/button wrapping, retain horizontal tablet/desktop rows, remove product-results height caps and nested scrolling, and place the bottom action bar and Review & Save in normal page flow.
- `docs/OFFLINE_BILLING_CHANGELOG.md`: this record.

Verification: one targeted JSX lint check of unchanged `src/admin/components/OfflinePosWorkspace.jsx` completed with exit 0 and two existing react(set-state-in-effect) warnings (lines 37 and 77). No check was run after the CSS-only edits. No tests, Git commands, backend/database changes or deployment. All handlers and functionality unchanged. Existing work preserved. Screenshots unavailable in this chat; implemented the written layout requirements.

## 2026-11-06 — Receiver verification status fix

Confirmed cause: `receive()` set “Verifying signed bill and intended recipient” before awaiting cached receiver preparation/key verification and signed sender verification, but its catch handler never cleared that progress message. Any rejected certificate, key, scope, recipient or signature check left the same apparent loading status. The asynchronous storage/WebCrypto path also had no deadline. No payload field mismatch or network dependency was found in that path; the actual mobile rejection cannot be identified without its error/state.

Task files only:

- `src/admin/components/OfflineHandover.jsx`: replace verification progress with explicit failure status on errors, preserve the detailed error, use bounded local verification, and ignore completed results after unmount. Sender generation and provisional acceptance are unchanged.
- `src/admin/offline/receiverVerification.js`: receiver-only local verification with stage-specific errors and a 15-second deadline; retains durable receiver preparation/signature/expiry/device/role checks and sender signature, signed grants, intended-recipient and workspace verification. A timed-out result cannot produce a preview or import a bill.
- `src/admin/offline/receiverVerification.test.js`: one focused check covering valid offline Super Admin verification, wrong recipient, tampered signature, missing/expired/revoked receiver preparation, a stalled storage promise and failure-status replacement.
- `docs/OFFLINE_BILLING_CHANGELOG.md`: this record.

Verification: `node --test src/admin/offline/receiverVerification.test.js` passed (1 test; network calls forbidden during verification). No other checks run. Physical camera/mobile IndexedDB/WebCrypto behavior was not reproduced; this establishes local verification and error/timeout handling, not that the user's physical phone now accepts its particular QR.

Preservation: read the Git index directly without Git commands; pre-existing tracked modification was `server/wrangler.toml`. New helper/test paths were absent before editing. Existing QR sender, cached preparation/storage, data, quantities, duplicate protection, receiver acceptance and reconciliation were not changed. No database/production changes, staging, Git commands or deployment.

## 2026-11-06 — Pending bill QR transfer completion

Root cause in the code: phone/catalogue preparation did not invoke QR preparation, so a saved pending bill could exist without a device certificate or cached eligible recipients. The disabled dropdown inherited the missing preparation state. The previous follow-up only explained this; it did not connect phone preparation to QR preparation. Bills & sync also lacked a direct action selecting the bill and opening its QR sender. The actual phone's IndexedDB is unavailable from this workspace, so its specific missing/expired/access state was not inspected.

Files changed by this task only:

- `src/admin/pages/AdminOfflineBillingPage.jsx`: online phone preparation now also requests QR preparation and persists its verified certificate and authorized recipient list in the same scoped profile. QR failures or an empty list are reported without discarding bills or failing ordinary catalogue preparation. Offline generation does not call an API.
- `src/admin/components/OfflinePosWorkspace.jsx`: add Send bill by QR to each saved bill; select that exact draft and open the workspace QR sender together.
- `src/admin/offline/handover.js`: check durable preparation, known revocation/read-only state, certificate expiry/signature, user/device/role/workspace and local signing key before generation; use the latest saved recipient list. Existing finalized Admin grant verification and immutable export identity remain intact.
- `src/admin/offline/storage.js`: verify the receiver's own current preparation before accepting, in addition to existing signed sender/payload verification, catalogue checks, duplicate detection and atomic provisional outbox persistence.
- `src/admin/components/OfflineHandover.jsx`: validate current receiver preparation before preview, block expired scanning/paste controls, suppress unavailable exports, and display signed-snapshot box, loose-piece, total-product-piece counts and calculated selling subtotal separately from a finalized agreement. Camera collection and pasted frames share verification; scanning alone still does not save, finalize or record payment.
- `src/admin/offline/handoverFlow.test.js`: isolated single pending bill, cached Super Admin selection after storage reopen, generation with network forbidden, out-of-order frame collection, verification, mixed-unit totals, provisional acceptance, duplicate protection, unauthorized recipient/tampered scope/signature rejection, receiver expiry and durable sender revocation.
- `docs/OFFLINE_BILLING_CHANGELOG.md`: this record.

Existing working-tree inspection: compared tracked file blob hashes against the index without Git commands; only `server/wrangler.toml` already differed. This changelog already existed. Earlier task changes, existing guides/untracked artifacts and all unrelated work were preserved. No schema or production data changes, Git commands or deployment.

Two targeted check invocations only: the first reached offline acceptance and security checks but failed because its final revocation fixture used activation, which deliberately retains durable authority. Corrected the fixture to simulate a durable revoked record. The second/final invocation passed that complete transfer test and in-memory compilation of the Offline Billing page. No broad tests. Native camera/browser interaction and live server reconciliation were not exercised; existing reconciliation code and live server membership/device/claim checks were left unchanged. Offline checks enforce cached known revocation; newly changed server access can only be learned after reconnection.

## 2026-11-06 — QR recipient dropdown follow-up

This task changes only:

- `src/admin/components/OfflineHandover.jsx`: explain the recipient dropdown's preparation, empty-list, expired and workspace-lock states beside the control; offer an adjacent online preparation action; display cached authorized options after preparation; clear recipients removed by refresh; require current cached-list membership to enable QR generation. Empty and expired preparations cannot be used to select a recipient. No arbitrary offline entries or automatic receiver selection.
- `docs/OFFLINE_BILLING_CHANGELOG.md`: this follow-up record. Earlier task files and all other existing work are excluded from this task's staging command.

Cause: the dropdown inherited `disabled` from its enclosing fieldset when `profile.handover` was absent or the workspace was locked. Its options came exclusively from `profile.handover.recipients`; an empty server-authorized list offered only the placeholder. Catalogue preparation and Owner billing grants do not populate that list. The existing QR endpoint, verified preparation storage and parent reload already carry successful online preparation into the profile; no server authorization bypass or recipient-loading API change was needed. The UI now exposes the necessary preparation/access action beside the dropdown and handles expired preparation and refreshed selections explicitly.

Recipient eligibility still requires active Owner / Super Admin membership in both the season and stall under the server's existing effective-role rules. Signed certificates/grants, scoped storage, device key verification and generation/acceptance validation are unchanged.

One targeted check: in-memory JSX compilation and React server rendering of the QR handover component passed for missing preparation, valid cached recipients while offline, an empty authorized list and expired preparation. No browser/device interaction test, Git commands or deployment.

## 2026-11-06

Task files only:

- `src/admin/components/OfflinePosWorkspace.jsx`: reuse Quick Bill's search matching with existing category/pack filtering; add explicit loose-piece selection and price; retain separate box/piece lines; show box, loose and total-piece quantities; prevent duplicate unit changes and invalid saves; limit new lines to 50.
- `src/admin/offline/offlineCart.js`: offline catalogue availability and loose-sale validation, bounded quantity and duplicate checks, product/unit additions, and safe unit switching. Switching units retains the numeric count and clears the previous per-unit price override; if the destination unit already exists, update that line instead. No silent quantity merges or box-to-piece price carryover.
- `src/admin/offline/posPresentation.js`: show box/loose/total-piece counts and reject invalid quantity or price totals. Piece pricing retains Quick Bill's `floor(box price in paise / pieces per box)` rule; mixed box and piece lines retain their own prices without re-bundling.
- `src/admin/pages/AdminOfflineBillingPage.jsx`: validate saved catalogue units, availability, quantities and duplicate lines before capturing CREATE/EDIT operations.
- `src/admin/offline/offlineCart.test.js`: focused regression coverage for mixed units, rounding, persisted JSON and QR line snapshots, unit changes, quantity limits, duplicates and unavailable loose sales.
- `docs/OFFLINE_BILLING_CHANGELOG.md`: this task record.

Pre-existing work (excluded from this task):

- Read the complete `docs/OFFLINE_BILLING_USER_GUIDE.md` before implementation. It and `docs/OFFLINE_BILLING_NAVIGATION_STALL_SETUP_2026-11-05.md` were already untracked and were not edited.
- Read the index directly and compared working-file blob hashes without running Git commands. `server/wrangler.toml` already differed from the index and was not edited.
- Existing untracked environment files, repair/cleanup documents, reports/evidence, scripts, SQL/backups and local runtime/database artifacts were left untouched. Files absent from the index were treated as pre-existing candidates regardless of ignore rules.

Verification (two targeted checks):

- `node --test src/admin/offline/offlineCart.test.js src/admin/offline/posPresentation.test.js`: 5 passed. Retried outside the sandbox after subprocess EPERM.
- In-memory esbuild bundle of `src/admin/pages/AdminOfflineBillingPage.jsx` with CSS omitted: passed. Corrected an unavailable local esbuild path to the existing server installation, then retried outside the sandbox after subprocess EPERM. No bundle files written.

Quick Bill, storage/recovery, QR/payment processing, scoped authorization and database schemas were not edited. No production records changed; no Git commands or deployment. Browser interaction and real-device offline recovery/QR/payment flows were not exercised.
