# Phase 7 — Security & Regression acceptance

**Verdict: PASS for the isolated local security/regression scope.** Both current registry dependency audits report **zero vulnerabilities**. All six selected regression groups pass, with **zero failed, cancelled, skipped or TODO tests**. Known signing-secret/credential exposure checks and exact isolated-database preservation pass. No security blocker was reproduced, so no dependency, application or configuration change was needed.

This is **not final release approval**. Physical Android acceptance remains NOT TESTED, as recorded in Phase 6; production/runtime/HTTPS parity and earlier feature-acceptance decisions remain outstanding. These limits are listed separately rather than presented as passing device/deployment tests.

## Inputs, environment and safety

Reviewed [release fixes](RELEASE_BLOCKER_FIXES_2026-11-03.md), [server-tooling remediation](SERVER_TOOLING_SECURITY_2026-11-03.md), [Multi-Stall](MULTI_STALL_ACCEPTANCE_2026-11-03.md), [roles/seasons/isolation](ROLES_SEASONS_ISOLATION_ACCEPTANCE_2026-11-03.md), [billing/payment](BILLING_PAYMENT_ACCEPTANCE_2026-11-03.md), [four-Admin concurrency](FOUR_ADMIN_CONCURRENCY_ACCEPTANCE_2026-11-03.md), and [offline QR/Family Pack acceptance](OFFLINE_QR_FAMILY_PACK_ACCEPTANCE_2026-11-03.md), together with current package scripts, scoped overrides, session cookies, server signing preparation and test helpers.

Established isolated root, abbreviated `RUN`:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

New evidence directory, abbreviated `P7`: `RUN/p7-dfaffcaf`.

- Existing isolated Worker remains at `http://localhost:8793`; existing frontend build is `RUN/frontend-dist`. No browser workflow or business fixture preparation was repeated.
- Node **20.20.0**, Windows x64; Wrangler **4.85.0**, Miniflare **4.20260424.0**, workerd **1.20260424.1**.
- Registry access was limited to npm dependency/advisory metadata. No deployed application, production account/configuration or production database was accessed.
- All database regression fixtures use mocks, fake IndexedDB or SQLite **`:memory:`**. Existing workflow test helpers construct throwaway in-memory schemas from SQL fixture/migration files; no migration runner or schema change touched an existing database.
- Tooling compatibility tests use Miniflare with persistence disabled and **no D1 binding**, bundling the actual Worker in memory (`write: false`). Its HTTP/WebSocket/image operations are local.
- The existing server default/integration lifecycle was not invoked: its `pretest` hooks apply migrations to the normal local binding. Instead, explicit safe Node test-file lists were used.
- A read-only snapshot of only the manifest-verified disposable D1 was taken before testing. Original database paths were never opened. No Git commands, deployment, new application feature or broad rewrite occurred.

## Requested verification matrix

| # | Verification | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Root and separate server/tooling audits remain clean | **PASS** | New `root-audit.json` and `server-audit.json`: both registry audits exit 0, zero info/low/moderate/high/critical/total vulnerabilities. Both complete installed dependency trees also exit 0. Audits include development dependencies. |
| 2 | Vite and previously patched advisories remain resolved | **PASS** | New `patched-versions.json`, both clean audits and installed trees. Vite 8.3.3 and bundled launch-editor/middleware 2.14.2 verified; exact server override versions remain installed. `inputs-before.json` / `inputs-after.json` confirm both package manifests and lockfiles unchanged. |
| 3 | Server signing secrets and sensitive credentials are not exposed to clients | **PASS — tested isolated boundaries** | New `secret-boundaries.json`: 781 source/public/build files, 22 known isolated signing/fixture credential values, two actual captured QR envelopes, zero findings. `public-root-material.json`: actual authenticated preparation roots have only `kty/crv/x/y`, no private fields. Fresh QR/key/cookie/cache regressions pass. Scope and intentional device-key storage are clarified below. |
| 4 | Backend stall/season/membership/role authorization | **PASS** | New 420-test scope group plus backend/offline/billing groups: validated operational context, membership and lesser-role enforcement, revoked sender/device checks, platform separation and transactional authority revalidation. Six new actual-Worker HTTP probes also reject missing authentication, forged role/user/context headers and unsafe-origin mutation. Prior authenticated real-D1 role evidence from Phases 3–6 retained. |
| 5 | Admin cannot read Owner purchase/cost/profit/margin data | **PASS** | New catalogue/rate/quotation scope tests, billing redaction tests and recursive history-redaction cases pass. Named billing test: `Admin cannot record payments or hold; summaries and history never expose purchase/profit details`. Positive privileged pricing and lower effective-role cases remain covered. Retained Phase 6 actual Admin responses/preparation/QR are redacted while Owner preparation contains private rows. |
| 6 | Cross-stall/cross-season API requests rejected | **PASS** | New scope and payment/offline groups exercise foreign IDs, operating seasons, catalogue/rate/quotation/request boundaries and current memberships. Billing test `another authorized operating season cannot read or pay a previous season request` passes. Retained Phase 4/5 actual dual-membership foreign-ID probes returned 404/409; no authenticated live fixture writes were repeated here. |
| 7 | Payment/finalization/QR/sync idempotency | **PASS** | New 138-test billing/QR/Family Pack/atomic checkout suite and offline suite: concurrent/replayed checkout/payment/claim operations, lost acknowledgements, unique keys, revision conflicts, atomic rollback and one winning closure. Both fixed legacy and location modes pass. Retained Phase 5/6 real Worker receipts/claims/payment evidence provides end-to-end confirmation. |
| 8 | Offline conflicts, session expiry and authorization regressions | **PASS** | New offline 37/37 and backend authentication/session tests pass. Named cases include expired authentication rejected before mutation, captured role never granting privileges, permission/device changes during commit rolling back, and conflict chains retaining both versions while independent drafts proceed. Retained Phase 6 real expired-session row probe is 401, fresh password session 200. |
| 9 | Existing focused backend/scope/billing/QR/Family Pack/offline/tooling suites | **PASS** | All six groups below completed successfully, including focused frontend boundary tests. Exact argument/file lists, exit codes and TAP logs recorded under `P7`; no migration lifecycle hook used. |
| 10 | Skips, environment limitations and runtime-parity gaps reported | **PASS — reporting requirement** | Zero runtime skips in selected suites. Excluded entrypoints/files, memory-fixture limitations, known-value scan scope, Android and production-parity NOT TESTED items are explicitly listed below. |

The matrix covers the requested isolated checks; it does not imply a complete production penetration test or exhaustive inventory of unknown deployment secrets. [Machine-readable results](SECURITY_REGRESSION_ACCEPTANCE_2026-11-03.json) record the same dispositions and artifact references.

## Fresh dependency audits and patch versions

For both repository root and `server/`:

```text
npm audit --json --offline=false --prefer-online --ignore-scripts
npm ls --all --json
```

Executed the installed npm CLI through Node, with the respective working directory, and retained full JSON/stdout/stderr/exit codes. Explicit online flags prevent a cached/offline-only empty audit from being mistaken for remediation. No audit omission/ignore or severity threshold was used. No install, `npm audit fix`, `npm audit fix --force`, dependency removal or lockfile regeneration ran.

| Component | Verified installed version | Status |
| --- | --- | --- |
| Root Vite | 8.3.3 | PASS; clean root audit |
| Vite bundled launch-editor / launch-editor-middleware | 2.14.2 / 2.14.2 | PASS; inspected actual Vite Node bundle markers |
| Wrangler | 4.85.0 | PASS; unchanged toolchain parent, clean server audit |
| Miniflare / workerd | 4.20260424.0 / 1.20260424.1 | PASS; unchanged runtime versions |
| Server esbuild override | 0.28.1 | PASS |
| Server sharp override | 0.35.5 | PASS |
| Server undici override | 7.30.1 | PASS |
| Server ws override | 8.21.0 | PASS |

Both audits report total **0** across all severities. Exact scoped overrides still match the prior reviewed remediation. The manifest/lockfile hashes before and after this phase are identical. No dependency fix was required.

## Fresh regression execution

| Group | Selection | PASS | FAIL | Skipped / cancelled / TODO |
| --- | --- | --- | --- | --- |
| Backend | Explicit file list from safe `server` `test:unit` script | 286 | 0 | 0 / 0 / 0 |
| Scope | 30 location/season/platform files; same selection as prior 420 baseline | 420 | 0 | 0 / 0 / 0 |
| Billing/payment/QR/Family Pack/checkout | Existing root `test:handover` file list | 138 | 0 | 0 / 0 / 0 |
| Offline | Existing root `test:offline` file list | 37 | 0 | 0 / 0 / 0 |
| Tooling compatibility | `server/tests/serverToolingCompatibility.test.js` | 3 | 0 | 0 / 0 / 0 |
| Focused frontend boundaries | Six API/session/location/role/billing/private-summary files | 49 | 0 | 0 / 0 / 0 |

All six child-process exit codes are 0 and their stderr logs are empty. Counts describe the selected groups; do not treat their sum or prior-phase totals as a deduplicated project-wide test inventory.

The runner expands existing script test-file lists into direct `node --test --test-concurrency=1 ...` commands. `suite-plan.json` and each `*-result.json` record the full files/arguments and working directory. No `npm --prefix server test`, integration lifecycle or migration pretest is invoked.

Representative freshly passing cases:

- `legacy retries, lost commit acknowledgement and concurrent submissions retain one transaction`.
- `handover retry is a no-op and stale Admin edits cannot overwrite recipient changes`.
- `tampered QR, cross-stall, unauthorized recipient, revoked sender and missing signing configuration fail closed`.
- `revoking the sender between verification and commit atomically rolls back request, claim and receipt`.
- `Admin-created Family Pack request syncs with stable variant/composition/line snapshots and accepts QR idempotently`.
- `revision conflicts, concurrent payments and lost acknowledgements cannot duplicate or overpay`.
- `user, device, revoked membership and cross-stall scopes are revalidated on every retry`.
- `permission/device changes during a write transaction roll back business changes and receipt together`.
- `fresh lesser authority denies closure and payment after an Owner location role becomes Admin`.
- `expired authentication is rejected by the Worker before any offline mutation or acknowledgement`.
- `reported offline role is retained separately and never authorizes a privileged operation`.
- `partial sync acknowledges successful operations and independent drafts while blocking a conflicting chain`.

Tooling tests freshly bundle the actual Worker with patched esbuild, make repeated local health requests through patched undici/workerd, perform a real local WebSocket upgrade/message/close using patched ws, and exercise patched sharp through Miniflare image info/resize/PNG/JPEG/WebP/AVIF output. Persistence is disabled, with no D1 binding or production configuration.

## Secret and credential boundary verification

The known isolated server root signing private JWK is read only from `RUN/.dev.vars` for comparison; neither its value nor matching source lines are printed or copied into evidence. Original `.env`/credential files and production/account secrets were not read.

The fresh scan covers `src/`, `public/`, current `dist/` and `RUN/frontend-dist`, plus the actual normal/mixed QR envelopes captured during Phase 6. It checks the known isolated root private scalar/JWK, available isolated fixture passwords/cookies/device-token values, and high-confidence private-key PEM/AWS-access-key/npm-token literal patterns. **781 files, 22 known values, two QR envelopes, zero findings.** Actual preparation roots independently expose only public curve coordinates. Current server source obtains the root key from server environment and returns public root/certified public device keys.

The fresh regression `sender generation reuses transfer identity and non-extractable key across restart, excludes private fields` confirms the distinct **device** signing key is intentionally browser-held and non-exportable. QR payloads/certificates do not contain its private material or device token. Session-cookie tests cover HttpOnly/security/origin behavior; offline-shell tests prevent API/auth responses and cookies entering shared static caches.

“Server-side only” applies to the **server root signing key and server/deployment credentials**, not every local device secret. Device keys/tokens intentionally live in scoped browser storage, and a prepared Owner's private financial snapshot intentionally lives in their trusted profile. Those are not shared static assets or Admin data. This phase does not claim hardware-backed encryption, prevention of compromise of an unlocked trusted profile, or proof about unknown production credentials.

## Actual isolated HTTP smoke and retained end-to-end evidence

New `local-http-security.json` records six passing probes against the existing Worker:

| Probe | Observed status |
| --- | --- |
| Local `/health` | 200 |
| Forged Owner/user headers without authenticated session | 401 |
| Forged stall/season headers without authenticated session | 401 |
| Platform route without session | 401 |
| Offline sync without session | 401 |
| Unsafe-origin offline mutation | 403 |

No valid session was used and no login/fixture was created. Write-method probes carried empty payloads and were rejected before business mutation. Authenticated operational behavior is freshly exercised in the isolated test fixtures above, while previous real-D1/browser evidence remains retained: Phase 3 effective roles/removal/revalidation, Phase 4 payment/billing/idempotency, Phase 5 concurrent receipts/claims/conflicts, and Phase 6 actual prepared QR, session TTL and two-variant Family Pack reconciliation. Those mutation-heavy acceptance workflows were not repeated against the saved business baseline.

## Baseline and file preservation

The final read-only verification compares **every row**, not just a before-row subset:

- **36 tables / 3,486 total rows unchanged**, including SQLite/Cloudflare internal metadata/counters.
- Of these, **34 business/auth/migration tables / 3,476 rows** are unchanged. No added, missing or modified row in any table.
- Schema and all migration records identical; SQLite integrity `ok`; zero foreign-key violations.
- Both root/server package manifests and both lockfiles have identical before/after SHA-256 hashes.
- No dependency or application fix, new fixture, business mutation, migration or deployment was made in Phase 7.

The checker opens only `P7/before.sqlite` and the manifest-verified disposable database, both read-only. It never opens the original local databases. An intermediate preservation check also passed before the six HTTP probes; the final check passed afterward.

## Skips, exclusions and NOT TESTED boundaries

There are **zero skipped tests inside the selected executed suites**. These explicit exclusions are not concealed as successful executions:

- `auditLocationCompatibility.test.js`: separate historical implementation/database-audit suite, excluded from the focused 420-test scope baseline. Not executed in this phase.
- `adminFamilyPackLocation.test.js`, `adminFamilyPackSeason.test.js`, `publicFamilyPackSeason.test.js`: excluded from the scope selection to avoid duplication; all three **executed in the billing/QR group**.
- Server default/integration entrypoints, on-disk D1 catalogue imports, migrations and migration-pretest suites: **not run**, because their normal lifecycle targets existing local persistence. Relevant business behavior is covered by the selected mocks/in-memory regressions and retained real-disposable-D1 acceptance.
- Full browser/PWA/concurrency/QR-camera acceptance phases and a new production frontend build: not repeated. The existing isolated build was scanned; actual Worker bundling was freshly tested in memory.

| Unverified boundary | Status | Impact |
| --- | --- | --- |
| Physical Android installation, optical QR scanning, camera permissions, device reboot/storage and real mobile network | **NOT TESTED** | Phase 6 remains incomplete for device sign-off; synthetic desktop camera results do not replace it. |
| Actual deployed Cloudflare runtime / production HTTPS, proxy, cookie, CORS and routing parity | **NOT TESTED** | Current tooling uses Node 20.20.0/Windows and workerd 1.20260424.1 with compatibility date `2026-05-01`; isolated results do not establish deployed parity. No production configuration/access was used. |
| Complete inventory of unknown production/account secrets and runtime exposure | **NOT TESTED** | Known isolated-value and public-artifact tests pass; production secret inspection is prohibited and was not inferred from those results. |

The patched server dependency overrides remain a tested project combination rather than an upstream Wrangler upgrade. Compatibility is freshly verified on the installed local platform. Registry audit results reflect the advisory metadata returned during this phase; they are not a guarantee against undisclosed vulnerabilities.

Earlier missing standalone reports/settings and related feature-acceptance decisions retain their prior dispositions; no missing feature was implemented here.

## Evidence and changed files

Private `P7` artifacts:

- `before.sqlite`, `inputs-before.json`, `inputs-after.json`: exact database snapshot and manifest/lockfile hashes.
- `root-audit.json`, `server-audit.json`, `root-tree.json`, `server-tree.json`, corresponding `*-result.json`, stdout/stderr logs: fresh full audit/tree results and exit codes.
- `patched-versions.json`: actual installed versions, Vite bundle markers and scoped overrides.
- `suite-plan.json`; `backend`, `scope`, `billing`, `offline`, `tooling`, `frontend` `*.stdout.log`, `*.stderr.log`, `*-result.json`: full current command/file lists, TAP, timing and counts.
- `secret-boundaries.json`, `public-root-material.json`: redacted known-value/public-root checks. No secret values or matched content are stored.
- `local-http-security.json`: six actual local-Worker results without valid credentials/business mutations.
- `preservation-1793712446139883000.json`: final exact baseline/integrity check after HTTP probes. Intermediate `preservation-1793712270190692400.json` retained.

Added acceptance tooling only: `server/scripts/security-regression-run.mjs`, `security-regression-secrets.mjs`, `security-regression-http.mjs`, `security-regression-db.py`. Focused lint of the three JavaScript tools passes without diagnostics. This report and its machine-readable matrix are added; existing package/lockfiles/runtime/UI remain unchanged.

**Phase 7 passes its isolated security/regression checks with no remaining reproduced blocker. Final Diwali 2026 release approval remains withheld pending Android/device acceptance, runtime/deployment parity and the earlier feature-acceptance decisions.**
