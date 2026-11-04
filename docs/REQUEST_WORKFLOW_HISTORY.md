# Request workflow history (0021)

`0021_request_workflow_history.sql` follows the location foundation migration.
It is prepared in source only; it has not been applied to existing local or remote databases.
Apply it through the normal migration runner after the separately validated 0020 foundation.
The API code requires 0021; there is no silent fallback when its columns/table are unavailable.

Historical requests retain their creation timestamps, emails, item names, quantities and prices.
They start at revision 0 without fabricated past events, user IDs, role/device information or units.
Existing lines receive a stable `historical-line-<original row ID>` identity. Historical quotation
lines are linked only when request line number, product ID, name and quantity match.

New authenticated location-mode workflow writes stamp the server-validated user ID, current
display name and lesser season/location role. Creator snapshots cannot subsequently change.
Assignment snapshots preserve both parties, effective role and the existing assignment timestamp.
Anonymous/public or legacy SQL writers without authenticated context produce NULL actor/device
snapshots; names, roles and devices are never inferred from historical emails.

Request/quotation line snapshots include stable identity, explicit box/piece unit, pack label,
pieces per pack and permitted product details. Current new-line unit selection follows the existing
Quick Bill box/loose-piece convention; historical unknown units remain NULL. Adjustments retain
the identity and snapshots of surviving logical product/unit lines while deleted versions remain
in the event history. Removed and later re-added lines can have new identities.

Database triggers append request creation, item additions/removals/changes, assignment,
status/closure and quotation creation/adjustment events in the business transaction. Each event
advances the request revision once, so a single multi-line adjustment can advance it several times.
Every event has a unique ID, request and scope IDs, actor/name/role snapshots, optional device/time,
server receipt time, revision, and before/after metadata. UPDATE/DELETE of events is rejected.
Audit failure rolls back the business transaction. Quotation replacements keep earlier quotations.
Transient actor context is cleared before the transaction commits so unrelated later SQL writes
cannot inherit a previous actor or device.

For a conditional edit, send `If-Match: <request revision>` (also accepts a quoted integer).
Stale edits receive HTTP 409. Without the header existing clients remain compatible; service-side
snapshots still guard races during an operation. Read the latest revision from request detail or
`quotation.requestRevision`. Step 4 sends displayed revisions from the browser;
location-mode item edits and new handovers require them.

Optional `X-Device-Id` and ISO-8601 `X-Device-Occurred-At` headers capture untrusted transport hints,
not identity or authorization. Absent hints stay NULL. Server receipt time is always database-generated.

`GET /api/admin/customer-requests/:id/history?afterRevision=0&limit=50` returns ascending events,
with a maximum page size of 100. Read authorization and scope come from the existing validated
server context. Event scope must also match its parent request. Admin history removes price/rate/
agreed-amount snapshots; purchase, cost, profit and margin fields are excluded from history responses.
No audit API accepts arbitrary event writes. No payment, offline, QR or sync feature is implemented.

Focused persistence tests use Python's standard-library SQLite in disposable in-memory processes.
They exercise real migration SQL and the existing D1-shaped services, without opening an application
database. They are not a Cloudflare D1 deployment or migration rehearsal.
