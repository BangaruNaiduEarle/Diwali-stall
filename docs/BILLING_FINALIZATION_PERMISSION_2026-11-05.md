# Separate Billing Finalization permission

Implemented locally on 5 November 2026. No production access or deployment.

## Operator flow

1. Owner or Super Admin opens **Users** in the selected stall and season and
   enables **Billing Finalization** for the desired Admin. It starts OFF for
   every Admin. **Final Rate visibility** remains an independent read-only flag.
2. For online Quick Bill, the Admin saves the ordinary selling-price bill first.
   On its success screen, or in the Request inner page, use **Prepare signed
   billing**. It registers/reuses the browser's scoped non-extractable device
   key and caches an eight-hour signed grant using the existing Phase 2 root.
3. Review the selected items' captured individual Final Prices and their sum.
   Loose-piece values use the existing integer-paise division rule. A missing
   Final Price or Family Pack Final Price is shown as unavailable; no value is
   invented and this informational preview never changes payable totals.
4. Enter **Customer-agreed final amount (₹)**, then **Save agreed amount**. Any
   positive agreed amount is permitted, including below Final Price. Editing
   and saving it again before closure records the previous and new amounts.
5. Use **Finalize bill → Confirm finalization**. Finalization requires saved
   items and the saved positive agreement. Existing closed bills remain locked;
   this permission does not enable reopening, refunds or changes to payments.
6. A queued operation is provisional until the server acknowledges it. A lost
   reply retains the original signed operation. **Retry signed synchronization**
   replays that same identity. A conflict/denial remains preserved for explicit
   review in **Offline Billing**; it is never silently rebased or resubmitted
   with a new operation ID.
7. For offline work, use the existing POS: prepare/refresh the device online,
   then save/edit agreements and finalize with its cached valid grant. Reconnect
   and use the existing synchronization controls. QR and Owner/Super Admin
   payment handoff continue through the original Phase 2 paths.
8. In Users, turn **Billing Finalization** off to revoke grants derived from
   that permission on every device. Offline phones learn the change on refresh;
   new server commits are rejected immediately, even if a phone is disconnected.
   Already acknowledged actions still recover their original receipts.

## Compatibility and security

- Existing independent Phase 2 Owner device grants and their data are preserved.
  The new Users switch neither enables nor revokes those historical grants.
  To remove such independent authority, revoke its device grant using the
  existing Owner controls in Offline Billing. This distinction is shown in Users.
- New per-Admin permissions are grant records, not role changes. Owner/Super Admin
  issuance/revocation requires current enabled membership in both the operating
  season and selected stall, plus active business/stall/season association.
  Admins cannot self-grant or act through another Admin's certificate/device.
- Migration 0029 adds immutable permission identities with retained revocation
  metadata and a nullable permission reference on existing device grants. Old
  grants retain NULL and the original Owner-only checks. New linked grants
  support Owner/Super Admin grantors. The legacy certificate field `ownerUserId`
  remains wire-compatible and identifies the actual grantor, including a Super
  Admin. Receipts additionally expose the alias `grantorUserId`.
- Membership role/availability changes and removal durably revoke the new
  permission; re-enabling membership does not revive it. A fresh grant is needed.
- Online Admin actions use the same IndexedDB key, immutable signed AGREEMENT/
  CLOSE operations, sync endpoint, server verification, revisions, atomic
  grant-use audit and receipts as offline actions. Legacy online financial
  routes retain their existing role gates. Only the selected online draft is
  dispatched; unrelated offline customers are not silently synchronized.
- A bill with outstanding local operations cannot be opened as another online
  version. Its original actions must be synchronized/reviewed in Offline Billing.
  Concurrent acknowledged versions still face server revision checks.
- Grantor/Admin/permission identity is retained in permission and grant-use
  records. Existing append-only workflow events record old/new agreed amounts
  and finalization as the actual Admin. Join grant uses to scoped receipts by
  operation ID and to workflow events by request/revision to inspect the full
  delegation audit. Revocation retains grantor, target Admin, revoker, occurrence
  time and operation ID. No purchase/profit/price-edit/payment authority is added.
- The commit-time live-grant view retains every existing scope/identity/status
  predicate. Its independent predicates are grouped to stay within native D1's
  expression-depth limit when expanded by the existing transactional triggers.

## Local migration and preservation

Applied **0029_billing_finalization_permissions.sql** through Wrangler with
`d1 migrations apply diwali-quotation --local --config wrangler.toml`, from
`server`. Exactly one pending migration was applied (17 SQL commands). A later
local migration list reports none pending. No prior migration was edited.

SQLite online backup and before/after evidence are stored in the ignored local
directory `server/reports/billing-finalization-0029-local-2026-11-05/`.
Verification compares all original columns/rows in all **38 existing application
tables**: unchanged. All 13 declared schema objects exist, SQLite integrity is
`ok`, and foreign-key violations are zero. The new permission table has zero
rows; no existing grant was automatically linked and no user was authorized.
No `.env.local`, `.dev.vars`, deployment or production configuration was changed.

## Targeted checks

- **98 core tests passed, zero failures/skips** using
  `node --test --test-concurrency=1` with
  `server/tests/{offlineGrants,finalRateAccess,offlineSync,handoverSync,requestPayments}.test.js`,
  `src/admin/offline/{grants,posPresentation}.test.js` and
  `src/shared/handoverProtocol.test.js` (braces abbreviate explicit file paths).
  Includes native ephemeral Local D1, migration preservation, Owner/Super Admin
  delegation, revocation at commit, stale revisions, duplicate receipts,
  finalized QR, dependent payment and existing read-only Final Rate gates.
- **Four focused browser regressions passed**: new Users-to-signed-billing test
  (`server/tests/billingFinalizationUi.test.js`), existing
  `OfflineOperations.test.js`, `AdminOfflineBillingPage.pos.test.js` and
  `AdminCustomerRequestDetailPage.purchaseVisibility.test.js`. They use fresh
  headless browser profiles and block external requests. The new browser test
  runs actual grant and sync services against disposable SQLite, with real
  browser IndexedDB/signatures, a lost reply, amount editing, closure and
  revocation/cache clearing. The Request visibility test requires Node 20's
  `--experimental-websocket` flag; its initial environment failure was resolved
  by running with that flag, without changing the test or application behavior.
- Final stale Users command checks passed for both Owner and Super Admin:
  successful grant/revoke replay returns its original audit result; a different
  command against already-changed state returns 409 for refresh/review.
- Local Vite build passed, 2,352 modules. API base was forced to localhost-relative
  in process memory. Existing large JavaScript chunk warning remains.
- Targeted lint: zero errors, six warnings concerning effect state/cleanup
  patterns in Users and the existing POS. Tracked changed-file whitespace checks
  passed.

**102 distinct targeted automated tests passed**; repeated focused runs are not
added to the total. No broad manual acceptance test was performed.

## Changed implementation files

- `server/database/migrations/0029_billing_finalization_permissions.sql`
- `server/src/services/adminOfflineGrants.js`
- `server/src/services/adminOfflineSync.js`
- `server/src/routes/adminOfflineSync.js`
- `src/admin/api/adminOffline.js`
- `src/admin/pages/AdminUsersPage.jsx`
- `src/admin/pages/AdminQuickBillPage.jsx`
- `src/admin/pages/AdminCustomerRequestDetailPage.jsx`
- `src/admin/components/SignedBillFinalization.jsx`
- `src/admin/components/OfflineAuthorization.jsx`
- `src/admin/components/OfflinePosWorkspace.jsx`
- `src/admin/offline/signedBilling.js`
- `src/admin/offline/finalPricePreview.js`
- Tests: `server/tests/offlineGrants.test.js`,
  `server/tests/billingFinalizationUi.test.js`, `src/admin/offline/grants.test.js`.

Physical Android camera/install/storage/network acceptance and the final broad
manual end-to-end cycle remain deferred. Refresh the app and restart the local
Worker if it has not picked up code changes, then use the explicit grant and
device preparation steps above. Existing offline expiry/storage limits remain.
