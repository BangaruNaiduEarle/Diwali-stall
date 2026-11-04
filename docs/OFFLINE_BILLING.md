# Step 6: durable offline billing

## Scope and entry point

Open `/admin/offline` using the **Offline billing** workspace link, or **Save this
request for offline work** on a request detail page. The existing online billing,
handover and payment screens retain their behavior. Step 7 QR support is described
in [QR_HANDOVER.md](QR_HANDOVER.md).

The offline page lives outside the network-dependent admin gate. A previously
prepared identity permits local work only; it never authenticates a network request.
Sign-out removes the active local workspace pointer while preserving unsynchronized
records. Reauthenticate as the same user and select the same stall to prepare and
recover that user's records. A confirmed different user/stall cannot open the previous
workspace's records through this page.

## Storage and synchronization

IndexedDB database `diwali-offline-billing-v1`, version 1, stores device identity,
last-confirmed scoped profiles, catalogue snapshots, drafts, immutable draft versions,
and an outbox. Business/location/season/user/device form every operational record key.
Device secrets are browser-generated random values; session cookies, passwords and
Access JWTs are never copied into IndexedDB. Server catalogue/request snapshots omit
purchase, cost, profit and private pricing, including for Owner/Super Admin.
Step 7 adds a separate, explicit, role-checked QR preparation that stores a purchase/
final-price estimate only in the receiving Owner/Super Admin's scoped profile.
Those privileged fields never enter QR payloads or the public shell cache.

Draft inputs autosave through read/write transactions requesting strict durability.
Wait for **Draft saved on this device** before closing. Quota, blocked-upgrade and
transaction failures are shown; failed saves are not acknowledged as durable.
Draft/outbox creation is one IndexedDB transaction. Each queued payload is immutable,
with a UUID operation ID, original occurrence time and original base revision or
explicit predecessor. A monotonic local order avoids same-millisecond ordering bugs.

Supported operations reuse the existing services:

- `CREATE`: existing atomic Quick Bill checkout, including its catalogue/pricing rules.
- `EDIT`: existing item/quantity and privileged selling-price/discount adjustments.
- `AGREEMENT`: existing privileged saved customer-agreed-amount operation. This also
  supports selling-mode requests initially raised by Admin.
- `CLOSE`: existing dedicated finalization and frozen payment-account creation.
- `PAYMENT`: existing Step 5 receipt/hold/release ledger, `OFFLINE` recording mode,
  separate CASH/UPI/CARD/BANK/OTHER method, exact integer paise and original occurrence.

Admin can create requests and edit items/quantities. Only the currently authorized
Owner/Super Admin can record agreement, close or record payments. Local closure is
durable and provisional; further item changes stop, and payment captures depend on
closure acknowledgement. No full-payment prerequisite is added to closure.

`POST /api/admin/offline/devices` registers a device secret hash for a validated scope.
`GET /api/admin/offline/catalogue` returns a selling-only snapshot.
`GET /api/admin/offline/requests/:id` returns a safe request snapshot and payment summary.
`POST /api/admin/offline/sync` accepts exactly one operation envelope per request.
These all pass through the existing authentication, season and location middleware.
The server validates envelope ownership, actor identity, registered/non-disabled
device and current lesser-of-season/location authority. Payload IDs never grant scope.

A small raw-DB adapter sits below the existing request scope wrapper. It appends the
sync receipt to the SAME D1 write batch as the existing business operation/audit
events. Revision and offline catalogue assertions also execute in that batch. Receipt
triggers recheck device, membership, role and active business/location/season at commit.
No successful business operation can be separately acknowledged before its receipt.
Uniqueness/guard failures roll the whole batch back. Read batches are left unchanged.

Receipts retain a canonical payload fingerprint, operation ID, actor role, scope,
device, request, final revision, occurrence time, server receipt time, predecessor and
resolution reference. The reported role at local capture is retained separately from
the server-verified role at receipt and never grants authority. A retry with identical input returns its receipt even after the
request revision advances; changed input under that ID conflicts. Creation also reuses
Step 4's deterministic checkout identity, and payment retries retain Step 5's ledger
operation ID and normalized transaction-reference protection.

Client acknowledgement and draft/request mapping commit together. Interrupted
`syncing` rows recover to pending. Network/5xx/429 failures retain the payload and retry
with capped exponential backoff; 401/403 stops dispatch and retains failed operations
until access is restored and the user retries. Other independent drafts can synchronize
while a conflicting dependency chain stays blocked. Web Locks serialize tabs where
available; server uniqueness remains the correctness boundary without Web Locks.

Synchronization runs explicitly and every 15 seconds while this page is open, online,
and in an authenticated matching workspace. There is no background sync when the
browser/page is closed; saved work resumes when the page is reopened.

## Conflicts

Server request revisions and selling catalogue snapshots are never silently refreshed
inside a queued operation. Changed quantities, prices, units, availability, agreement
or closure produce a failed/conflicting operation; its original payload stays intact.
The current authorized server version is saved alongside the local conflict.

The page displays both versions. The user can keep the server version or explicitly
review/requeue the same action using a new ID and the reviewed revision/catalogue.
Replacement records refer to the original operation. These actions explicitly cancel
pending descendants, INCLUDING payment captures; their original entries remain in
local history and must be reconciled/requeued deliberately. No money is silently
treated as recorded on the server. A reviewed payment replacement preserves its
original occurrence timestamp.

Local drafts also have compare-and-swap revisions. A competing tab cannot overwrite
the current device draft or silently append behind another tab's queued change. Its
attempted draft/operation is committed to version history before conflict is reported,
and survives restart. Local conflict resolution is explicit and never automatically
queues a network operation.

## Migration requirements

Prepared `server/database/migrations/0023_offline_sync_receipts.sql` follows existing
0021 workflow history and 0022 payment ledger. It adds scoped device registration,
append-only sync receipts, scope index, immutable identity/history guards and the
in-transaction authority trigger. It neither changes existing billing schemas nor
backfills/fabricates devices, receipts or actors. Browser IndexedDB is a new version-1
database and does not alter existing browser storage.

**No migrations were applied to any existing database in this step.** The new API
requires the reviewed 0020/0021/0022/0023 schema in the target environment before use.
Automated persistence/migration tests run only against disposable in-memory SQLite,
with the existing test helper's post-0020 fixture. They are not a Cloudflare D1 rehearsal.

## Local testing and limitations

1. Run `npm run test:offline` at the repository root. This uses fake-indexeddb and
   disposable in-memory SQLite; Python 3 is required by the existing SQLite helper.
   Do not run `server/npm test`: its existing pretest applies local migrations.
2. For manual HTTP testing, provision a SEPARATE disposable Wrangler persistence
   directory/database with the existing foundation fixtures, migration sequence through
   0023, test accounts, season/location memberships and catalogue. Keep the existing
   local database and production bindings untouched. Existing migration 0020 has its
   own fixture/precondition checks; do not bypass those or use an existing database
   merely to make the offline page work.
3. Run the local Worker against that isolated persistence directory with the existing
   location mode enabled and local authentication setup. Point the existing development
   proxy/API configuration at it. No production configuration changes are needed.
4. `npm run build`, then `npm run preview -- --host localhost --port 5173` serves built
   assets on the existing allowed local origin. Use the existing local authentication
   proxy/session setup. Vite dev/HMR supports draft/outbox testing while its page is
   loaded; its module graph is deliberately not advertised as an offline reload shell.
5. Sign in, choose a stall, open `/admin/offline`, and prepare it online. Wait for
   **Offline page reload is ready**. Save specific requests by ID, or use the detail-page
   link. Test with a normal browser profile on HTTPS/localhost and IndexedDB/service
   workers enabled. Disable networking, edit/create, queue agreement/closure/payment,
   reload/close/reopen the browser, reconnect, sign in/select the same stall if required,
   and synchronize. Test a second tab/device changing the original revision before sync.

The service worker caches only public built assets and `/admin/offline` HTML, never
API responses/authentication. Preparation refreshes that shell and waits for cache
acknowledgement. The local workspace remains available on reload after this setup.

Browser storage persistence is requested but cannot be guaranteed against browser
eviction, explicit site-data deletion, private-browsing cleanup, disk failure or loss
of the device. Cached identity is not an offline password lock or physical-device
attestation; use a trusted browser/OS account. Role revocation cannot be discovered
without connectivity; the server rejects unauthorized changes when they synchronize.

Catalogue snapshots are capped at 5,000 products. Request snapshots are downloaded
explicitly, not a bulk download of every customer. Existing family-pack lines are
preserved for closure/payment; editing those requests remains in the existing online
workflow. Refunds/reversals, QR, gateways, an always-on background worker, remote device
management UI and encrypted local storage are outside this step. Conflict/history and
acknowledged rows are retained without automatic pruning. Browser end-to-end testing
and a disposable D1 rehearsal remain manual; automated tests cover IndexedDB behavior,
the sync transport, SQLite transactions, service-worker caching and related workflows.

## Validation

- Focused offline suite: 33 passed, 0 failed (`npm run test:offline`).
- Related billing/payment/location/session regression run: 257 passed, 0 failed.
- Focused lint: exit 0, no warnings in the new offline modules; five existing
  warnings remain in the Worker entry, session provider and request detail page.
- Frontend build: passed; the existing large-bundle warning remains.
- No existing databases were migrated, no production configuration/data changed,
  no deployment occurred and no Git commands were run.

## Changed files

- `server/database/migrations/0023_offline_sync_receipts.sql` (new)
- `server/src/services/adminOfflineSync.js` (new)
- `server/src/routes/adminOfflineSync.js` (new)
- `server/src/index.js`
- `server/tests/offlineSync.test.js` (new)
- `src/admin/offline/storage.js` (new)
- `src/admin/offline/synchronize.js` (new)
- `src/admin/offline/appShell.js` (new)
- `src/admin/offline/offline.test.js` (new)
- `src/admin/offline/appShell.test.js` (new)
- `src/admin/api/adminOffline.js` (new)
- `src/admin/api/adminOffline.test.js` (new)
- `src/admin/pages/AdminOfflineBillingPage.jsx` (new)
- `src/admin/AdminRoutes.jsx`
- `src/admin/context/AdminSessionContext.jsx`
- `src/admin/components/AdminWorkspaceShell.jsx`
- `src/admin/pages/AdminCustomerRequestDetailPage.jsx`
- `public/offline-billing-sw.js` (new)
- `package.json`, `package-lock.json` (fake-indexeddb development dependency/test script)
- `docs/OFFLINE_BILLING.md` (new)

Frontend builds also regenerate local `dist` artifacts; they are not deployed.
