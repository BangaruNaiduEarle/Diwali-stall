# Final Rate visibility

Final Rate is `products.final_price_paise` (API `finalPricePaise` / `finalPriceInr`).
Owner and Super Admin retain access through the intersection of their season and
stall roles. Admins are denied by default.

Migration `0027_location_final_rate_access.sql` adds a boolean integer to the
existing `(location_id, season_id, admin_user_id)` membership. It is prepared only;
no existing local or production database is migrated by this change. Before
enabling the control in an approved environment, apply 0027 through that
environment's approved migration procedure. Pre-0027 catalogue/session reads
continue to deny Admin access; permission changes return 503 until the schema is
available. No legacy/global-user grant is supported: select an authorized stall.

In **Users**, Owner/Super Admin can toggle **Final Rate visibility** for each
enabled Admin in the selected stall. The endpoint is
`POST /api/admin/users/:id/final-rate-access` with `{ "enabled": true|false }`.
Other body fields are rejected. The actor, target, business, stall and operating
season are checked against current memberships; the write rechecks authority
atomically. Archived or disabled contexts cannot change grants.

An Admin's grant is read from D1 for every authenticated request, never from a
cookie, client header or client-supplied permission. Refreshing the session or
signing in again updates the UI. A changed capability remounts the existing
operational context to clear stale page data. API revocation takes effect on the
next request even before the Admin refreshes their session.

The permission is read-only. Purchase rates, Excel mappings, pricing edits,
finalization and privileged Quick Bill/QR/offline access retain their existing
role checks. Product catalogue responses use the same Final Rate redaction for
list, paginated list, detail and mutation responses. Existing pending offline
bills and QR records are not changed.

## Focused verification — 2026-11-04

Command: `node --test server/tests/finalRateAccessRuntime.test.js`

Result: **PASS**, seven focused scenarios (eight Node test entries including the
parent), zero failures. Existing `finalRateAccess.test.js` evidence (12 passing
authorization tests) was reviewed and reused without rerunning unrelated suites.

| Check | Result | Evidence |
| --- | --- | --- |
| Admin default denied | PASS | Authenticated detail/list/paginated APIs omit Final Price; rendered product card omits the field. Self-grant returns 403. |
| Owner/Super Admin grant | PASS | Both roles independently grant and revoke access through the actual Worker endpoint. |
| Granted Admin UI/API visibility | PASS | Actual product card renders Final Rate as ₹80 from the authenticated API's 8000-paise value. |
| Revocation and session refresh | PASS | Existing session cookie immediately receives a redacted product; refreshed and re-login sessions deny the capability and the rendered field disappears. |
| Other pricing/edit permissions | PASS | Purchase/mapping fields stay absent; purchase/private-rate GET and Final Price/selling-price PATCH return 403. Granted Admin's Final Rate renders without an inline editor. |
| Stall isolation | PASS | Stall A grant leaves Stall B's membership flag at zero, its session denied and its API/UI redacted. Unauthorized stall changes and body scope injection are rejected. |
| Migration 0027 | PASS | Applied to populated disposable Miniflare D1; existing membership records preserved, all grants default zero, invalid boolean rejected and foreign-key checks clean. Owner/Super Admin retain intrinsic access. |

This reuses the existing `workflowDb` in-memory fixture, the component-rendering
pattern from `AdminRequestPayments.test.js`, and the Miniflare runtime pattern
from `adminStallSettingsRuntime.test.js`. All persistence options are disabled.
The actual Worker is bundled in memory; authenticated HTTP calls target only the
new ephemeral runtime. No original local D1, production database, backup or
existing service is used. Application code was not changed for verification.

Limits: UI evidence is actual component markup rendered with current API/session
responses, not an interactive browser walkthrough. The fixture combines the
existing minimal location model with real 0020 membership DDL; this is not a full
migration-chain rehearsal or deployed-environment sign-off. Migration 0027 still
requires application through an approved environment's migration procedure;
this verification does not apply it to any existing database. No remaining
authorization defect was reproduced in the focused scenarios.
