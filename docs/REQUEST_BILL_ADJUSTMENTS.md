# Online request adjustments and handover

Step 4 uses the existing 0021 schema and event/revision triggers. No migration is
added or applied. The 2026 workflow uses validated location mode.

`PATCH /api/admin/customer-requests/:id/adjust-bill` requires the displayed request
revision in `If-Match` in location mode: missing revisions receive 428 and stale
revisions receive 409. Preview uses the same body at `/adjust-bill/preview`.

All authorized staff may send `items: [{ productId, quantity, unitType }]` for an
open manual bill or public request with a quotation. Existing family-pack lines
are preserved. The existing validator requires at least one product line.
Admin edits preserve authorized unit prices/discounts and cannot set financial
fields. Changing items invalidates the previous customer-agreed amount.

Owner/Super Admin may also set item `unitRatePaise` and bill-wide `discountPaise`.
Rates must be positive integer paise; discounts must be non-negative integer
paise within the subtotal. Omitted fields retain saved values; explicit discount
0 clears the discount. These financial overrides require location mode.

Original catalogue units remain in request `unit_price_paise` and structured
billing metadata. Saved quotation units represent customer prices; quotation
`adjustment_paise` is the negative fixed discount. Request item history captures
before/after billing metadata, and previous quotation snapshots are retained.
Verified saved unit snapshots prevent catalogue changes from repricing saved bills.
Historical unverifiable snapshots retain the existing fail-closed presentation.

Privileged quotation-detail responses/UI show current purchase/profit estimates,
using location-matching rates. Missing data produces unknown estimates. These
estimates are excluded from Admin responses and never influence customer prices.
Final Price + ₹500 is reference-only for Bargaining/Hold; it never sets bill or
agreed amounts. No payment or payment-hold feature is implemented.

Location-mode checkout accepts optional `assigneeUserId`. Request, quotation and
handover commit in one D1 batch, rechecking recipient season/location authority
inside that batch. The recipient participates in the checkout idempotency
fingerprint; changing it under the same key receives 409. Checkout without a
recipient retains its previous fingerprint format and legacy compatibility.

Quick Bill checkout now requires a stable `Idempotency-Key` in both legacy and
location modes. The existing frontend retains this key across uncertain retries.
Both modes commit the complete checkout in one atomic D1 batch and use the existing
request primary key to enforce uniqueness. Repeating completed input returns its
persisted transaction with `idempotentReplay: true`; changed input under the same
key receives 409. Missing/invalid keys receive 400. Legacy identity is scoped by
season and authenticated creator; location-mode identity and authorization remain
unchanged. No migration is required. See [the fix report](RELEASE_BLOCKER_FIXES_2026-11-03.md).

Standalone new handovers require `If-Match` in location mode. Repeating an already
completed assignment by the same actor to the same recipient returns current
progress without changing timestamps, revisions or recipient edits. Otherwise
normal revision checks apply.

The React editor sends displayed revisions, preserves dirty drafts on newer data,
blocks conflicted saves and offers explicit reload. A separately refreshed
quotation cannot advance the revision used with stale request items. Admin may
refresh handed-over request progress. No offline storage, sync, QR or payments
are included.

## Changed files

Backend:
- `server/src/lib/billAdjustmentPolicy.js` (new)
- `server/src/lib/billPurchaseSummary.js` (new)
- `server/src/lib/savedBillPricing.js` (new)
- `server/src/lib/adminCustomerRequestScope.js`
- `server/src/lib/adminQuotationResponse.js`
- `server/src/lib/customerFacingQuotationTotal.js`
- `server/src/lib/quickBillValidation.js`
- `server/src/services/adminCustomerRequestBillAdjust.js`
- `server/src/services/adminCustomerRequests.js`
- `server/src/services/adminQuickBill.js`
- `server/src/services/adminQuickBillAtomic.js`
- `server/src/routes/adminCustomerRequests.js`
- `server/src/routes/adminQuotations.js`

Frontend:
- `src/admin/lib/billAdjustment.js` (new)
- `src/admin/lib/adminCustomerRequestAdjustBillCart.js`
- `src/admin/api/adminApi.js`
- `src/admin/components/AdminCustomerRequestAdjustBillPanel.jsx`
- `src/admin/pages/AdminCustomerRequestDetailPage.jsx`
- `src/admin/pages/AdminQuickBillPage.jsx`

Tests and documentation:
- `server/tests/billAdjustmentsHandover.test.js` (new)
- `src/admin/lib/billAdjustment.test.js` (new)
- `src/admin/api/adminApi.billAdjustments.test.js` (new)
- `server/tests/adminBillingAuthorization.test.js`
- `server/tests/adminCustomerRequestAssignee.test.js`
- `server/tests/adminCustomerRequestBillAdjust.test.js`
- `server/tests/requestWorkflowHistory.test.js`
- `server/tests/helpers/workflowSqliteBridge.py` (explicit UTF-8 for public quotation messages)
- `docs/REQUEST_BILL_ADJUSTMENTS.md` (new)
- `docs/REQUEST_WORKFLOW_HISTORY.md`

The frontend build also regenerates local `dist` artifacts.
