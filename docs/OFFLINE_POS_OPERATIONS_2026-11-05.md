# Offline POS operational correction — 5 November 2026

Phase 1 baseline record. The subsequent [Phase 2 implementation](OFFLINE_BILLING_PHASE_2_2026-11-05.md)
adds scoped signed Admin grants and finalized-bill payment handoff. Its explicit
grant policy supersedes the unrestricted Phase 1 statement that Admin can never
finalize; ordinary Admin permissions remain unchanged without a valid grant.

Local implementation and isolated acceptance only. No deployment, production
access, original Local D1 inspection, account changes or migrations on existing
storage. Pre-existing working-tree changes were retained.

## Findings and implementation

| Operational gap in the previous implementation | Correction |
| --- | --- |
| Every keystroke sets `saving`; the UI included `saving` in the input-disabled condition, interrupting browser focus and selection. | Editable inputs stay enabled during autosave. Save/queue/context-changing actions still wait for persistence. Stable line IDs are created when ordinary products are added. |
| Items, Review and Payment were separate screens with repeated movement. | Continuous customer/catalogue/review editor; payment appears after explicit finalization. Small product rows and bounded results on phones; fixed cart total and main action. Cart quantities, units and removal remain available. |
| Owners/Super Admins could queue bargain-mode creation without the agreement required by the Worker. | An unagreed request uses the existing selling mode. A supplied positive agreement uses bargain mode. No validation or backend authorization is weakened. |
| Saved profiles for another selected, already prepared stall required preparation again. | Restore the exact saved business/stall/season/user/device profile and catalogue after authenticated selection. No new registration/download is needed. Unprepared contexts require setup. |
| A single authorized non-original stall still required manual selection. | The offline route selects a unique authorized context through normal verified session selection. Multiple choices remain explicit. Online billing routes and the shared session provider are unchanged. |
| Catalogue refresh discarded the selected editor and QR setup. | Explicit Update saved catalogue retains the current same-scope editor and compatible QR preparation. Changed/revoked authority requires fresh QR preparation. Existing queued payloads stay immutable. |
| Installation was only a static instruction; profile preparation could be confused with reload readiness. | Browser install-event handling plus manual Android instructions. Accepted installation requests await browser confirmation. Listeners remain mounted while setup completes. Installation, catalogue, reload cache and local save states are separate. |
| Offline reload readiness was not rechecked after reopening. | Ask the active service worker to check every allowlisted cached asset and workspace HTML without downloading anything. Missing cache means readiness is unconfirmed. |
| Fifteen-second automatic synchronization could interrupt editing, and only the selected bill's snapshot refreshed. | One explicit Synchronize control, visible progress, per-operation receipts and per-bill summaries. Refresh all acknowledged bill snapshots, including previous customers. Failed/conflicting chains remain preserved. |
| QR generation prerequisites and the continuation after acceptance were unclear. | Optional Workspace disclosure explains selected bill, Save bill prerequisite and missing recipients. Existing signed multipart generation/scanning/paste/verification/acceptance remain intact. Acceptance opens the received bill in New sale. |

## Operator workflow

1. Open the local `/admin/login`, sign in with an existing authorized account,
   then open `/admin/offline`. A unique authorized context is selected and
   verified automatically; choose Season and Active stall if multiple contexts
   are available. These selectors never grant access.
2. First time on this browser/profile/stall: use **Prepare / refresh selected
   stall for offline use**. Installation instructions are shown; use **Install
   app** if the browser supplies a prompt. Installing is optional. If Chrome
   only offers installation after setup, open Workspace to use it there.
3. Preparation reuses/registers the browser device and downloads the selected
   catalogue, selling prices and Family Packs. **Offline billing ready.** is
   shown only after app-shell preparation succeeds too. A cached catalogue with
   an unconfirmed shell can still be used in the currently open page, but is
   not presented as verified full offline reload readiness.
4. Use **Start new bill**, enter customer name/mobile, search products, and use
   **Add** / **Add pack**. **View cart** opens quantity, unit and removal controls.
   Review the inline total. **Continue to products** and **Review bill** are
   optional shortcuts, not required wizard steps.
5. **Save bill** queues creation locally. Owners/Super Admins may supply a
   customer-agreed amount first, or save an unagreed selling-mode request and
   agree later. Later item changes require **Save item changes**. Save a changed
   agreement with **Save agreed amount**. Autosaving draft fields alone queues
   no business operation.
6. Owner/Super Admin: **Finalize bill** → **Confirm finalization**. Saved items
   and a saved positive agreement are required. Items lock locally. Payment is
   separate: choose Payment received, method, amount and any required reference,
   then **Save payment** only for money actually received. Partial payments and
   hold/release remain supported. All these actions are provisional locally.
7. **New bill** is available even for an unfinished saved request. **Start next
   bill** is also available after saving an Admin request or in the Owner
   payment area. Multiple customers reuse the same catalogue and device.
8. QR is optional. In Workspace expand **Optional QR handover**. Each device
   first prepares secure QR handover online. The creator opens a saved bill,
   chooses Intended recipient, and generates the sequence. The recipient scans
   all frames or verifies the complete pasted sequence, checks the preview,
   then explicitly accepts provisionally into its outbox. Neither scanning nor
   acceptance finalizes the bill or records money.
9. Reconnect, verify the same user/season/stall, open **Bills & sync** and tap
   **Synchronize**. Inspect `synced` and **Server acknowledged · revision …**,
   bill references and acknowledged balances. Resolve failed/conflicting
   operations explicitly; dependent actions remain blocked until resolved.
10. For an independent online check, open the matching local Customer requests
    entry and use **Refresh request progress** / **Refresh payments**. Verify
    closure, agreed amount, payment IDs, received money and remaining balance.

For Suresh at the original Diwali 2026 stall, select the authorized context whose
source identities are `business-diwali / location-diwali-2026 / season-2026`.
His existing role still applies: Admin can prepare/save requests and item edits;
only Owner/Super Admin can agree, finalize, accept handovers and record payments.
No account, role or original-stall database was inspected or changed here.

## Acceptance evidence

The POS browser regression uses fresh Chrome profiles, a bundled real Worker in
workerd and ephemeral in-memory Local D1 (`d1Persist: false`). Every intercepted
external request is blocked. It does not open existing `.wrangler` persistence.
Its shell-preparation stub is deliberately separate from the real PWA test.

The browser regression covers:

- Separate Admin, Owner and Super Admin preparation, unique device identities,
  automatic single-stall selection and explicit multi-stall selection.
- Two consecutive customers saved offline without another registration/setup;
  component/provider restart retaining the same operation IDs and drafts.
- Actual browser keyboard insertion, selected-text replacement and deletion in
  customer name/mobile, search, quantity, agreed amount, override, discount,
  payment amount, transaction reference and payment/hold details. Focus stays
  on the same enabled DOM input during each keystroke.
- Product/Family Pack selection, composition, quantity editing and cart sheet;
  360/390/430/768/1440 widths without horizontal overflow. Screenshots are saved
  in `.tmp/offline-pos/`.
- Explicit finalization, a partial payment, required-reference validation and
  holds/releases. Rapid repeated payment clicks capture one operation.
- Lost acknowledgement, manual retry, all-bill snapshot refresh, exact CREATE
  and PAYMENT replay, one original bill/payment commit and visible catalogue
  conflict retention.
- Optional real signed multipart QR generation and complete-sequence paste
  verification/acceptance on another authorized browser; Admin-first server
  reconciliation adds no duplicate bill. Core camera error/cancellation and
  generated QR image decoding are covered by the existing focused tests.
- Preparing two stalls for one Super Admin, leaving local bills in each,
  restoring a prepared stall without setup and synchronizing only that stall.
  The other stall's bill remains pending locally.

The separate built-app PWA test serves actual `dist` files on a temporary
loopback HTTP server, uses the real manifest and service worker, verifies cache
readiness, reloads the full offline POS with browser networking disabled, and
detects a deliberately deleted cached JavaScript asset. Its auth response is a
local test denial; no D1 is accessed. Installation UI lifecycle assertions use
simulated browser events and do not constitute a physical Android installation.

Final local verification results:

| Check | Actual result |
| --- | --- |
| Focused offline/QR/storage/authority/cache tests plus existing online checkout/finalization/payment and season-selection regressions | **125 passed, 0 failed**, 3 suites, approximately 18.1 seconds |
| Final browser + presentation command | **5 passed, 0 failed**: continuous POS scenario, real built PWA scenario and 3 presentation/photo regressions, approximately 36.8 seconds |
| Final local Vite build, with `VITE_API_BASE_URL` explicitly empty in the build process | **PASS**, 2,346 modules; existing large-chunk warning remains (main JS approximately 1.13 MB before gzip) |
| Targeted oxlint on changed JavaScript/JSX and tests | **0 errors, 4 warnings** concerning effect state/cancellation patterns |
| `git diff --check` | **PASS**; repository Windows line-ending notices were emitted |

The final browser command was:

```powershell
node --test --test-concurrency=1 src/admin/pages/AdminOfflineBillingPage.pos.test.js src/admin/pages/AdminOfflineBillingPage.pwa.test.js src/admin/offline/posPresentation.test.js
```

The 125-test regression command was:

```powershell
node --test --test-concurrency=1 src/admin/offline/posPresentation.test.js src/admin/offline/appShell.test.js src/admin/offline/offline.test.js src/admin/offline/authority.test.js src/admin/offline/familyPackHandover.test.js src/admin/offline/handover.test.js server/tests/offlineSync.test.js server/tests/handoverSync.test.js server/tests/adminQuickBillAtomic.test.js server/tests/adminCustomerRequestFinalizeAgreed.test.js server/tests/requestPayments.test.js src/admin/lib/adminSeasonSelector.test.js
```

The 3 presentation/photo tests are present in both commands; they are not counted
as new independent acceptance scenarios. The two browser scenarios passed on the
final application code. The PWA test requires the local build to exist first.

## Changed files

- `src/admin/pages/AdminOfflineBillingPage.jsx` — setup reuse, explicit sync,
  all-bill refresh, safe selling-mode creation and draft/payment lifecycle.
- `src/admin/components/OfflinePosWorkspace.jsx`,
  `src/styles/offline-pos.css` — continuous compact POS and status presentation.
- `src/admin/components/OfflineInstall.jsx` — install prompt/events/instructions.
- `src/admin/components/OfflineHandover.jsx` — prerequisite guidance and optional
  handover continuation (the signing/verification/storage protocol is retained).
- `src/admin/offline/appShell.js`, `public/offline-billing-sw.js` — durable cache
  readiness check; static-only caching remains unchanged.
- `src/admin/offline/posPresentation.js` — unqueued item edits are not presented
  as a server-confirmed bill.
- Tests: `AdminOfflineBillingPage.pos.test.js`,
  `AdminOfflineBillingPage.pwa.test.js`, `appShell.test.js`,
  `posPresentation.test.js`.
- Documentation: this file and `docs/OFFLINE_POS_REDESIGN.md`.

## Practical limits

- No physical Android installation/camera/crowd-use sign-off is claimed.
  Phone localhost refers to the phone itself; a computer's plain LAN HTTP URL
  does not provide localhost's service-worker/camera secure-context treatment.
- Full offline reload needs the built app and verified shell. Vite development
  mode is not claimed to support it. Storage persistence is browser-controlled;
  site-data deletion, profile changes and eviction can lose unacknowledged work.
- No background synchronization: keep the page open, reconnect, authenticate
  and synchronize explicitly. Different stalls' work is never merged or sent
  under the selected stall's context.
- Payments record actual receipts; no offline banking/UPI processing, refunds
  or custom Family Pack component substitutions were introduced. Replaying the
  same operation cannot duplicate a commit. Intentionally saving a new cash
  payment creates a new operation; do not enter already captured cash again.
- Permission boundaries remain: Admin cannot record payments or finalize.
  Positive saved agreement and saved items are required for finalization.
- No production runtime/device parity or deployment was tested or changed.
