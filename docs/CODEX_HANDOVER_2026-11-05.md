# Codex handover — 5 November 2026

## Scope and workspace

- Project: `C:\naidu\Diwali`, Windows/PowerShell, Asia/Calcutta. Continue with
  **localhost + Local D1 only**. No production access, remote D1, deployment,
  resets, account/permission changes or broad manual E2E without a new request.
- Working tree contains substantial modified **and untracked implementation
  files**, tests and reports. Preserve them; a Git checkout alone may omit work.
  Do not reset/clean or overwrite pre-existing changes. Application code is JS/JSX.
- This handover was assembled from code and saved evidence. No tests, server,
  migration or database verification was rerun; only this document was written.

## Architecture and setup

- React 19 + React Router 7, Vite 8, Tailwind/CSS, Lucide. Main code: `src/admin/`.
  Worker entry: `server/src/index.js`; routes/services enforce scoped D1 access.
  Wrangler 4.85, SQLite/D1 migrations in `server/database/migrations/`.
- Auth uses existing password/HttpOnly sessions; optional loopback-only development
  JWT support also exists. Operational authority intersects enabled season and
  stall memberships. Platform Admin authority is separate and grants no automatic
  operational access. `ADMIN_LOCATION_MODE=1` is required for multi-stall operation.
- Root `.env.local` configures local Vite; ignored `server/.dev.vars` supplies
  local Worker secrets. Preserve both privately; never put secrets in `VITE_*`.
  Their contents were not inspected for this handover.
- `VITE_API_BASE_URL` must be empty; `VITE_DEV_API_PROXY` must be loopback
  (`http://127.0.0.1:8787` by default). Vite proxies `/api/admin` and `/api/public`.
- Offline storage: IndexedDB `diwali-offline-billing-v1`, existing version/stores
  unchanged; profiles/catalogues/drafts/versions/outbox are isolated by
  business/stall/season/user/device. Browser keys are non-extractable. The built
  app uses `public/offline-billing-sw.js` and `scripts/pwaShellPlugin.js`.

## Completed functionality

- **Offline Phase 1:** continuous mobile POS at `/admin/offline`, tabs **New sale**,
  **Bills & sync**, **Workspace**; uninterrupted autosave typing, cart/search,
  products/Family Packs/photos, consecutive customers without repeated setup,
  prepared-stall restoration, explicit synchronization, progress and receipts.
- **Offline Phase 2:** signed pending/finalized QR handoff, Owner/Super Admin
  scanner/paste verification, provisional acceptance and dependent payments;
  scoped device grants, live server/commit-time authorization, revocation,
  multi-device reconciliation, lost-reply recovery and duplicate prevention;
  retained never-sent payment recovery; installation and verified offline reload.
- **Multi-stall:** shared logins with independent membership/roles, explicit
  season/stall selection, scoped catalogue/pricing/stock status/requests/bills/
  payments, Platform stall provisioning, last-owner protection, archived-write
  denial, context-switch isolation, reports and authenticated stall settings.
  Standalone customer directory and quantity/stock-movement ledger remain outside
  the completed scope. Historical reports saying Reports/Settings are absent are
  superseded by their final acceptance report.
- **Separate Billing Finalization:** Users-page switch defaults OFF, independent
  of read-only **Final Rate visibility**. Owner/Super Admin can grant/revoke per
  Admin/stall/season. Device preparation issues an eight-hour signed grant.
  Quick Bill success and Request Details offer **Prepare signed billing**,
  captured individual Final Prices/sum, **Save agreed amount**, and
  **Finalize bill → Confirm finalization**. Online actions reuse the same signed
  outbox/sync/receipt path; the existing POS supports offline actions.
- Latest UI fixes: visible “Final + ₹500” reference labels/comments removed from
  Quick Bill, Request Details, adjustments and offline UI; calculations retained.
  Mobile fields in Quick Bill/POS show live digit-only counts and a valid state
  at ten digits. The legacy finalize PATCH now sends `{}` with
  `Content-Type: application/json; charset=UTF-8`, preserving revision headers.

## Local D1, migrations and backups

Binding `DB`, database name `diwali-quotation`. The checked-in config contains a
deployment database ID; **always use `--local`**, never infer remote authorization.
Existing application Local D1 file:

```text
server/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/
5264016ce8a63a3f1f9239770b32628020abc7fe1141bfbdd036d824a8f8ea73.sqlite
```

The two lines above form one path. Other SQLite files exist there; do not select
another file by guesswork or copy live WAL files as a backup.

| Migration | Last recorded local result | Retained backup/evidence directory |
| --- | --- | --- |
| `0028_offline_final_price_grants.sql` | Applied; 31 commands, 27 objects; 34 prior application tables unchanged; integrity OK, zero FK violations | `server/reports/phase2-local-prerequisites-2026-11-05/` — `before-0028.sqlite`, before/after JSON, signing verification |
| `0029_billing_finalization_permissions.sql` | Applied; 17 commands, 13 objects; original columns/rows in 38 prior application tables unchanged; integrity OK, zero FK violations | `server/reports/billing-finalization-0029-local-2026-11-05/` — `before-0029.sqlite`, before/after JSON |

Last Wrangler check reported **no pending migrations**. The new permission table
had zero rows; no existing grants were automatically linked or users enabled.
Backups/evidence and `.wrangler` are ignored local artifacts; transfer securely
if changing machines. Temporary historical acceptance fixtures under AppData/Temp
are separate disposable databases, not the application Local D1.

## Signing, permissions and workflow invariants

- A local-only P-256 private JWK was generated in `server/.dev.vars` as
  `HANDOVER_SIGNING_JWK`. Grants reuse it unless `OFFLINE_GRANT_SIGNING_JWK` is
  configured. Both signing paths previously verified through Wrangler local
  bindings with remote bindings disabled. Do not print, commit, regenerate or
  rotate the root casually; preserve it and browser profiles across account moves.
- Restart the local Worker after secret changes; refresh the frontend after code
  changes. Restart Vite after `.env.local` changes. Device grant/QR preparation
  must be refreshed online; installing the app alone does not prepare it.
- Ordinary Admins save requests/items; financial actions require valid delegated
  authorization. Any **positive** agreed amount is allowed, including below
  Final Price. Amounts are editable before closure; finalized bills remain locked.
  Grants add no payment, purchase/profit, price-override or QR-acceptance authority.
- Existing independent Phase 2 Owner device grants survive migration 0029 and
  remain separate from the new Users switch; revoke them separately in Offline
  Billing. Super Admin delegation is supported through the new Users permission;
  legacy independent device-grant controls remain Owner-only.
- Audit retains permission/grantor/Admin/revoker identity, original operation IDs,
  old/new agreed amounts and closure. `ownerUserId` remains the compatible signed
  claim name for the actual grantor, including Super Admin; receipts also expose
  `grantorUserId`. Membership changes durably invalidate affected authority.
- Local saves/QR acceptance/closure/payments are **provisional** until server
  acknowledgement. Signed CREATE/EDIT/AGREEMENT/CLOSE/PAYMENT/HANDOVER chains retain
  original IDs/times and revisions. Conflicts require explicit review, not silent
  rebasing. New delegated commits need live authorization; acknowledged actions
  may replay their exact receipts after grant revocation.
- QR v1/v2 handles pending bills; v3 carries finalized source operation history.
  Source-first/recipient-first sync converges on the same bill; competing claims
  are rejected. Limits: 25 source actions, 50 lines, 64 KiB. Source payment captures
  are not transferred. Accepted bills cannot be handed over again.
- Payments remain Owner/Super Admin only and use the append-only amount ledger,
  after finalization with an agreed amount. Partial payments, holds/releases,
  reference deduplication and atomic balances are preserved. Online/Offline is
  recording mode, not an electronic payment processor.

## Exact local commands — reference only, not executed for this handover

Prerequisites: Node **20.19+ in the 20.x line or 22.12+** (last environment
20.20.0), npm, existing dependencies, existing authorized local accounts and
membership data. Fresh dependency setup, only if needed: `npm ci` at root and
`npm --prefix server ci`. Targeted browser tests require Chrome; fixture tests
use Python 3 (`py -3` on this Windows machine) and ephemeral Miniflare/Local D1.

PowerShell terminal 1 — preserve `.dev.vars`; confirm location mode and local auth:

```powershell
Set-Location C:\naidu\Diwali\server
$env:WRANGLER_SEND_METRICS='false'
node node_modules/wrangler/bin/wrangler.js dev --local --config wrangler.toml --ip 127.0.0.1 --port 8787
```

Terminal 2 — frontend:

```powershell
Set-Location C:\naidu\Diwali
npm run dev -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173/admin/login`, sign in with an existing authorized
account, select season/stall, then `/admin/offline` or the online workspace.
If the established local JWT proxy mode is in use, `npm run admin:local-jwt`
from `server/` mints its short-lived token; keep it private in root `.env.local`
as `ADMIN_LOCAL_DEV_JWT` and restart Vite. Never replace existing accounts or
enable a new authentication bypass as a setup shortcut.

Read-only migration status, if subsequently requested, from `server/`:

```powershell
node node_modules/wrangler/bin/wrangler.js d1 migrations list diwali-quotation --local --config wrangler.toml
```

For built-PWA checks later, keep the local Worker running and use root commands:

```powershell
node --input-type=module -e "process.env.VITE_API_BASE_URL = ''; const { build } = await import('vite'); await build();"
npm run preview -- --host localhost --port 5173 --strictPort
```

Stop Vite dev first to free 5173. Preview inherits the configured local API proxy;
use normal password/session login. Vite dev is insufficient for verified offline
reload. Offline operation needs retained browser storage, a prepared catalogue,
valid cached grants and verified service-worker assets. Sync needs an open page,
matching current login and connectivity; no background business synchronization.

## Recorded tests — do not add overlapping totals or rerun automatically

- Phase 2: **155 passed** (152 core + 3 browser), build passed; see Phase 2 report.
- Separate Billing Finalization: **102 distinct passed** (98 core + 4 focused
  browser), including real signatures/IDB, lost replies, revocation races, native
  Local D1 and QR/payment compatibility. Build: 2,352 modules; lint zero errors,
  six effect/cleanup warnings. These overlap earlier Phase 2 coverage.
- Finalize JSON/header fix: direct mocked-request check plus **7 targeted API
  tests passed**; revision, scope headers and credentials preserved.
- Retained multi-stall: 13 scenarios PASS, one partial; roles/isolation 12 PASS;
  four-Admin concurrency 15 scenarios PASS; Reports/Settings 17 consolidated
  cases PASS; two-stall/eight-login server/protocol check 7 Node entries PASS.
  Counts have different units/overlap; sixteen physical/browser devices were not
  qualified. See linked reports for exclusions. Nothing above was rerun here.

## Pending work and known limits

- **Unimplemented latest request:** editable pre-finalization Payment Status
  (Paid/Unpaid/Partial Paid) and Payment Mode (Online/Offline), without amounts.
  Existing status is ledger-derived, modes belong to entries, and the API requires
  finalized payment accounts and amounts. Work stopped without changes. A safe
  design needs separate metadata/API/schema and explicit semantics; do not fake
  receipts, overwrite history or weaken payment validation to add two selects.
- No outstanding reproduced application failure was reported in the completed
  targeted checks. The finalize 415 fix is implemented but was validated with
  mocked requests/API tests, not a new broad manual finalization cycle.
- Final broad manual E2E and physical Android installation/camera/multipart QR,
  cold restart, storage eviction, real network switching and crowd ergonomics
  remain deferred. No release/production parity approval is implied.
- Browser eviction/lost keys can lose never-synced, never-transferred work;
  grants are device-bound, expire, and cannot instantly learn offline revocation.
  New online views refuse bills with outstanding local actions; recover via POS.
- Existing build large-chunk warning remains (~1.17 MB main JS before gzip).
  Some Node 20 browser tests need `--experimental-websocket`; sandbox `spawn EPERM`
  previously required approved local subprocess execution, not security changes.
- The final source patch is newer than some generated build output; rebuild only
  when the next task authorizes it. Do not assume a running server/tab has picked
  up the latest source or secret. Never run `server/npm test` casually: its
  `pretest` applies migrations to the default local database.

## Start with these references

- [Phase 1 POS operations](OFFLINE_POS_OPERATIONS_2026-11-05.md)
- [Phase 2 implementation and local prerequisites](OFFLINE_BILLING_PHASE_2_2026-11-05.md)
- [Separate Billing Finalization, tests and changed files](BILLING_FINALIZATION_PERMISSION_2026-11-05.md)
- [Multi-stall acceptance](MULTI_STALL_ACCEPTANCE_2026-11-03.md)
- [Reports/Settings final acceptance](REPORTS_SETTINGS_FINAL_ACCEPTANCE_2026-11-03.md)
- [Two-stall/eight-login evidence](TWO_STALL_EIGHT_LOGIN_ACCEPTANCE_2026-11-04.md)

For implementation, follow `AdminOfflineBillingPage.jsx` / `OfflinePosWorkspace.jsx`,
`SignedBillFinalization.jsx` / `offline/signedBilling.js`, `offline/storage.js`,
`shared/offlineGrant.js` / `handoverProtocol.js`, and server services
`adminOfflineGrants.js`, `adminOfflineSync.js`, `adminHandover.js`, `adminPayments.js`.
Some older documents describe historical Owner-only delegation or unmigrated
databases; the dated 0028/0029 completion records above supersede those statements.
