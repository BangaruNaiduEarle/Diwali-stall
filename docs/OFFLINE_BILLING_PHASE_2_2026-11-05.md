# Offline Billing Phase 2 — development completion

Date: 5 November 2026. Baseline: completed Phase 1 continuous mobile POS.
Subsequent separate Users-page Billing Finalization permission and Super Admin
delegation are documented in [Billing Finalization permission](BILLING_FINALIZATION_PERMISSION_2026-11-05.md).
Only localhost, fresh browser profiles, disposable SQLite fixtures and ephemeral
native Local D1 are used for development checks. No production access,
configuration changes or deployment. Broad manual end-to-end testing is deferred
to the agreed final cycle.

## Decisions confirmed during implementation

- A granted Admin may finalize **any positive customer-agreed amount**, including
  an amount below Final Price. The issuing Owner and actual Admin are audited.
  Payments remain Owner/Super Admin only.
- QR must also support a bill finalized locally by an authorized Admin, allowing
  an Owner/Super Admin to accept it and capture payment before either device
  reconnects. Such acceptance/payment remains provisional until reconciliation.

## Implemented workflow

### Owner-controlled Admin authorization

Admin device preparation registers a non-extractable, scoped P-256 signing key
when the optional grant feature is available. Basic preparation still succeeds
if grant schema/signing is unavailable; the warning is explicit and Admin
financial actions stay unavailable.

In **Workspace → Admin offline Final Price authorization**:

1. Admin can use **Register / refresh Owner authorization** to register the key
   or fetch the currently issued grant. This does not grant permission by itself.
2. Owner uses **Load Admin devices & grants**, selects **Registered Admin device**
   and **Grant duration** (1, 4, 8 or 24 hours).
3. Without the checkbox, **Issue signed device grant** permits Final Price
   viewing only. **Also allow saving agreed amounts and finalizing offline**
   explicitly adds AGREEMENT/CLOSE authority. Super Admin cannot issue/revoke
   these grants, and Admin cannot self-authorize.
4. Admin refreshes authorization online. The browser verifies the server
   signature, identity/scope/device binding and the signed Final Price snapshot
   digest before caching it. It displays captured Final Price in product/cart
   views only while the grant is valid.
5. A granted Admin saves the ordinary selling-mode bill, uses **Save agreed
   amount**, then **Finalize bill → Confirm finalization**. The server still
   requires a positive saved agreement and saved items.
6. Owner can use **Revoke device grant**. Issuing a replacement grant atomically
   revokes previous grants for that exact target device. Retrying the same grant
   issuance ID is idempotent; changed input under that ID is rejected.

Grants are separate from the existing online Final Rate visibility flag. They
do not change that flag, roles, purchase/profit visibility, selling-price
overrides, discounts, payments, user management or QR acceptance permissions.
Updating the signed Final Price snapshot requires the Owner to issue a fresh
grant; a selling-catalogue refresh does not silently change signed prices.

### Signed grants and Worker validation

The certificate binds protocol/type, grant ID, business/stall/season, Admin,
device ID/public key, issuing Owner, permission, issue/expiry time and Final
Price snapshot digest. Maximum validity is 24 hours (UI default 8 hours).
Issuance uses the database clock to match commit-time checks.

For each Admin AGREEMENT/CLOSE the non-extractable device key signs the complete
immutable operation, including operation ID, amount/body, predecessor, request
revision, scope, capture time and certificate. WebCrypto completes **outside**
the IndexedDB transaction; the transaction rechecks revision/profile/grant and
commits the exact signed envelope with the draft. No private key is exported.

During synchronization the Worker independently verifies the authenticated
user/stall/season, registered device secret, grant signature/registry record,
device proof, original occurrence period, current expiry, current target
membership, current issuing Owner membership and all active scope statuses.
Database triggers repeat live grant and membership checks at the business commit
boundary. Revocation between validation and commit rolls back business writes,
grant use and receipt together. No Admin role is disguised as Owner.

Grant-use audit rows reference immutable grant records and original operation
IDs. Receipts retain `actor_role=admin`; finalization retains the Admin's email.
Acknowledgements also identify the grant and issuing Owner. Membership
changes/removal, user disable/re-enable and device disable/re-enable permanently
invalidate outstanding grants; restoring membership does not revive an old
certificate. A fresh Owner grant is required.

### QR scanner and bill handoff

**Scan bill QR** is available to prepared Owners/Super Admins. It opens the
optional handover section and starts the scanner if that device is prepared.
Missing preparation is explained. The scanner assembles every frame, verifies
the certificate, signature, intended recipient and scope, shows a preview, and
requires **Accept provisionally and save to outbox**. Camera tracks stop after
verification, cancellation or component exit. A scanner request is consumed;
reopening Workspace does not unexpectedly restart the camera.

The complete pasted sequence remains a supported fallback. Wrong recipients,
tampering and partial sequences do not create a bill/outbox row. Reaccepting the
same transfer opens its saved draft rather than creating another one.
A renewed transfer ID for the same already-accepted bill is also blocked locally
until the previous handoff is explicitly resolved or discarded.

Pending request QR remains version 1/2 with existing catalogue checks. Finalized
bill handoff uses version 3, retaining those line/Family Pack snapshots and
including the original complete source operation chain and agreed amount. Each
delegated Admin proof is verified offline against the trusted grant root.
Credentials, private signing keys, purchase data and profit do not cross QR.

After accepting a finalized bill, the receiving Owner/Super Admin sees locked
items, the captured agreement and payment collection. Its HANDOVER operation is
the predecessor of every payment. It does not queue a second closure. Changed
receiving catalogue prices do not reprice the signed finalized bill; differences
are shown, and the Worker reconciles the original source snapshots.

### Multi-device reconciliation and recovery

For finalized handoff the Worker checks the source certificate/current signing
device, creates a trusted internal source context, and reconciles **the original
source operation IDs** as the actual source user. No source device secret is
transported or invented. This is an internal verified-certificate path, not an
API/body/header permission bypass. Delegated agreements/closure still require
their individual valid grant/device proofs and commit-time authorization.

Source actions have individual atomic receipts. If source reconciliation stops
part-way, committed source actions remain acknowledged and retry resumes the
remaining original IDs. Only after the original CLOSE is acknowledged does the
recipient's claim/receipt commit together against that revision and actual saved
agreement. A changed bill or competing claim becomes an explicit conflict.

Both Admin-first and Owner-first synchronization converge on one bill. The
original Admin can later replay its own outbox and recover the same receipts.
A completed source closure may be handed off after its grant is subsequently
revoked: existing receipts are replayed, no new Admin financial action is minted.
Unacknowledged actions still require a live grant at sync time.

Two receiving devices cannot both claim the bill. The losing HANDOVER blocks its
dependent captures; it cannot silently create another payment. An interrupted
reply is recovered from the same immutable receipt. Independent bills continue
when a source-specific handoff/grant chain is denied.

For failed grant actions, **Review local and server versions** supports explicit
replacement after obtaining a fresh grant. Replacement uses a new reviewed
operation ID and cancels pending descendants, preserving every original. Retrying
an unchanged captured action never refreshes its timestamp or substitutes a new
grant. Known-cleared cached authorization cannot be restored by a stale profile.
Reviewed source replacements can be included in a fresh finalized QR: the signed
replacement identifies the original action and explicit server revision. The
Worker also compares the actual saved customer, items and agreement before claim.

If an operator explicitly cancels a failed handoff, never-sent payment captures
remain in history. On the finalized replacement bill, **Review retained payment
capture** and **Save recovered payment** preserve the original amount, method,
reference and occurrence time. Do not collect the money again. The old row links
to its recovery action; local transactions, server receipts and a unique recovery
constraint prevent a second recovery. A late original payment is rejected too.
Captures that were already attempted require reconciliation of the original
receipt; this action cannot silently replace a possibly recorded payment.

### PWA and Phase 1 preservation

Installation requests await browser confirmation; standalone mode and browser
installation events are distinguished from catalogue/shell readiness. **Check
app update** reports waiting updates. Updates never force reload during entry:
synchronize, close all app tabs/windows and reopen online when ready.

The active service worker checks its exact public asset allowlist and cached
workspace HTML. Readiness is rechecked on open, focus and controller change.
API/auth responses are not cached. A waiting update or missing asset does not
produce a false new-version readiness claim. Read-only profiles are labelled.

The existing IndexedDB database version/stores, scoped device identities,
continuous multi-customer workflow, autosave input fix, manual synchronization,
cart/search and mobile layout remain in place. Catalogue/device setup is reused
across customers and prepared stalls.

## Local prerequisites — completed locally on 5 November 2026

Prepared migration **0028_offline_final_price_grants.sql** adds grant/key/audit
records, durable invalidations and narrow commit-time trigger branches. It does
not edit migrations 0023/0024/0025 or grant any membership automatically.
Initial development checks applied it only to disposable fixtures/native
in-memory Local D1. Following explicit authorization, migration 0028 was then
applied to the existing **Local D1 only** using:

```text
cd server
node node_modules/wrangler/bin/wrangler.js d1 migrations apply diwali-quotation --local --config wrangler.toml
```

Wrangler executed 31 commands successfully and records 0028 as applied. A
subsequent local migrations list reports no pending migrations. The existing
database is `server/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/5264016ce8a63a3f1f9239770b32628020abc7fe1141bfbdd036d824a8f8ea73.sqlite`.
Before applying it, SQLite's online backup API created
`server/reports/phase2-local-prerequisites-2026-11-05/before-0028.sqlite`.
All 34 pre-existing application tables retain identical row counts and content
hashes. Only D1's internal `_cf_METADATA` and migration tracking changed, plus
the intended schema additions/replacements. All 27 declared schema objects are
present, `integrity_check` is `ok`, and foreign-key violations are zero. No data
reset, deletion, membership grant or bill/payment operation was performed.

The server uses `OFFLINE_GRANT_SIGNING_JWK` if configured; otherwise it reuses
the existing server-only `HANDOVER_SIGNING_JWK`, with a distinct signed grant
type/claims. QR itself still requires the handover signing configuration.
Preparation supplies the trusted public verification keys. A new local-only
ECDSA P-256 signing root was appended as `HANDOVER_SIGNING_JWK` to the existing,
Git-ignored `server/.dev.vars`, preserving all existing entries. Both signing
variables were absent before configuration. Offline grants use the supported
handover-key fallback; a separate `OFFLINE_GRANT_SIGNING_JWK` is unnecessary.
Wrangler `getPlatformProxy` loaded the local secret with `remoteBindings:false`
and nonpersistent test bindings. The project's signer/verifier successfully
round-tripped both QR and grant signatures. No private key value was printed or
written to documentation, frontend configuration or a production secret store.
Neither `.env.local` nor `wrangler.toml` was changed.

Verification evidence and the backup are in the Git-ignored
`server/reports/phase2-local-prerequisites-2026-11-05/` directory. If a local
Worker was already running, restart it to load the new secret before the later
testing cycle. Device preparation/refresh and Owner grant issuance remain
operator actions for that cycle; no grants or browser data were created here.
No production access, deployment or broad manual E2E testing occurred.

## Test scope and results

Targeted automated regressions only. Server tests exercise scoped route/service
code with disposable fixtures and native ephemeral Local D1; component tests use
fresh headless Chrome with external requests blocked. Scanner frame delivery is
simulated in the component regression; signature verification, frame assembly,
grant caching and IndexedDB acceptance are real. Existing camera codec and
permission/cancellation regressions remain included. Physical camera claims are
not inferred from simulation.

Final verification on 5 November 2026:

- **152 passed, 0 failed, 0 skipped**: `node --test --test-concurrency=1`
  against `server/tests/{offlineGrants,offlineSync,handoverSync,requestPayments,adminQuickBillAtomic,adminCustomerRequestFinalizeAgreed}.test.js`,
  `src/shared/handoverProtocol.test.js`,
  `src/admin/offline/{grants,offline,authority,handover,familyPackHandover,appShell,posPresentation}.test.js`
  and `src/admin/lib/adminSeasonSelector.test.js` (explicit individual paths in
  the executed command; braces here abbreviate the file list). Includes native
  ephemeral Local D1 grant, handoff and recovered-payment transactions.
- **3 passed, 0 failed, 0 skipped**: `node --test --test-concurrency=1`
  with `src/admin/components/OfflineOperations.test.js`,
  `src/admin/pages/AdminOfflineBillingPage.pos.test.js` and
  `src/admin/pages/AdminOfflineBillingPage.pwa.test.js`. Covers the actual grant
  controls, cached key/reload, scanner acceptance, continuous customer entry,
  keyboard editing, mobile widths, stall isolation, receipts, built service
  worker readiness, offline reload and missing-asset detection.
- Local Vite build passed (2,348 modules), with the API base forced to an empty
  localhost-relative value in process memory. Existing large-chunk warning
  remains; largest JavaScript chunk is approximately 1.16 MB before gzip.
- Targeted Oxlint exited successfully: **0 errors, 6 warnings** (existing unused
  query constant, effect state updates and async cancellation/cleanup patterns).
  Tracked changed-file `git diff --check` passed.

Total: **155 automated tests passed** on the final code. Earlier development
runs are not added again to this count. No broad manual end-to-end acceptance
cycle or physical Android test was performed.

## Changed files in this phase

- `server/database/migrations/0028_offline_final_price_grants.sql`
- `server/src/services/adminOfflineGrants.js`
- `server/src/lib/offlineFinalizationAuthority.js`
- `server/src/routes/adminOfflineSync.js`
- `server/src/services/adminOfflineSync.js`
- `server/src/services/adminHandover.js`
- `server/src/services/adminCustomerRequests.js` (narrow internal grant gate)
- `server/src/services/adminPayments.js` (recovered-capture conflict response)
- `src/shared/offlineGrant.js`, `src/shared/handoverProtocol.js`
- `src/admin/api/adminOffline.js`
- `src/admin/offline/storage.js`, `synchronize.js`, `handover.js`,
  `posPresentation.js`, `appShell.js`
- `src/admin/pages/AdminOfflineBillingPage.jsx`
- `src/admin/components/OfflineAuthorization.jsx`, `OfflineHandover.jsx`,
  `OfflineInstall.jsx`, `OfflinePosWorkspace.jsx`
- `src/styles/offline-pos.css`
- Tests: `server/tests/offlineGrants.test.js`,
  `src/admin/offline/grants.test.js`, `src/admin/offline/appShell.test.js`,
  `src/admin/components/OfflineOperations.test.js`
- This report and Phase 1 documentation links/continuation notice.

## Limits and physical-device verification still required

- Finalized QR requires complete original device history, at most 25 source
  actions, at most 50 bill lines and the existing 64 KiB signed-transfer limit.
  Larger/incomplete histories are rejected explicitly, never truncated. Source
  payment captures are not transferred; synchronize such bills and use their
  server record. An accepted bill cannot be handed over again.
- Grant capture needs a valid cached certificate and accurate device time. New
  unacknowledged financial commits need an unexpired/live grant at sync time.
  Offline revocation cannot instantly notify a disconnected phone; server
  rejection and preserved local history remain authoritative.
- No Admin payments, purchase/profit access, discounts or unit-price overrides
  are enabled by a grant. Payments record money received; no offline bank/UPI
  transaction processing, refunds or custom Family Pack substitutions.
- A storage wipe/eviction or lost non-extractable device key is not recoverable
  from an unacknowledged bill that was never transferred/backed by a server
  receipt. Device-bound grants cannot be copied to another browser. Persistence
  is browser-controlled; private browsing is unsuitable.
- Full offline reload requires the built app and a verified shell, not Vite dev
  mode. Synchronization requires an open page, connectivity and current matching
  authentication. There is no background service-worker business sync.
- Owner device/grant lists are bounded at 500 and fail explicitly if exceeded.
  Full grant/receipt/claim audit remains retained in D1.
- Still requires physical Android verification: installation/standalone launch,
  real camera permission and focus, multipart QR performance between phones,
  low light/glare, browser kill/relaunch, storage pressure/eviction, device clock
  changes, real network switching and crowd-time ergonomics at 360–430 px.
- No final release acceptance, production parity or deployment is claimed. The
  complete final manual end-to-end testing cycle has not begun.
