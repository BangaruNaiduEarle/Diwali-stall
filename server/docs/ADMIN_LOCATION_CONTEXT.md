# Admin location request context

`ADMIN_LOCATION_MODE` is off by default. Unset, empty, `false` or `0` preserves
the existing season-only request context and does not query any 0020 table.
`true` or `1` enables location authorization (case-insensitive, whitespace trimmed).
Other values reject admin context setup with a safe 503 configuration error.
No Wrangler configuration is changed by this implementation.

Enabled operational admin requests use the existing authenticated identity and
season resolution, then validate `X-Admin-Location-Id` through the read-only
location resolver. `X-Admin-Season-Id` still selects the operating season.
Both headers are allowed by CORS. Business identity always comes from D1.
Only the unambiguous existing 2026 mapping can be selected without a location
header. Missing, invalid, disabled or ambiguous membership returns 403; location
schema/read errors return 503 without SQL details. Neither failure falls back.

`getAdminContext(request).locationContext` and `getAdminLocationContext(request)`
expose the validated scope using the existing request WeakMap convention.
Location-aware guards require both memberships and offer membership, role and
writable-context checks. Existing season guards also enforce location context
when enabled. Their `auth.seasonRole` carries the common (lower) authority for
existing role-based handlers; the original season role remains in the attached
season context. Effective capabilities are the resolver's intersections.

Archived business, location, season or association permits authorized reads but
rejects writes. GET/HEAD/OPTIONS resolve read access; other operational methods
require writable context before the handler. No global-role/platform-admin bypass
exists for operational routes.

GET `/api/admin/session` and `/api/admin/platform[/...]` retain their existing
identity/platform authorization without an operational location requirement.
They do not acquire operational permissions by this exemption. Login, logout,
session validation and cookie behavior are unchanged.

Rollout boundary: this adds context and authorization only. Operational services
still use their existing season predicates, so the flag must remain disabled
until 0020 is separately authorized/applied and query-level location isolation,
ownership writes and membership-management integration are complete. This flag
alone does not isolate multiple location catalogues or transactions.
