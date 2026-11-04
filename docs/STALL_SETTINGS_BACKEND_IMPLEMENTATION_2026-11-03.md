# Stall Settings Backend Implementation — 3 November 2026

**Implemented the backend foundation for independent Stall Settings.** `GET/PATCH /api/admin/settings` now uses authenticated stall/season scope, independent persisted namespaces, Owner/Super Admin updates, read-only Admin display access, revision checks and atomic settings audit history. No frontend UI or existing consumer was changed.

Reviewed [Reports & Settings gap analysis](REPORTS_SETTINGS_GAP_ANALYSIS_2026-11-03.md), current Worker routing, Platform setting API, location/season authorization, migration definitions and `siteConfig`. Existing acceptance reports retain their historical statuses unchanged. This implementation does not by itself close the complete Settings UI/consumer acceptance gap.

All database execution used new SQLite `:memory:` fixtures or a new nonpersistent Miniflare D1 binding. **No original local database, established disposable baseline or production database was opened or modified.** No Git command, deployment, dependency change, existing report edit or migration against an existing database occurred.

## Settings classification

| Existing value / structure | Existing scope | Implemented classification / behavior |
| --- | --- | --- |
| `platform_settings.public_catalogue_season_id`, update timestamp/email | Platform singleton | **Remains global**, Platform Admin API unchanged. Not writable through Stall Settings. |
| `business_seasons.code/label/status` and Platform season administration | Shared registry / Platform controls | **Remain Platform-managed**; not stall-editable. A setting does not create/archive a season. |
| `PUBLIC_REQUEST_BUSINESS_ID`, `PUBLIC_REQUEST_LOCATION_ID`, `PUBLIC_REQUEST_SEASON_ID` | Trusted deployment configuration for public catalogue/request routing | **Remain server configuration**. No body/query value or stall setting changes public routing. Existing explicit legacy singleton fallback versus location-mode trusted tuple behavior remains unchanged. |
| `businesses.name/slug/business_type/status` | Business-owned identity/lifecycle | **Remain business/provisioning controls**. New stall branding defaults to the authorized business name but can be independently overridden. No business rename/status/type edit is exposed here. |
| `business_locations.name/address/stall_label` | Already stall-owned canonical metadata | **Reused**, through `profile.stallName`, `profile.locationAddress`, `profile.stallLabel`. No contradictory duplicate identity/address columns. Changes affect only the authorized location. |
| `siteConfig.brandName` | Shared static frontend value | **Stall override** `profile.brandName`; new stalls default to their business name. The original verified stall retains the existing static brand default. Static consumers themselves remain unchanged. |
| `siteConfig.whatsappNumber`, `phone` | Shared static frontend contact | **Stall profile values**. New stalls start empty; they do not inherit the original contact. Explicit empty strings clear values. |
| `siteConfig.locationName`, `locationDetailLines`, `locationMapUrl` | Shared static venue presentation | **Stall profile values**. Venue name is separate from canonical stall identity; map/detail fields are independently stored. Deprecated static `googleMapsUrl` alias/helpers remain untouched. |
| `siteConfig.locationAddress` | Shared static venue address | Authorized canonical location address takes precedence. The verified original stall falls back to its current static address only when its canonical address is null. An explicitly empty saved address stays empty. |
| `siteConfig.stallDates`, `stallTimings` | Shared static schedule | **Stall + operating-season values**; same permanent stall can have different dates/hours in different seasons. Only original `season-2026` receives its legacy date/time defaults. |
| `location_seasons.operating_year/status` | Existing stall/season association | **Unchanged structural controls**; not schedule fields or arbitrary Owner toggles. Settings must reference a real association. |
| User roles, memberships, ownership, signing keys, cookie/auth policy, CORS, API URLs, uploads/Cloudinary credentials | Security, Platform or deployment policy | **Not stall-editable settings.** No role bypass, secret, token or runtime flag is accepted or returned. |
| Catalogue selling/purchase/private rates, Final Price + ₹500, discounts, ledger methods/modes, QR/Family Pack limits | Existing catalogue/financial/safety contracts | **Unchanged**. Not configurable through Settings; financial/security/unknown fields are rejected. |

Independent stall profiles do not imply that every business or deployment control becomes stall-specific. Profile fields intentionally span seasons of one physical location; schedules belong to the selected operating season. An archived season may read current shared profile values, but cannot edit them. Historical immutable issuer/contact snapshots remain outside this phase.

## Schema inspection and migration decision

Existing 0018 stores only a global Platform singleton. Existing 0020 provides canonical stall name/address/label and associations/memberships, but no independently persisted contact/schedule overrides, settings revisions or settings history. Existing request/bill JSON and request audit events are not appropriate general settings storage.

Prepared [0026_stall_settings.sql](../server/database/migrations/0026_stall_settings.sql):

| Structure | Purpose |
| --- | --- |
| `location_settings`, primary key `location_id` | Nullable typed profile overrides, JSON detail-line array, independent revision and server updater/time metadata. Canonical name/address/label stay in `business_locations`. |
| `location_season_settings`, primary key `(location_id, season_id)` | Date-list JSON and timings, independent per-season revision/updater/time; composite FK to the existing location-season association. |
| `location_settings_events` | Scoped business/location/authorization-season, authenticated actor/effective role, resulting profile/season revisions, allowlisted before/after changes and server receipt timestamp. |
| `idx_location_settings_events_scope` and three event triggers | Scoped history index, immutable UPDATE/DELETE, duplicate/REPLACE and foreign-business audit rejection. |

The migration creates only new tables/index/triggers. It does not rewrite existing settings, locations, historical bills, ledger data, membership or catalogue. Settings rows are initialized lazily in the first successful update transaction; **GET does not create settings rows**. No initial rows are copied into other stalls.

0026 follows the existing migration chain; its structural prerequisites include the 0020 location foundation and existing auth tables. Do not edit or rerun older migrations. It was executed **only in disposable in-memory fixtures** here. A separate full-schema-chain Wrangler migration rehearsal and authorized target rollout are still required; none is claimed by the native smoke fixture.

## API and permissions

Both routes remain behind the existing Worker `requireAdmin`, request-origin/JSON security and validated workspace selection. Scope is derived from authenticated memberships and the selected `X-Admin-Location-Id` / `X-Admin-Season-Id`; business is derived from that location. Query selectors and body business/location/user/role fields are rejected.

| Actor/context | GET | PATCH |
| --- | --- | --- |
| Effective Owner / Super Admin, authorized active stall/season | Full display settings, revisions, permissions and updater metadata | Allowed for the selected stall/season, with current revision(s) |
| Effective Admin, authorized stall/season | Read-only public/display settings and revisions; no management actor metadata | **403** |
| Authorized archived context | Read allowed; `canUpdate: false` | **403**, including shared-profile edits |
| Platform Admin without operational membership | No implicit stall access | No implicit stall access |
| Missing/revoked/disabled membership or disabled user | **403** after authentication | **403** |
| Unauthenticated request | **401** | **401**, subject to normal request-security checks |

The lesser season/location role applies. Global `admin_users.role` or Platform status cannot elevate an Admin location grant. The service validates current enabled membership again on reads and updates; the write transaction rechecks live user/memberships/roles and active business/location/season/association before committing.

### GET response

```json
{
  "ok": true,
  "scope": {"businessId": "authorized-business", "locationId": "authorized-stall", "seasonId": "authorized-season"},
  "profile": {
    "stallName": "Stall A", "stallLabel": "", "brandName": "Business name",
    "whatsappNumber": "", "phone": "", "locationName": "Stall A",
    "locationAddress": "", "locationDetailLines": [], "locationMapUrl": ""
  },
  "season": {"stallDates": [], "stallTimings": ""},
  "revisions": {"profile": 0, "season": 0},
  "permissions": {"canUpdate": true},
  "sources": {"profile": "location_defaults", "season": "empty_defaults"},
  "updated": {"profile": {"at": null, "byUserId": null}, "season": {"at": null, "byUserId": null}}
}
```

`updated` is omitted for Admin. `sources` identifies namespaces with saved overrides versus defaults; a saved namespace can still inherit default values for untouched/null override columns. Responses use `Cache-Control: no-store`. Normal authentication may update session metadata; the Settings GET itself writes no settings/history rows.

### PATCH request

```json
{
  "profile": {"phone": "9876543210", "locationMapUrl": "https://maps.example.test/stall-a"},
  "expectedProfileRevision": 0,
  "season": {"stallDates": ["November 6, 2026", "2026-11-07"], "stallTimings": "9 AM to 10 PM"},
  "expectedSeasonRevision": 0
}
```

Either section may be omitted. Include the corresponding expected revision for every included section. No separate workflow `If-Match`, payment operation ID or financial sync receipt is used. Names/addresses/labels are bounded strings; contacts are empty or optional `+` with 10–15 digits; maps must be credential-free HTTPS URLs; date/detail arrays are bounded and validated, with invalid calendars and duplicates rejected. Both existing English date labels and ISO dates are supported without rewriting the original configured dates. Unknown/prototype/financial/security fields and null replacement values are rejected; use explicit empty strings/arrays to clear optional fields.

The response is a fresh scoped settings response plus `changed`. Missing required revision returns **428**, malformed/unknown input **400**, stale revision **409**, unauthorized write **403**. Other methods return **405**. Missing schema returns a safe **503**. Unexpected database failures return safe JSON **503 `settings_not_confirmed`** without SQL details; refresh before retrying.

## Atomicity, conflicts and retries

One database batch lazily initializes only the selected namespace rows, inserts a guarded audit event, and applies profile/canonical-location/schedule changes with revision increments. An included stale revision or lost authority causes a database constraint failure, rolling back the entire batch. Audit failure also rolls back changes, including canonical names/addresses and lazy row creation.

Two saves from the same revision yield one winner and one explicit **409**, without silent overwrite. Different stalls have separate revisions. Unchanged saves with current revisions return `changed: false`, with no revision increment or audit event. Repeating an old successful PATCH after a lost response yields **409** and cannot append another event; callers should reload and compare. This is revision-safe retry handling, not a new durable settings-operation receipt protocol.

Audit actor/role come from validated live authority, not request input. Audit rows are immutable, and business/location consistency is checked. Settings audit does not use or mutate request history, bill finalization, purchase-cost snapshots, QR claims, payment ledger or offline receipt tables.

## Single-stall and consumer compatibility

- For the source-defined original mapping `business-diwali` / `location-diwali-2026`, the backend derives unset display/contact defaults from the **unchanged** `src/data/siteConfig.js`. Only its `season-2026` receives the original dates/hours. This is a restricted compatibility fallback, not a copy to every new stall.
- Existing non-null canonical addresses/names/labels remain authoritative. GET/default resolution does not rename or write to the original stall. The default mapping is tested on new fixtures, not discovered by opening original data.
- A single authorized stall already using location mode can use this API immediately once its schema is available. Explicit legacy season-only mode keeps existing behavior and does not infer a location; the new scoped API returns **503 `location_required`**. No runtime mode flag or existing settings consumer is changed to force adoption.
- Existing Platform setting API, static storefront/WhatsApp helpers, public catalogue routing, payment calculations and offline/QR contracts are unchanged. Existing consumers therefore continue using their current values/contracts.
- The new backend API supplies scoped settings for future consumer integration. It does **not** yet make the storefront, installed/offline app or current static helpers consume saved overrides. No public settings endpoint, frontend editor, navigation, offline settings-edit protocol or prepared-settings cache was added. That integration remains a distinct acceptance gap.

## Focused tests and evidence

Commands used direct Node test entrypoints; no npm migration lifecycle hook was invoked:

```text
node --test --test-concurrency=1 server/tests/adminStallSettings.test.js server/tests/adminStallSettingsRuntime.test.js
node --test --test-concurrency=1 server/tests/adminStallSettings.test.js server/tests/adminPlatformPublicCatalogue.test.js server/tests/publicCatalogueLocation.test.js
node --test --test-concurrency=1 --test-name-pattern="migration preserves existing locations" server/tests/adminStallSettings.test.js
```

| Evidence selection | Result / precise scope |
| --- | --- |
| New `adminStallSettings.test.js` | **17 PASS**: default independence/no settings writes; Owner/Super Admin updates; Admin projection/denial; foreign/removed/disabled/Platform authority; same-user different roles; seasons/archive policy; original defaults/clearing; validation/scope injection; no-op/stale retries; concurrent saves; commit-time demotion; audit rollback/immutability; stale captured-context revocation; missing-schema/legacy handling; migration preservation/FKs/business audit guard; unauthenticated Worker boundary. |
| New `adminStallSettingsRuntime.test.js` | **1 PASS**: real bundled Worker, password login/cookies, native workerd/D1 schema/constraints, scoped GET/PATCH, A/B isolation, Admin/foreign denial, stale revision, atomic audit-failure rollback, unchanged Platform value and empty FK check. Runtime disposed afterward. |
| Existing `adminPlatformPublicCatalogue.test.js` | **6 PASS**; unchanged global setting API/authorization/validation. |
| Existing `publicCatalogueLocation.test.js` | **14 PASS**; unchanged trusted public scope, legacy mode, cache identity and error behavior. |
| Final migration-constraint extension | **1 PASS / 16 filtered skips** for the already-listed migration case; adds direct forged-business audit rejection. This is not another distinct test to add to the totals. |
| Focused lint on changed JS/test files | Exit 0; one warning on the unchanged existing unused `ctx` parameter in Worker index. No diagnostics on new code. |

**38 distinct selected tests pass** (18 new, 20 existing). The initial combined unit/public run was 37/37; the final affected settings/native run was 18/18. These overlapping runs are not summed. After extending only the migration constraint assertion, reran only that case; completed unrelated checks were retained.

The native fixture uses fresh nonpersistent Miniflare D1, compatibility date `2026-05-01`, the actual Worker bundle and schema from the existing **new in-memory test helper** (real early migrations plus a minimal location model). It does not access an existing database or establish a full 0020–0026 migration-chain/deployed parity result.

Initial sandbox child-process execution was denied (`EPERM`); approved retries ran the same in-memory tests. One legacy-mode test initially attempted to change a binding already fixed to location mode; corrected the fixture to use a separate legacy binding, without relaxing the application's mode guard. The first native injected-failure check exposed an unhandled database error response in the new route; added a generic safe JSON 503 and reran the affected tests successfully. No failed attempt is counted as a passing execution.

## Changed files and remaining work

| File | Change |
| --- | --- |
| [0026_stall_settings.sql](../server/database/migrations/0026_stall_settings.sql) | Prepared additive persistence/audit migration. |
| [stallSettingsValidation.js](../server/src/lib/stallSettingsValidation.js) | Strict typed section/field/revision validation. |
| [adminStallSettings service](../server/src/services/adminStallSettings.js) | Scoped defaults, fresh authority, revisioned atomic saves and audit. |
| [adminStallSettings route](../server/src/routes/adminStallSettings.js) | GET/PATCH, guards, safe responses and no-store. |
| [Worker index](../server/src/index.js) | Register the new authenticated settings route. |
| [adminStallSettings.test.js](../server/tests/adminStallSettings.test.js) | Focused backend/schema/compatibility tests. |
| [adminStallSettingsRuntime.test.js](../server/tests/adminStallSettingsRuntime.test.js) | Fresh native Worker/D1 smoke test. |
| This report | Field classification, contract, migration and evidence. |

Remaining gaps: full-chain disposable D1 migration rehearsal and coordinated schema rollout; frontend editor/permissions/navigation; scoped storefront/public-display and offline-preparation consumer integration; actual device testing and deployed runtime parity. No existing historical profile snapshots are invented. No broader Reports feature, settings-history browsing endpoint, ownership/lifecycle control or financial setting is included.

**Backend foundation verdict: PASS within the tested local scope.** Migration 0026 is prepared and tested only on disposable fixtures. Complete Stall Settings release acceptance remains open until UI/consumer integration and the remaining environment checks are performed; no pending acceptance row in an earlier report has been promoted to PASS.
