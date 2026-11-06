# Offline Billing changelog

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
