# Step 7: QR handover in the existing PWA

Implemented at `/admin/offline`, using the existing IndexedDB database, immutable
outbox, authentication transport, revisions, audit history, pricing adjustments,
finalization and append-only payment ledger. No native wrapper or new local database.

## Prerequisites prepared, not applied

- **Migration:** `server/database/migrations/0024_qr_handover.sql`, following
  0020–0023. It adds immutable certified device-key registrations and append-only
  request claims, transactional authorization guards, unique transfer/request/
  operation constraints and a handover audit event. No existing database was migrated.
- **Server-only secret:** `HANDOVER_SIGNING_JWK`, a private ECDSA P-256 JWK with
  signing usage, provisioned through the operator's normal secret management.
  Never use a `VITE_` prefix, embed it in frontend configuration or copy it to a
  phone. No secret or production configuration was created/changed by this task.
  Generate a dedicated key in the operator's trusted environment. Keep its public
  and private material separate; the API returns only public verification material.
- **Dependencies:** `qrcode@1.5.4` for generation and `jsqr@1.4.0` for camera-frame
  decoding, included in the existing Vite shell asset. No external QR service.
- Each participating device needs a normal HTTPS/localhost browser profile,
  working IndexedDB/Web Crypto and its own existing online stall preparation.
  Then choose **Prepare / refresh secure QR handover online**. This registers its
  non-exportable P-256 signing key and caches a server-signed seven-day certificate,
  verification root, authorized recipient list and, for Owners/Super Admins only,
  private price estimates. Missing configuration/schema fails closed; ordinary
  Step 6 preparation does not require the new endpoint.
- No IndexedDB version upgrade or service-worker rewrite was needed. New metadata,
  keys and accepted-transfer markers use existing stores. Vite's existing shell
  generation automatically includes the QR implementation for offline reopening.

## Transfer and ownership

An Admin selects a saved request and an intended recipient. For a new local request,
queue creation first: its operation ID deterministically identifies the same request
on both devices and on the server. The original Admin retains their immutable
outbox; displaying a QR does not synchronize or remove it. Exported snapshots are
persisted and reuse their transfer IDs across reloads. Pending item edits can be
exported as the latest complete saved snapshot without rewriting the sender's
earlier immutable operations. A changed draft or recipient
hides the old QR until a new valid export is generated.

Wire version 1 remains the ordinary-product format. Version 2 adds complete Family
Pack lines (see the extension below). Both contain explicit business/location/season, original request ID,
source operation/revision, transfer ID, original creator and intended recipient IDs,
client occurrence timestamps, customer name/mobile, area, pickup preference, notes,
delivery address/landmark/maps text where present, and up to 50 full product lines.
Each line carries a stable ID, product ID/name, quantity, unit, pack/company/pieces/
loose-sale snapshot and permitted catalogue selling price. Certificates contain only
public keys and server-certified identity/scope/role snapshots. No purchase, final
price, profit, margin, discount, negotiated amount, device secret or private key is
exported. Unknown fields are rejected rather than silently accepted.

The sender signs the canonical payload; the server signs its device certificate.
The receiving device verifies against a root obtained from authenticated online
preparation, never a root supplied by QR. Embedded roles/names/phones do not grant
authorization. Customer values remain sender-supplied details, not identity proof.
Scope, recipient, version, structure, signature, clock window and certificate expiry
are checked before the complete preview appears. Every product is matched against
the receiving stall catalogue. Only a prepared writable Owner/Super Admin profile
may explicitly accept. The camera uses the rear camera where available and stops
its tracks on stop, completion, cancellation, errors and component unmount.

Acceptance atomically stores the original signed transfer, a scoped duplicate marker,
draft/version and a `HANDOVER` outbox operation. Duplicate scans across tabs reopen
the existing draft without creating a second operation. The receiving actor is the
accepting Owner/Super Admin; their later financial changes, agreement, closure and
payments follow the existing dependency chain. A positive saved/queued agreement is
required before closure. Payment/HOLD/RELEASE_HOLD use the existing ledger rules and
remain separate from closure. Purchase/profit previews are read-only estimates from
the receiving privileged profile. **Final Price + ₹500** appears only as a reference
and never enters the bill, payment or profit calculation.

On reconciliation, current receiver authentication, device secret, membership, role
and scope are revalidated. The server verifies the signed transfer and the sender's
current membership, role, certified registered key and enabled device. Prior accepted
transfers can reconcile after certificate expiry only if signed timestamps were in
the certificate window and all live checks pass. Offline new imports still reject
expired certificates. Client times are recorded as claims, not trusted server clocks.

Creation or item adjustment, the unique handover claim, receiver assignment, audit
events and Step 6 receipt commit in one D1 batch. Existing receipt enum/schema stays
unchanged: its operation type describes the underlying `CREATE` or `EDIT`, while the
fingerprint covers the entire original immutable `HANDOVER` envelope. The claim links
the receiving operation and signed transfer. Both parties' authority is checked again
by a SQL trigger at commit; a race rolls back the entire business batch.

The original request ID and line IDs survive transfer. For an unsynchronized source,
request creation history records the original Admin/device/occurrence; receipt and
claim identify the receiver separately. Existing requests retain their immutable
creator. The claim and normal assignment fields retain initiator and recipient.
Existing closure audit and payment ledger retain finalizer and payment recorder.
Business, stall and operating season continue to own the request/final bill; no user
or device becomes the business owner of a bill. The transfer association remains in
the append-only claim/history through finalization and payments.

## Large payloads and competing devices

The complete signed envelope is capped at 64 KiB. It is encoded as numbered QR frames
of at most 900 data characters, with manual stepping or automatic cycling. The
receiver accepts out-of-order and duplicate frames, rejects mixed/conflicting frame
sequences, bounds collection memory and verifies only after every frame is present.
Over-limit requests fail with an explicit message; no line is truncated. A complete
frame-text paste option uses exactly the same assembly, signature and preview path.

Offline acceptance is **provisional**, including two disconnected devices belonging
to the same intended recipient. A recipient binding does not promise an exclusive
device claim. On reconnection, global unique constraints permit one transfer/request
claim; other devices retain their signed versions and pending dependent operations
as conflicts. Revision guards similarly reject competing edits/closures and stale
Admin edits after Owner finalization. Retries reuse operation IDs and Step 6 receipts.
Independent requests progress after an individual conflict or revoked sender; global
authentication/network failures retain the existing stop-and-retry behavior.

Conflict records expose both preserved QR and server snapshots in the outbox. A
receiver cannot rewrite a signed source revision. Explicit **Keep server version**
uses existing archival/resolution behavior and cancels pending descendants, including
uncommitted payment captures, while retaining their history. Alternatively obtain a
fresh signed transfer from the original creator. No automatic merge, silent discard
or background claim stealing is implemented.

## Verification performed (3 November 2026)

- `npm run test:handover`: **136 passed, 0 failed** including the Family Pack
  extension and related catalogue, Step 3–7 workflow, online handover, checkout,
  finalization and payment tests.
- `npm run test:offline`: **37 passed, 0 failed**.
- Tests cover actual QR generation and bitmap decoding, multipart 50-line requests,
  signatures, malformed/unsupported/tampered data, cross-scope and recipient denial,
  duplicate scan/import/sync, four Admin devices, competing claims/closures/edits,
  stale Admin synchronization, actor/line identity, payment idempotency, camera
  denial/cancellation, non-exportable key persistence, database reopening and a
  sender revocation between verification and atomic commit.
- Tests apply schemas only inside disposable in-memory SQLite fixtures. No existing
  D1/SQLite database was migrated; `server/npm test` and its migration pretest were
  not run.
- Full lint passes with existing repository warnings; focused changed-file lint
  passes without diagnostics. Frontend build passes with the existing large-bundle
  warning. Production preview remains at `http://localhost:5173/admin/offline`.
- Desktop Chrome smoke used separate disposable Admin and Owner profiles with all
  API requests blocked. Admin UI generated QR images/frames without privileged
  pricing; Owner UI verified/presented the complete transfer, accepted it into the
  durable outbox, and recovered it after offline reload and a full browser process
  restart. Non-exportable signing-key persistence was also checked. These seeded
  signed fixtures do not certify actual authenticated preparation or Android optics.
- Online `npm audit` reports an existing high-severity Vite 8.3.2 advisory group.
  No advisory was reported for the new QR packages. Vite was left unchanged under
  the unrelated-feature boundary; this task does not constitute a dependency upgrade.

## Android phone validation

Use two or more Android phones with Chrome and an already provisioned isolated test
backend. Do not apply migrations to existing databases merely to perform this check.
The test backend must independently have the required schema and server signing
secret. Use an already available HTTPS test origin, or the existing localhost preview
with Chrome USB remote-debugging port forwarding from phone port 5173 to computer
`localhost:5173`. An ordinary HTTP LAN IP is not a secure context. Localhost normally
refers to the phone; forwarding must remain active. DevTools Offline mode can
simulate loss of the forwarded origin where airplane mode still leaves USB active.

1. Install the PWA from Chrome's **Add to Home screen / Install app** menu on both
   phones. Sign in as an Admin on A and an authorized Owner on B; select the same
   business/stall/season. Prepare the stall and wait for offline shell readiness,
   then explicitly prepare secure QR on each phone. Check recipient identity and
   storage warnings. Owner B should see its financial snapshot, Admin A should not.
2. On A create a normal request with at least two products and a valid customer
   mobile, wait for local save, queue creation, select B's Owner identity, and
   generate the QR. For an existing online request, use **Save fresh revision as
   separate draft** first; this preserves older local versions and pending work.
   Confirm product quantities, intended recipient and complete frame count.
3. Disconnect both phones. On B start the camera and grant Chrome/Android camera
   permission. Scan every frame from A, using automatic cycling or manual next.
   Confirm customer, all products/quantities/units, scope, original request ID,
   initiator and recipient before explicit provisional acceptance. Repeat the scan;
   it must reopen the same draft without increasing the pending handover count.
4. On B adjust allowed unit prices/discounts, queue adjustments, enter and queue a
   positive agreed amount, queue closure, and save a partial/full payment or HOLD
   through the existing controls. Confirm the reference + ₹500 never affects the
   payable or ledger amount. Wait for save completion, refresh, close Chrome/PWA
   windows, and restart while offline. Verify draft, transfer ID and pending chain.
5. Restore connectivity on B and synchronize. Reauthenticate/select the same stall
   if necessary. Check the original creator is A's Admin, recipient/finalizer/payment
   actors are retained correctly, bill belongs to the stall, and each payment exists
   once. Retry after interrupting a sync response. Check all acknowledgement states.
6. Reconnect A. If B materialized the request before A's original creation synced,
   A may receive a preserved source-creation conflict; compare with the server and
   explicitly keep its version. Verify the request ID is identical and no second
   bill was created. Also test the reverse order (A syncs first, then B).
7. Prepare four Admin phones/profiles and multiple Owner devices. Synchronize
   independent requests together. For a shared request, allow two offline devices
   of the intended Owner to accept independently; reconcile and verify one server
   claim plus a visible preserved conflict. Test competing edits, independently
   queued closures and a stale Admin edit after Owner finalization. Dependent
   payments on a losing chain must remain blocked until reviewed.
8. Deny camera permission, revoke it in Android settings, hold the camera in another
   app and test cancellation. Try a wrong recipient/stall, a tampered pasted frame,
   unsupported version, mixed frame sequence, expired preparation and a 50-line
   request. Nothing invalid should reach an accepted draft. Verify no API responses
   or private prices appear in the public service-worker shell cache.

## Limits requiring explicit operational handling

- No Android phone was available for actual install, permission/optical scanning or
  authenticated end-to-end synchronization testing. Desktop and automated results
  above do not replace the device checklist.
- Offline devices cannot learn current revocation, role changes, global claims or
  competing closures. Cached identity is local access on a trusted device, not a new
  authentication factor. Use trusted OS/browser accounts; same-origin script/XSS or
  someone controlling an unlocked prepared device can invoke its signing key even
  though the private material cannot be exported.
- New offline QR imports require an unexpired sender certificate and correct device clocks.
- QR frames contain readable customer details. Anyone capturing the complete
  sequence can decode those details; recipient binding governs acceptance. Share
  the sequence only with the intended recipient.
- Root-key rotation/key-ring management is not implemented. Coordinate any signing
  root replacement with outstanding transfers; changing it invalidates old proofs
  until a deliberate operational recovery is provided. Pending data is retained.
- Historical Family Pack requests without a complete saved component snapshot
  cannot be reconstructed from today's catalogue. New catalogue-backed Family Packs
  are supported by wire version 2, as described below. QR transfers a complete saved
  snapshot, not the sender's arbitrary pending operation log. Pending item edits
  remain on the sender; whichever side reconciles first can cause the other
  source version to conflict. Failed/conflicting or in-flight source operations
  require explicit resolution before another export. No log is silently rewritten.
- A request has one immutable reconciled QR claim. Reassignment/retransfer of an
  already received QR draft and automatic rebasing/merging of signed conflicts are
  intentionally rejected. Use the established online workflow and explicit review.
- If the receiver materializes an unsynced source before the original Admin syncs,
  the Admin's original creation can require explicit server-version resolution.
  It is never silently acknowledged against a different operation fingerprint.
- Private purchase estimates are scoped, unencrypted IndexedDB data on the Owner's
  trusted profile. They may be stale or incomplete and are never QR inputs or
  authenticated totals. No privileged snapshot is fetched for Admins; a confirmed
  downgrade removes it on the next existing synchronization check. Offline
  revocation and browser/site-data deletion limitations remain as in Step 6.

## Changed files

- `package.json`, `package-lock.json`
- `src/shared/handoverProtocol.js`, `src/shared/handoverProtocol.test.js`
- `tests/helpers/handoverFixtures.js`
- `src/admin/api/adminOffline.js`
- `src/admin/offline/storage.js`, `src/admin/offline/synchronize.js`
- `src/admin/offline/handover.js`, `src/admin/offline/handover.test.js`
- `src/admin/offline/qrCamera.js`, `src/admin/offline/financialPreview.js`
- `src/admin/components/OfflineHandover.jsx`, `src/admin/components/OfflineFinancialSummary.jsx`
- `src/admin/pages/AdminOfflineBillingPage.jsx`
- `server/database/migrations/0024_qr_handover.sql`
- `server/src/services/adminHandover.js`, `server/src/services/adminOfflineSync.js`
- `server/src/routes/adminOfflineSync.js`, `server/src/lib/adminCustomerRequestScope.js`
- `server/tests/handoverSync.test.js`
- `docs/OFFLINE_BILLING.md`, `docs/QR_HANDOVER.md`

## Family Pack extension (3 November 2026)

No additional migration, dependency, secret, IndexedDB version or service worker is
required. The existing Step 7 schema/setup requirements above still apply. No
migrations were applied and no production configuration/data, deployment or Git
operations were performed for this extension.

The existing catalogue models each sellable variant as a separate `family_packs`
record and its `family_pack_items` rows. There is no independent variant entity.
The selected pack ID, slug and pack label therefore identify the selected variant;
the implementation does not invent variant options or expand a pack into loose
product request lines.

Online stall preparation now saves safe Family Pack definitions in the existing
scoped `catalogues` store alongside products. The editor offers **Saved Family Pack
/ variant** and **Add Family Pack with captured snapshot**. A new line stores its
own copy of the selected definition, stable line ID, whole-pack quantity, variant,
component row IDs/product IDs/names, component quantities, exact unit labels,
product unit/pack snapshots and permitted catalogue selling prices. Components are
listed in saved order. Whole packs retain their fixed selling price; component
prices are version metadata, not a replacement calculation of the pack total.

Each snapshot's `catalogueVersion` is SHA-256 over its canonical safe definition,
including the selected variant, composition, ordering, units, selling prices and
availability. It is a content version for this pack, not a global catalogue revision.
It uses the existing signature and certificate for authentication. Recalculating a
hash cannot authenticate a modified QR. Purchase prices, final prices, profit,
margin and private keys remain outside this format, including nested components.

Captured draft, version, outbox and request snapshots remain unchanged when the
catalogue is refreshed or edited. QR generation uses that captured definition, not
the latest pack. A request containing packs uses version 2; ordinary product-only
requests retain the existing version 1 shape and signing path. Version 2 can also
represent an explicit full-cart removal of packs. Both devices need the updated
build to handle version 2. An old product-only handover cannot silently omit packs
from an existing server request.

The Owner/Super Admin sees every component, per-pack and total quantities, original
unit labels, pack snapshots, variant identity, prices and content version before
acceptance. The receiving catalogue must contain the same pack definition and all
component products with compatible snapshots. Missing/foreign products, inactive or
sold-out components, changed definitions/variants/prices/units and version mismatches
block acceptance. No substitution, inferred unit conversion or automatic repricing
occurs. Invalid prepared definitions are reported through `familyPackIssues` and
are not offered as addable packs; ordinary products remain available.

Accepted transfers continue through the existing atomic duplicate marker, draft,
version and immutable outbox transaction. `HANDOVER`, request creation and quantity
edits use the same Step 6 receipts and Step 7 claim/authority guards. During server
sync, the pack is compared against the scoped live catalogue and the existing
request's original snapshot. Pack definition, exact component count/identities/
quantities/units/order and all component product snapshots are checked again in
the business write batch. Component assertions are grouped to keep bound parameter
counts below 100 per statement. A catalogue change during commit rolls back the
request/quotation, claim and receipt together as a visible conflict. Stable line IDs,
creator/recipient/finalizer/payment actors and original request/transfer IDs retain
their existing semantics. Pack snapshots also survive finalization and payments.

Quantity edits use the captured definition. To use a different definition on an
existing request, explicitly remove the old pack and synchronize that removal before
adding the current variant as a new line. Existing audit before-images and local
versions retain the old snapshot. Conflict review never replaces an old snapshot
with today's catalogue merely because the catalogue was refreshed.

### Family Pack limits and unsupported scenarios

- Only complete, fixed, catalogue-backed variants are supported. Custom variants,
  substitutions, nested Family Packs and definitions with zero components are
  rejected. Existing catalogue limits allow up to 80 components per pack, component
  quantities 1–999, and whole-pack request quantities 1–99. Unit labels remain
  descriptive; arbitrary labels are never silently interpreted as box/piece math.
- Historical request lines with no complete component/version snapshot stay
  preserved and explicitly unsupported for QR/editing. Current catalogue data cannot
  prove their original composition. Do not recreate them implicitly.
  Old cached drafts that previously omitted Family Pack lines are also blocked from
  QR/item-edit export until a fresh revision is saved separately online, preventing
  an old partial draft from being interpreted as an intentional pack removal.
- Family Pack unit-price overrides are unsupported in offline pack edits. Existing
  authorized bill-level discounts and agreed amounts remain available. Purchase,
  profit and margin estimates for pack-containing drafts are unavailable rather
  than inferred from arbitrary component unit labels. Reference totals are also
  unavailable where a pack has no saved final-price basis.
- The unchanged 64 KiB signed-envelope, 100-frame and 50-request-line limits apply.
  Multipart QR supports larger definitions (tested at 80 components), but oversized
  combined carts fail explicitly without truncation. The existing sync HTTP body
  limit also applies. Preparation supports at most 500 Family Pack definitions and
  the existing 5,000-product snapshot limit.
- Changed versions require explicit resolution. Offline provisional acceptance and
  the existing single reconciled claim policy remain unchanged. An updated receiving
  device cannot accept an incompatible older definition silently.
- Actual Android optical camera scanning and authenticated device-to-D1 workflows
  were not run; desktop and disposable SQLite tests do not certify those outcomes.

### Family Pack verification and phone checklist

- `npm run test:handover`: **136 passed, 0 failed**. Includes generation/bitmap decoding/large multipart/
  offline acceptance/duplicate/restart/catalogue-conflict cases, server creation and
  handover in both sync orders, fixed prices, quantity edits/removal, 80-component
  synchronization, atomic race rollback and existing family catalogue/season/
  location/estimate plus Step 3–7 regressions.
- `npm run test:offline`: **37 passed**. Full lint passes with existing repository
  warnings; focused changed-file lint has no diagnostics. Frontend build passes with
  the existing bundle-size warning. No schemas were applied to existing databases;
  database tests use disposable in-memory fixtures.
- The related legacy season tests needed their mock DB explicitly bound to the
  existing disabled location mode. This test-only correction restores their intended
  season-isolation coverage without changing runtime authorization.
- A production-preview Chrome check used separate disposable Admin/Owner profiles
  with APIs blocked. Admin added a captured pack through the editor and generated
  multipart QR. Owner verified the complete preview and accepted it. Offline reload
  and full browser restart retained the pack catalogue version, transfer, immutable
  operation ID and draft. No private price estimate appeared for Admin.
- On two prepared Android phones, select the same stall and choose an actual pack
  variant on the Admin phone. Include an ordinary product as a mixed-cart regression.
  Disconnect, scan all frames, inspect every component/quantity/unit/version on the
  Owner phone and accept explicitly. Refresh/restart offline and verify the unchanged
  pack and pending operation. Reconnect and test Admin-first and Owner-first sync,
  then agreement, closure and partial payment. Repeat the QR scan and sync retry;
  neither should duplicate a request, claim or payment.
- On an isolated test catalogue, change a pack price, unit label or component
  quantity after capturing it. Refresh the receiving preparation: preview must show
  a conflict, while the source draft remains unchanged. Also accept against an old
  receiving preparation and then reconnect: server sync must conflict and preserve
  the pending signed snapshot. Test missing/inactive components, a different variant,
  a version-only mismatch and a definition up to 80 components.

### Files changed for the Family Pack extension

- `src/shared/familyPackSnapshot.js` (new), `src/shared/handoverProtocol.js`,
  `src/shared/handoverProtocol.test.js`
- `src/admin/offline/handover.js`, `src/admin/offline/storage.js`,
  `src/admin/offline/financialPreview.js`, `src/admin/offline/familyPackHandover.test.js` (new)
- `src/admin/components/FamilyPackSnapshotPreview.jsx` (new),
  `src/admin/components/OfflineHandover.jsx`, `src/admin/pages/AdminOfflineBillingPage.jsx`,
  `src/admin/lib/billAdjustment.js`
- `server/src/services/offlineFamilyPacks.js` (new),
  `server/src/services/adminOfflineSync.js`, `server/src/services/adminHandover.js`,
  `server/src/services/adminQuickBill.js`, `server/src/services/adminQuickBillAtomic.js`,
  `server/src/services/adminCustomerRequestBillAdjust.js`,
  `server/src/lib/adminCustomerRequestScope.js`
- `server/tests/handoverSync.test.js`, `server/tests/adminFamilyPackSeason.test.js`,
  `tests/helpers/familyPackFixtures.js` (new), `package.json`, `docs/QR_HANDOVER.md`
