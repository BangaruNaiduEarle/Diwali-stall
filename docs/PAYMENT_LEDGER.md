# Payment ledger (Step 5)

## Migration and compatibility

`0022_request_payment_ledger.sql` follows the prepared `0021_request_workflow_history.sql`.
No migrations have been applied to existing databases for this implementation. The
payment APIs and location-mode request summaries require 0022 after 0020/0021.
Legacy season-only billing stays unchanged; payment APIs require validated location mode.

The migration adds immutable `request_payment_accounts`, append-only
`request_payment_ledger`, summary views, uniqueness indexes and validation/audit triggers.
It creates a payment account when a request is finalized/closed, without requiring
payment first. Accounts freeze the saved positive **customer-agreed amount** and
quotation ID. Catalogue prices, purchase/profit values and Final Price + ₹500 are
never used as the payment balance.

Existing finalized requests with one verified active quotation and a valid agreed
amount receive only a balance account. No receipts, actors or payment history are
invented. Historical requests lacking verified amounts show an unknown balance
and cannot accept payments through this API. Account amounts cannot be edited.

## Entries and status

Each ledger entry has a server payment ID, globally unique client operation ID,
request and business/location/season scope, integer paise, recording mode, method,
reference/details, actor ID/name/effective-role snapshot, device ID, occurrence time,
and server receipt time. Sequence order is receipt order, including historical records.

- `PAYMENT`: positive integer paise and method `CASH`, `UPI`, `CARD`, `BANK` or `OTHER`.
- `HOLD` / `RELEASE_HOLD`: zero amount, no payment method/reference; details may explain the hold.
- Recording mode is independently `ONLINE` or `OFFLINE`. OFFLINE is a manually entered
  historical record and requires occurrence time. It does not provide offline storage/sync.
- Missing ONLINE occurrence time uses the database recording time. Device identity is
  taken from the existing validated transport header. The browser supplies a transient
  browser-instance ID; external callers may supply their own known device ID.

Received amount sums payment entries only. Outstanding equals the frozen amount due
minus received. No overpayment, zero/negative payment or fractional paise is accepted.
INR form inputs allow at most two decimals and are converted exactly with integer math.

Payment status is derived: `PAID` at zero outstanding, otherwise `HOLD` when an active
hold exists, otherwise `PARTIAL` after some receipts or `UNPAID`. A partial payment
does not release a hold. Full payment reports PAID even if an earlier hold event remains
in history. These statuses never modify request closure or bargaining status.

## API, retries and scope

`GET /api/admin/customer-requests/:id/payments?afterSequence=0&limit=50` returns summary
and ledger history in one read transaction (maximum page size 100). All authorized
location members can read. Responses contain no purchase/profit data.

`POST` to the same path accepts only:

```json
{
  "operationId": "client-generated-unique-id",
  "entryType": "PAYMENT",
  "amountPaise": 2500,
  "recordingMode": "ONLINE",
  "paymentMethod": "UPI",
  "reference": "transaction-reference",
  "details": "Optional details",
  "occurredAt": "2026-11-03T10:00:00Z"
}
```

Only the lesser season/location Owner/Super Admin authority can write. New operations
require the displayed request revision in `If-Match`. Membership/scope and balance are
checked again inside the write transaction. Platform Admin/global roles grant no bypass.

Repeat the same operation ID and unchanged details after a timeout/ambiguous failure.
The original entry is returned without another receipt/event, even if the request revision
has advanced. Changed details or a reused ID on another request produce conflict.
UPI/CARD/BANK require a reference. Non-cash references are normalized for spacing/case
and unique within business/location/season/method, preventing duplicate transactions
under different operation IDs. Separate cash receipts require separate operation IDs.

Ledger writes, revision advancement and Step 3 audit events are atomic. Database
triggers prohibit ledger/account updates/deletes. The frontend keeps retry IDs in
memory for the current online form; no durable client outbox is added. Refunds,
reversals, payment gateways, IndexedDB, offline sync and QR are outside this step.

Request cards and details show due, received, outstanding and payment status. Detail
history retains actor, role, method/mode, reference, device and both timestamps. Only
privileged users see the recording/hold form. History pagination preserves its cursor
when a new receipt is recorded while older pages remain unloaded.

## Changed files

- `server/database/migrations/0022_request_payment_ledger.sql` (new)
- `server/src/lib/paymentValidation.js` (new)
- `server/src/services/adminPayments.js` (new)
- `server/src/routes/adminPayments.js` (new)
- `server/src/routes/adminCustomerRequests.js`
- `server/src/index.js`
- `src/admin/lib/payments.js` (new)
- `src/admin/lib/billAdjustment.js` (exports the existing exact INR parser)
- `src/admin/api/adminPayments.js` (new)
- `src/admin/components/AdminPaymentSummary.jsx` (new)
- `src/admin/components/AdminRequestPayments.jsx` (new)
- `src/admin/components/AdminCustomerRequestCard.jsx`
- `src/admin/pages/AdminCustomerRequestDetailPage.jsx`
- `server/tests/requestPayments.test.js` (new)
- `server/tests/helpers/workflowSqlite.js` (latest in-memory schema)
- `server/tests/helpers/mockAdminTransactionDb.js` (summary read fixture)
- `src/admin/lib/payments.test.js` (new)
- `src/admin/api/adminPayments.test.js` (new)
- `src/admin/components/AdminRequestPayments.test.js` (new)
- `docs/PAYMENT_LEDGER.md` (new)

Frontend builds also regenerate local `dist` artifacts. Migration/persistence tests
use disposable in-memory SQLite; they are not a Cloudflare D1 migration rehearsal.
