# Public customer-request writer location context

`ADMIN_LOCATION_MODE` remains disabled by default; no Wrangler configuration is
changed. Disabled mode retains public catalogue season selection, SQL, IDs and
responses, with no queries to 0020 tables.

When enabled, the public POST writer requires three trusted Worker environment
settings: `PUBLIC_REQUEST_BUSINESS_ID`, `PUBLIC_REQUEST_LOCATION_ID` and
`PUBLIC_REQUEST_SEASON_ID`. For the existing mapping these would be
`business-diwali`, `location-diwali-2026`, `season-2026`. This documentation does
not enable the gate or set these values.

The configured business must own the configured location, which must have an
association with the configured operating season. All four statuses must be
active. Missing/invalid configuration, absent schema, ambiguous association or
archived context returns a generic 503 without accepting a request. There is no
location inference, public-catalogue fallback or mapping of `season-2099`.
Client body fields and admin selection headers do not select public tenants.

The same trusted tuple is required by public product and Family Pack catalogue
reads in location mode. Missing values return `503 catalogue_unavailable` even
when the Worker health check and authenticated admin APIs succeed. For isolated
local use, configure these values only in the verified disposable Worker's
configuration, after verifying the tuple's active rows there. Do not disable
location authorization or infer public scope from the browser's admin selection.

Catalogue validation uses location ownership, allowing permanent locations to
reuse catalogue rows with older provenance. Transactions receive the configured
operating season and location. Children inherit their parent's ownership and
recheck referenced product/pack ownership inside the batch. Public line pricing,
validation and summary response fields retain their existing behavior.

Enabled idempotency IDs hash the JSON tuple `[businessId, locationId, seasonId,
idempotencyKey]`; disabled IDs retain their original algorithm. Summary reads,
reference repair and concurrent replay handling remain location/season scoped.
Existing unmapped requests are not adopted as enabled-mode replays.

Quick Bill retains the admin scoped DB supplied by its authenticated request
flow. Direct manual-writer callers can supply `meta.context` and `meta.seasonId`;
enabled callers without validated admin context are rejected. Public writer
contexts cannot authorize manual writes.

The original writer-only validation used mocked D1 and did not verify real D1
execution or catalogue-read alignment. The current catalogue prerequisites are
described above. Quotation calculations, finalization and inventory are unchanged.

On 2026-11-04, the isolated local Worker on port 8793 was verified to use
`diwali-release-disposable` with disposable persistence. Its missing trusted
tuple was configured after read-only verification of the active scope. Targeted
checks returned 200 for all 162 public products and six Family Packs; anonymous
admin access remained 401. Browser checks verified API-derived category
navigation, direct category loads and desktop/mobile filtering. These local
results do not verify any production configuration or authorize deployment.
