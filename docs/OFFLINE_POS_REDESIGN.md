# Offline POS interface

Current development continuation: [Phase 2 signed authorization, finalized QR
handoff and regression scope](OFFLINE_BILLING_PHASE_2_2026-11-05.md). Phase 1
operational/layout behavior below remains the baseline.

Updated 5 November 2026: `/admin/offline` provides **New sale**, **Bills & sync**,
and **Workspace**. New sale is one continuous editor: customer, compact searchable
catalogue, review/agreement and (after explicit finalization) payment. No Items /
Review / Payment wizard is required. Mobile has a fixed cart total/main action
and a cart sheet; desktop retains the sticky cart column. Product results scroll
within a bounded area rather than pushing checkout below the entire catalogue.

See [operational correction and acceptance](OFFLINE_POS_OPERATIONS_2026-11-05.md)
for the inspected gaps, current procedure, test evidence and practical limits.

## Journey and existing operations

| UI action | Existing operation / behavior |
| --- | --- |
| First setup → Prepare / refresh selected stall for offline use | Confirm session, reuse/register device identity, download scoped catalogue, activate IndexedDB profile, prepare app shell |
| Workspace → Update saved catalogue | Explicit refresh for this prepared stall; retain selected draft and compatible QR preparation |
| Start new bill, edit customer/cart | Autosave existing draft and version records; no server operation |
| Review bill → Save bill | CREATE |
| Save item changes | EDIT, retaining predecessor ordering |
| Save agreed amount | AGREEMENT |
| Finalize bill → Confirm finalization | CLOSE; requires saved items and agreement |
| Payment → Save payment | PAYMENT with original occurrence time and OFFLINE recording mode |
| Place/release payment hold | Existing PAYMENT envelope with HOLD / RELEASE_HOLD ledger action |
| Bills & sync → Synchronize | Explicit authenticated outbox sender and atomic receipts; refresh references/balances for all acknowledged bills |
| Bills & sync → Review local and server versions | Existing explicit conflict replacement/cancellation |
| Workspace → Save request snapshot / Save fresh revision as separate draft | Existing scoped request download; preserves earlier drafts |
| Workspace → QR handover | Existing signed transfer, camera/paste verification and provisional acceptance |

`AdminOfflineBillingPage.jsx` retains orchestration and operation handlers.
`OfflinePosWorkspace.jsx` provides the responsive view and interaction state.
`posPresentation.js` calculates display-only totals and distinguishes queued
payments from payments already included in a server snapshot. Sync refreshes all
acknowledged requests to display their actual public references and balances.
No existing queued operation is rewritten by that refresh.

The IndexedDB database version, stores, scope keys, device identities, API request
payloads, authorization and receipt/idempotency behavior remain intact.

## Photos

The catalogue response adds optional `productImages` metadata separately from
the strict selling snapshots. Preparation downloads up to 120 first product
photos, using six concurrent requests, a ten-second overall budget and a 512 KB
per-image limit. Successful photo Blobs are saved in the existing scoped catalogue
record. Missing, blocked or oversized images use a package icon. Photo downloads
never prevent preparation of the billing catalogue. Refresh preparation to obtain
photos for an older saved profile. Photos are never sent in sync/QR payloads.

## Local verification

Use the local Worker and frontend with an empty `VITE_API_BASE_URL` and a local
API proxy. Sign in as the Stall B Owner, choose the season and stall, then prepare
the workspace online. No production connection is needed.

1. Prepare the stall once. Single authorized contexts select automatically;
   multiple stalls require selection. Check catalogue, installation, reload and
   pending-storage statuses separately in Workspace.
2. Start a new bill. Type/edit/delete/paste customer details using the keyboard.
   Try an invalid mobile number and confirm that Save bill explains the error.
3. Search/filter products, add products and Family Packs, inspect composition,
   and use the cart quantity/unit/remove controls.
4. Switch the browser Network panel to Offline. Review and save the bill; save
   item changes and the agreed amount, then explicitly confirm finalization.
5. Record a partial Cash payment. Try UPI without a reference to see validation.
   Exercise payment hold and release. All captured actions remain provisional.
6. Start the next customer without preparing again. Open Bills & sync to inspect
   both persistent chains. Reopen the page/component
   and confirm that the saved input and operation identities survive.
7. Reconnect, sign in/reselect the saved stall if necessary, and tap Synchronize.
   Confirm the public bill reference, acknowledged balance and payment status.
   Retry synchronization and verify that no bill/payment is duplicated. No
   periodic background sender interrupts input; retries are operator-triggered.

For complete offline browser reload, serve a built local app, prepare again on
that exact origin, and wait for the existing app-shell confirmation. Vite dev
mode does not provide that guarantee. Synchronization still needs an open page
and current authentication; it is not a background service-worker task.

The focused browser regression runs the real bundled Worker in workerd against
ephemeral Local D1, with a separate Chrome profile. It verifies mobile widths
360/390/768, desktop 1440, IndexedDB restart, cached photos, mixed Family Pack
checkout, adjustments/agreement/closure, partial payment, hold/release, lost
acknowledgements, replay, catalogue conflicts, and rejected cross-stall access.
It does not open or modify existing `.wrangler` persistence.

Screenshots from that check are written to `.tmp/offline-pos/`.

The remaining backend limits still apply: no offline bank transaction processing,
no custom Family Pack component substitutions, and no authoritative finalization
or payment balance until the Worker acknowledges the queued actions.
