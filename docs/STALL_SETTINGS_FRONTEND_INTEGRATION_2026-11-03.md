# Stall Settings Frontend & Consumer Integration — 3 November 2026

**Implemented and verified the authenticated workspace integration.** The new Stall Settings page uses the existing scoped GET/PATCH API. Owner/Super Admin can edit; Admin can read only. Successful saves refresh selected-stall workspace consumers, with explicit loading/error/conflict handling and scope-safe state.

Read the [approved gap analysis](REPORTS_SETTINGS_GAP_ANALYSIS_2026-11-03.md) and [backend implementation report](STALL_SETTINGS_BACKEND_IMPLEMENTATION_2026-11-03.md). The user explicitly selected **“Workspace consumers only; keep existing public defaults.”** Public storefront configuration therefore remains unchanged; no public settings endpoint or new setting was introduced.

No migrations, deployment, Git commands, backend schema/API changes, dependency changes or original local/production database access occurred. Existing reports remain unchanged. Browser writes occurred only in a fresh copy of an already-migrated disposable fixture; its source and protected financial data were verified unchanged.

## Page, API and scope behavior

- Added `/admin/settings` to the existing operational route allowlist, route guard and location-mode navigation. It requires an authorized readable workspace, including for direct URLs. Super Admin does not pass through the Owner-only `/admin/business` gate to use it. Platform status alone does not grant access.
- Reused the existing `admin-page`, `admin-panel`, `admin-field`, input, fieldset, state-message and Button patterns. The page displays the selected stall/season and explains that profile details apply across seasons while dates/hours apply to the selected season.
- Exposes exactly the existing backend fields: stall name/label, brand, WhatsApp, phone, venue name/address/detail lines/map URL, dates and opening hours. No financial, ownership, Platform or security controls were added.
- The API adapter uses the existing request client, confirmed location/season headers and session credentials. It validates returned business/location/season, complete field types, revisions and server permission before allowing a response to populate state.
- Settings live only in a shared **current-scope memory store**. There is no localStorage/IndexedDB/settings cache or settings outbox. Switching user, stall, season, role/capabilities or authorization state invalidates settings. The provider hides an old scope during rendering, before its effects finish processing a switch.
- Late GET or PATCH responses from an old scope are ignored. The existing API generation check and the settings store's request generation both apply. Scope is captured at request dispatch: an already-dispatched authorized A save can complete for A, but its response cannot populate B or change B's form/consumers.
- Forms submit only changed allowlisted fields and the corresponding backend `expectedProfileRevision` / `expectedSeasonRevision`. Existing English date labels are preserved; array fields use one entry per line. Empty strings/arrays clear optional values. No financial `If-Match` or payment/QR operation ID is introduced.

## Permissions and save/error handling

| Situation | Frontend behavior | Authority boundary |
| --- | --- | --- |
| Authorized Owner/Super Admin, active context, server `canUpdate: true` | Editable form and Save action | PATCH still undergoes the existing backend role/membership/revision checks. |
| Admin or server `canUpdate: false` | Visible read-only fields, no usable Save action | Forced direct Admin PATCH was tested against the actual Worker and returned **403**. |
| Archived/otherwise read-only context | Server permission and effective role disable editing | Existing backend writable-context guard remains authoritative. Archived UI behavior follows the same permission contract; no new archive feature is added. |
| Loading or switching | Old settings/contact link hidden; loading state shown | No fallback to another stall or to original global contacts in location mode. |
| GET error | Clear API error and Retry; no stale settings form/contact consumer | A successful fresh GET is required to restore the selected scope. |
| Validation failure | Server message displayed; edits retained for correction | Backend validation remains authoritative. |
| Revision conflict | Explicit conflict message, local values retained, resubmission paused | No automatic merge, overwrite or retry with a newer revision. |
| Explicit reload after conflict | “Reload settings and discard edits” fetches current server values | Discarding unsaved edits is an explicit labelled user action. |
| Lost/failed save response or changed authorization | Edits retained, saving paused, reload required to confirm state | No blind repeated transaction. Lost committed-response recovery added exactly one audit event. |
| Successful save | Shared settings replaced with confirmed response, success message, form baseline/revisions reset | Session metadata refresh updates canonical stall labels and authorized workspace listings. |

UI restrictions are additional presentation safeguards, not authorization. The new page does not alter any backend guard. Admin bypass testing uses the real server rather than treating a hidden button as proof of protection.

## Workspace consumer integration

| Consumer | Integration |
| --- | --- |
| Workspace header brand | Uses the confirmed selected profile's brand, retaining the existing “Diwali Billing” header when the selected brand is empty or unavailable. |
| Active stall selector / selected-context label | Uses the confirmed selected stall name immediately; session refresh updates canonical names in the wider authorized-location list. Other stalls' labels are not replaced. |
| Owner/workspace location cards | Selected-location label reflects the saved stall name; other authorized locations retain their own metadata. |
| Selected stall details on the workspace page | Displays scoped venue, address, detail lines, phone link, optional map link, dates and hours from the shared provider. |
| Workspace floating WhatsApp link | Uses only the selected stall's WhatsApp value. Loading/error/empty-contact states hide it instead of falling back to the original stall number. |
| Public/legacy floating WhatsApp and static consumers | Existing no-override behavior remains unchanged. The optional link override is supplied only by the operational workspace. |

The shared provider is inside the operational Admin layout. Public storefront, Platform layout and the existing offline billing route do not acquire authenticated workspace settings state. The storefront continues using its original `siteConfig`, as requested. Billing amounts, quotations, payments, reports, QR payloads and offline prepared snapshots were not changed or rewritten.

## Backward compatibility

- A single authorized stall in location mode loads defaults through the existing backend resolver. Browser testing of `business-diwali` / `location-diwali-2026` / `season-2026` confirmed the original phone and date-label defaults without saving an override to that stall.
- New stalls do not inherit original contact data. Missing settings or an empty selected WhatsApp number never causes a global contact fallback in the operational workspace.
- Explicit legacy season-only mode retains existing navigation, static configuration and consumers. A direct Settings visit explains that editing requires the authorized location workspace; it does not issue an unsupported scoped request or change the mode flag.
- The public location page still uses the original public WhatsApp/default configuration even after workspace settings are changed. No selected Admin context is propagated to anonymous public consumers.
- Offline settings editing and automatic persisted-settings preparation were not introduced. This is an online, server-confirmed workspace feature; existing offline billing/QR behavior is preserved.

## Focused verification

### API, state and compatibility tests

```text
node --test --test-concurrency=1 src/admin/api/adminStallSettings.test.js src/admin/lib/stallSettings.test.js src/admin/lib/adminNavigation.test.js src/admin/lib/adminWorkspaceAccess.test.js src/utils/whatsapp.test.js
```

**38 PASS, 0 FAIL, 0 skipped/cancelled.** This includes **19 new API/state/integration-policy tests** and **19 existing navigation/route/public WhatsApp tests**.

New tests verify confirmed request headers/credentials, minimal revisioned PATCH, stale A responses after B selection, rejected foreign/malformed payloads, preserved read-only/default values, explicit server errors, loading/legacy/network behavior, form-to-API field/array conversion, clearing values, selected-only WhatsApp links, synchronous scope clearing, consumer refresh, ignored late save acknowledgements, conflict basis preservation and explicit reload, Admin save denial, invalidation/logout, unchanged static configuration and readable-route versus Platform-only access.

These tests use mocked network responses and the actual frontend API/store helpers. They do not claim DOM/browser execution; real browser checks are separately recorded below.

### Real browser + Worker/D1 integration

Private run directory:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79\settings-ui-ac7f6ffb
```

Used a new D1 binding/persistence directory restored from the **already-migrated isolated chain fixture**. No migration was applied. Built the current frontend to that private directory with environment-file loading disabled and same-origin API resolution enforced; the actual current Worker ran locally through Miniflare/workerd. Normal password authentication, cookies, Origin checks and backend settings permissions remained enabled.

Four independent headless desktop Chrome profiles represented Owner, Super Admin, Admin and Owner B. Debug ports were allocated dynamically and profile ownership verified; nonlocal browser requests were blocked. No personal browser profile or original database was used.

| Test | Status | Evidence / observation |
| --- | --- | --- |
| UI-01 — Owner save and consumer refresh | **PASS** | Actual form changes profile and schedule; Save confirms success. Header brand, active-stall selector, WhatsApp destination and workspace venue/address/schedule show confirmed A values. |
| UI-02 — Admin and Stall B isolation | **PASS** | Admin inputs are read-only, no usable Save action, forced same-origin direct PATCH **403**. Owner B saves an independent phone; A remains unchanged. |
| UI-03 — Super Admin / Owner conflict | **PASS** | Super Admin saves a current revision. Owner's older form receives visible conflict, retaining its local phone value. Explicit reload displays the Super Admin value; no silent overwrite. |
| UI-04 — Unsaved scope switch and delayed response | **PASS** | Held A GET response released after B loads does not replace B fields. Owner's lower B grant remains read-only. Unsaved A values are discarded on switch and never populate B. |
| UI-05 — Load/save failure recovery | **PASS** | Failed GET hides the contact consumer and shows Retry. Simulated lost successful PATCH response pauses saving; explicit reload confirms persisted value with exactly **one** new audit event. |
| UI-06 — Original defaults / public compatibility | **PASS** | Original stall phone and date labels load correctly. Navigating to the public location page retains the original public WhatsApp destination rather than the edited workspace value. |

All six final browser scenarios pass. Verified final profiles record **zero uncaught JavaScript exceptions**. Earlier completed UI-01/02 evidence was checkpointed and retained when resuming unfinished scenarios; completed business scenarios were not replayed merely for inspection.

### Build, data preservation and limitations

- Temporary frontend build: **PASS**. Existing Vite chunk-size advisory warning (>500 kB) was reported; no unrelated code-splitting change was made.
- Focused lint: exit 0. Warnings: two provider/hook Fast Refresh export-convention warnings, plus a test-harness unused-expression style warning. No error diagnostics.
- Read-only preservation: **PASS**. The source chain fixture is unchanged; test-copy schema and migration history are unchanged. Exact table fingerprints match before/after for requests/items, quotations/items, payment accounts/ledger, workflow events, historical cost snapshots, offline receipts, QR claims and Platform settings. SQLite integrity **ok**, FK violations **0**.
- Existing billing/reporting phases were not repeated; those protected tables were unchanged and no financial workflow implementation was edited.
- Physical Android, optical camera/device behavior and deployed-runtime/HTTPS parity remain **NOT TESTED**. Browser evidence is desktop/local only. No production deployment/configuration was inspected.
- The workspace fixture does not configure a trusted public-catalogue routing tuple; its public catalogue requests return safe 503 responses. UI-06 verifies static public contact/default compatibility, not a new public product-catalogue acceptance run.

## Evidence and changed files

Private artifacts under the run directory: `browser-results.json` (six named PASS cases), `http-trace.json` (sanitized scope/method/status/fault trace), `browser-console.json`, `browser-attempt-*.json` and `startup-or-run-diagnostic-*.json`, `preservation.json`, `source-before.json`, `inputs-and-summary.json`, the temporary `frontend-dist`, browser profiles and disposable `persist` directory. Credentials/source fixture state remain private in `state.json`.

The unit-test count in `inputs-and-summary.json` is a transcription of the direct Node TAP execution result, not a raw TAP file. Existing reports were checked for unchanged SHA-256 hashes.

| Files | Change |
| --- | --- |
| [adminStallSettings API](../src/admin/api/adminStallSettings.js), [API tests](../src/admin/api/adminStallSettings.test.js) | Existing scoped GET/PATCH adapter, response validation and boundary tests. |
| [stallSettings model](../src/admin/lib/stallSettings.js), [model tests](../src/admin/lib/stallSettings.test.js) | Minimal form payloads, selected-contact link, current-scope memory store, generations/errors/conflicts and focused tests. |
| [AdminStallSettingsContext](../src/admin/context/AdminStallSettingsContext.jsx) | Shared scoped provider and immediate stale-scope render guard. |
| [AdminStallSettingsPage](../src/admin/pages/AdminStallSettingsPage.jsx) | Role-aware editor/read-only page and explicit save/reload/conflict states. |
| [AdminLayout](../src/admin/components/AdminLayout.jsx), [AdminRoutes](../src/admin/AdminRoutes.jsx), [route access](../src/admin/lib/adminWorkspaceAccess.js), [navigation](../src/admin/lib/adminNavigation.js) | Operational provider, Settings route and scoped navigation. |
| [AdminWorkspaceShell](../src/admin/components/AdminWorkspaceShell.jsx), [AdminSeasonSelector](../src/admin/components/AdminSeasonSelector.jsx), [AdminWorkspacePage](../src/admin/pages/AdminWorkspacePage.jsx) | Selected brand/name/contact/schedule consumers and Settings icon. |
| [FloatingWhatsAppButton](../src/components/FloatingWhatsAppButton.jsx) | Optional scoped URL override; existing public/default call contract preserved. |
| [Frontend rehearsal harness](../server/scripts/stall-settings-frontend-rehearsal.mjs), [fixture preservation helper](../server/scripts/stall-settings-frontend-db.py) | Local-only temporary build, pre-migrated fixture copy, four-profile browser cases and read-only data checks. |
| This report | Integration scope, evidence and remaining boundaries. |

Harness diagnostics were retained: sandbox child-process denial required an approved retry; the test proxy needed decoded-compression and separate Set-Cookie forwarding; full-page navigation initially cleared the existing in-memory workspace selection, so the harness now follows application links after selection. A competing profile initially held an old revision and correctly conflicted; refreshed it before creating the intended competing update. None of these corrections relaxed application guards or changed backend/schema behavior.

## Verdict and remaining scope

**PASS for the requested authenticated workspace Settings frontend and consumer integration.** Owner/Super Admin editing, Admin read-only access, selected-scope loading, save/error/conflict recovery, consumer refresh and backward compatibility have focused automated and real browser evidence.

Public storefront settings integration remains excluded by the user's explicit choice; public defaults stay unchanged. Offline Settings editing/prepared-settings persistence, deployed-runtime parity and physical Android acceptance were not added or marked passed. Standalone Reports and other release gates retain their existing dispositions; no earlier acceptance report was rewritten.
