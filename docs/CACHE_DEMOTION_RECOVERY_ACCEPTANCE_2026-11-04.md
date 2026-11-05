# Cache Demotion & Recovery Acceptance — 2026-11-04

**Current verdict: PASS for the fixed G07 desktop demotion/revocation lifecycle.** Both original failures were reproduced before the fix and now pass against the final local build after a full offline Chrome restart: the saved lower role persists, private pricing is absent, and the Owner financial estimate does not return. Pending work and other-stall boundaries remain preserved. Nine focused new regressions and two selected existing checks pass. Earlier static-cache loss/repair passes remain retained. Physical Android/storage-eviction acceptance remains NOT TESTED; this is not full release approval. The original G07 failures and evidence are retained below, followed by the fix evidence.

The earlier environment blocker is resolved. The user started the retained isolated services; this acceptance run did not start, restart or modify either service. The earlier report is retained privately as `E/report-before-execution.md`.

## Inspection and retained evidence

Inspected the existing implementation and saved evidence before execution:

- `public/offline-billing-sw.js`: exact public static-asset allowlist, workspace HTML publication after assets finish caching, previous shell-cache deletion on activation, navigation fallback and explicit preparation acknowledgement/error. Business records are separate in scoped IndexedDB; API/authentication traffic is excluded from static caching.
- `src/admin/offline/appShell.js`, `storageHealth.js`, `storage.js`, `synchronize.js`, `handover.js`; relevant `AdminOfflineBillingPage.jsx` and `OfflineHandover.jsx` paths: storage warnings, atomic saves, retry/restart handling, immutable operation identities, role refresh and visible recovery errors.
- Existing `appShell.test.js`, `storageHealth.test.js` and `offline.test.js` were read, not rerun.
- [Offline QR & Family Pack acceptance](OFFLINE_QR_FAMILY_PACK_ACCEPTANCE_2026-11-03.md), [security acceptance](SECURITY_REGRESSION_ACCEPTANCE_2026-11-03.md), and [gap review](FINAL_ACCEPTANCE_GAP_REVIEW_2026-11-03.md), including G07 privileged-cache demotion.

Retained raw evidence inspected: `RUN/p6-87ca4e48/browser-results-1793711104949.json` records ordinary offline Chrome restart, five preserved HANDOVER/EDIT/AGREEMENT/CLOSE/PAYMENT IDs, interrupted synchronization and lost-acknowledgement recovery. `RUN/p7-dfaffcaf/offline-result.json` records the earlier 37-test PASS. These passes were reused without repeating their suites, camera matrix, financial workflow or lost-response fault matrix.

## Verified running isolation

`RUN` is the existing private acceptance root:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

New evidence directory `E` is `RUN/cache-recovery-20261104`.

| Boundary | Observed evidence |
| --- | --- |
| Frontend | `http://localhost:5193/admin/offline` returned HTTP 200. Listener PID 17232 is Node/Vite preview with `--port 5193 --strictPort --outDir RUN/frontend-dist`. |
| Worker | Port 8793 listener PID 19780 is local `workerd.exe`, descended from Wrangler PID 11848 and launcher PID 26280. Both Wrangler command lines specify `dev --local --config RUN/wrangler.toml --persist-to RUN/persist --ip localhost --port 8793`. |
| D1 binding | The actual referenced config binds `DB` to `diwali-release-disposable`, ID `e92daf64-ea48-4b6b-ad91-229f6f079961`. No remote binding flag is configured. |
| Persistence | Manifest target exists under `RUN/persist/v3/d1/miniflare-D1DatabaseObject/10117598a2d3d609371c5086d310b837fcfaad24d6f891aa935c4987527cc6d4.sqlite`. Read-only verification resolves it beneath `RUN/persist` and rejects the original path recorded in metadata. |
| Final verification | Both listener PIDs and Wrangler arguments remained unchanged at the post-sync check. The config still identifies the same local disposable binding. `/health` returned HTTP 200 with `ok: true`. The initial `/api/health` probe returned 404; that is not the application's health route. |

Process inspection required execution outside the sandbox because `Get-NetTCPConnection` initially returned access denied. Original-database paths were read only as manifest strings, never opened. D1 verification used SQLite URI `mode=ro`, `PRAGMA query_only=ON`, and only the disposable target. Application writes were limited to the established test scope/accounts/devices, their authentication/preparation, and new acceptance requests.

## Fresh targeted results

Reused `server/scripts/offline-qr-pack-browser-client.mjs` and the retained Phase 6 Admin/Owner Chrome profiles. A temporary driver at `RUN/cache-recovery-20261104.mjs` orchestrates these checks; it adds no application or replacement service infrastructure. Browser traffic is restricted by the retained helper to the isolated frontend/Worker origins. New fixtures were one source QR request and one ordinary Owner bill, with the same queued work reused through all cache failures and retries.

| Check | Status | Evidence |
| --- | --- | --- |
| CDR-SETUP: pending bill and accepted QR | **PASS** | Real offline UI creation, signed QR export, supported complete-sequence paste/verification and explicit acceptance. Owner outbox contains one new CREATE and one HANDOVER before cache loss. Physical camera behavior was retained from prior evidence, not rerun. |
| CDR-01: partial static-cache loss | **PASS** | Deleted only cached `/manifest.webmanifest`. With HTTP cache disabled and the page offline, full reload still opens the workspace and pending bill. All six IndexedDB store snapshots compare exactly equal before/after. This partial-loss case removes a noncritical manifest; it does not claim offline usability after a required JavaScript chunk disappears. |
| CDR-02: total shell-cache loss and restart | **PASS** | Deleted only `diwali-offline-shell-*` Cache Storage caches; IndexedDB was untouched. Full Chrome process restart with offline navigation cannot load the shell, as expected. After reconnecting to load the public shell, drafts/outbox/versions plus catalogue/meta records match the pre-loss snapshots. Pending bill and signed-transfer identity survive. |
| CDR-03: failed repair is explicit and preserves work | **PASS** | Browser service-worker-target interception returns controlled HTTP 503 for static assets, leaving API/authentication available. Actual cache protocol returns `ok: false`. Actual UI preparation displays: “Draft storage is ready, but offline page reload is not confirmed: Static asset unavailable: /assets/index-DPfYPO7h.css”. Drafts, versions and outbox remain exactly unchanged. Profile/catalogue preparation metadata may legitimately refresh. |
| CDR-04: successful repair and offline restart | **PASS** | Removed the static-asset fault; actual cache protocol returns `ok: true`. Required shell/JS/CSS assets are cached. Full Chrome restart and offline reopening show the saved QR request. All six store snapshots compare exactly equal across this restart. |
| CDR-05: reconnect, explicit validation recovery, sync | **PASS** | Original HANDOVER synchronizes once. Initial Owner CREATE is correctly rejected for absent agreed amount; its immutable input and visible error remain saved. Existing explicit review adds the agreed amount and creates a new resolving operation, which synchronizes once. Repeated synchronization leaves the complete outbox unchanged. Details below distinguish reviewed replacement from unchanged retry. |
| CDR-06: repeat QR acceptance after recovery | **PASS** | After reconnect/preparation, verify and accept the same signed QR offline again. UI reports “This transfer was already accepted locally; opened its preserved draft.” Drafts/outbox/versions remain exactly unchanged; no second local HANDOVER is created. |
| Read-only D1 duplicate/preservation verification | **PASS** | One request, one active quotation and one receipt per successful operation; exactly one claim for the QR request. Failed original CREATE has zero receipts. No payments were created by these checks. Previously retained payment and original local records remain unchanged. |

Total shell-cache loss does **not** leave a usable cold offline shell. The browser shows unavailable navigation until connectivity permits repair; this is an expected availability boundary, not silent business-record loss. Cache repair cannot restore IndexedDB if the browser/OS deletes all origin data; that destructive case was not simulated.

## Operation identities and recovery evidence

| Work | Operation / authoritative request | Final disposition |
| --- | --- | --- |
| Accepted QR | Operation `dabd28d2-87ae-4b70-aed7-d21045868c41`; request `5e5efae4-5a84-496a-81de-5cf1420e5e07` | Original immutable HANDOVER survives cache loss and synchronizes. One receipt, request, active quotation and QR claim. Reacceptance adds no local work. |
| Initial Owner bill | Operation `061624e6-c130-4e73-8b00-8e75331150b3` | Preserved original payload; HTTP 400 `validation_error`, visible “Invalid offline request details.” Production validator identifies `acceptedAmountPaise`: “Accepted amount is required in bargain mode.” Zero server receipts. |
| Explicitly reviewed bill | Operation `d81a5f2f-d7b2-410f-b873-fa2d378593c4`; request `b1ee4994-02d8-4f40-8480-22aff8455745` | Existing review workflow supplies an agreed amount of INR 100. New operation records `resolutionOf` the rejected original; original payload is retained. One server receipt, request and active quotation; no QR claim. |

The test driver initially queued the ordinary Owner bill without its required bargain-mode agreement. The rejection is not cache corruption; the report does not claim that an invalid original CREATE later synchronized unchanged. QR synchronization does retain its original identity. The reviewed correction exercised failure preservation and explicit recovery without changing application code or mutating the original queued payload. The validation error shown by the UI is generic; the field-specific explanation above comes from the production validator run against the captured input.

The sender's new source CREATE remains pending in its retained Admin profile, as intended for a QR handover performed before sender cloud sync. It was not synchronized or deleted during cleanup. Do not bulk-sync diagnostic profiles as part of evidence review.

Read-only verification also confirms all original Owner local records unchanged: **1 draft, 5 outbox rows, 8 versions**. The retained finalized mixed-pack bill still has **50,000 paise due, one payment of 10,000 paise, and 40,000 paise outstanding**. New requests have zero payments. No new payment workflow was run merely to repeat the prior payment acceptance matrix.

## Limits and NOT TESTED checks

| Remaining boundary | Status | Reason |
| --- | --- | --- |
| Previously populated privileged-cache role demotion | **PASS — after security fix** | Both original failing checks pass on the final local build, including full offline Chrome restart. Original FAIL evidence is retained in the pre-fix section. |
| Scoped membership removal after privileged-cache population | **PASS — after security fix** | Real scoped membership removal with private preparation populated: confirmed 403 persists revoked/read-only authority, clears private pricing, hides the revoked workspace after full offline restart, and preserves pending work and Stall B's profile. |
| Permitted cross-stall re-login after demotion | **PASS — newly executed G07** | Authorized Stall B re-login, private preparation and offline reload do not render Stall A's request or mix private catalogue product IDs. Stall A pending work remains saved. |
| Genuine OS/browser eviction of IndexedDB, persistence grant downgrade, storage-pressure behavior | **NOT TESTED** | Deterministic Cache Storage deletion was tested; actual whole-origin eviction or persistence-policy demotion was not induced. No site-data clear or uninstall was used. |
| Physical Android installation, reboot, real storage policy and optical QR | **NOT TESTED** | Desktop Chrome evidence only. Retained synthetic camera passes do not establish physical-device behavior. |
| New shell build/version activation replacing an old build | **NOT TESTED** | The same retained build was repaired. No rebuild or service deployment occurred. Retained service-worker unit evidence is not promoted to a new browser update result. |

**Earlier static-cache-loss application FAIL:** none established. **Historical privileged-cache application FAIL:** one critical defect, recorded by two original G07 assertions below; now fixed and verified by the post-fix checks. This report does not grant overall release approval.

## Evidence retention and execution boundaries

Private artifacts under `E`:

- `results.json`: final checks, raw UTC timestamps, operation identities, per-store hashes, static-cache paths, sync trace, validation result and retained diagnostic attempts. November 3 UTC timestamps can correspond to November 4 in the user's Asia/Calcutta timezone.
- `original-owner.json`, `original-admin.json`, `before-cache-loss.json`, `after-total-loss-restart.json`, `after-failed-repair.json`, `after-initial-sync.json`, `after-sync.json`, `after-qr-reaccept.json`: before/after snapshots. Credentials/device data and customer details remain private; they are not copied into this report.
- `qr-frames.txt`: actual newly exported signed transfer; `bill-validation.json`: field-level validation reason.
- `database-verification.json`, `verify-disposable.py`: final passing read-only database counts, path assertions and original local-record comparisons.
- `harness-startup-failure.json`, `harness-node20-failure.json`, `attempt-before-reauth.json`, and `results.json/priorAttempts`: retained setup/diagnostic failures. The Node 20 helper needed the already installed WebSocket package; an initial Windows import path needed correction. An early repair attempt lacked current workspace authentication, and service-worker offline emulation also disabled the page's preparation control. These attempts were superseded by authenticated, static-asset-only fault injection. No application fix was made. The initial sync timeout was investigated as the missing agreed amount described above.
- The initial read-only verification used a nonexistent table name, then was corrected to the existing `request_payment_ledger`; the final verification exits 0. No SQL mutation or schema change was used.

Only unfinished checks were resumed; passing cache scenarios were retained. No broad regression rerun, migration, deployment, Git command, original local D1 access, production access, dependency installation, application/configuration edit, new service or unrelated fix occurred. Existing test browser processes were closed/relaunched only to exercise restart; the running frontend/Worker were left unchanged. The only project file changed is this report.

## G07 — original pre-fix populated-cache demotion evidence (2026-11-04)

**Historical result: FAIL; critical release blocker, subsequently fixed below.** Five original G07 checks executed: **3 PASS, 2 FAIL**. The two failures are separate observations of the same durable-authority defect. A separate read-only D1 preservation check passes. No application code, configuration or dependency was changed during that original acceptance run.

### Isolation, fixtures and safe role simulation

Both existing services were responding: frontend `/admin/offline` HTTP 200 and Worker `/health` HTTP 200. Rechecked listener ancestry: frontend PID 17232 serves `RUN/frontend-dist`; Worker listener PID 19780 descends from Wrangler PID 11848 using the same explicit `--local`, `RUN/wrangler.toml` and `--persist-to RUN/persist` arguments. That config still binds `DB` to `diwali-release-disposable`, ID `e92daf64-ea48-4b6b-ad91-229f6f079961`. Final process/config verification is retained as `G/isolation-final.json`.

`G` is `RUN/g07-20261104`. Reused Phase 3 fixtures and the retained `RUN/p3-4d7319f8/browser-season-1793707717321` Chrome profile through the existing Phase 6 browser client. Reused the existing quoted request `831eb9f0-ea7f-4de3-9915-444d185cdbbf`; no new server bill was created for this test.

- Controller: existing `p3-4d7319f8-controller`, a separate authorized Stall A Owner.
- Subject: existing `p3-4d7319f8-recipient`, initially **Admin in Stall A**, **Owner in Stall B**.
- Stall A: `p2-d8b31a19-a`; Stall B: `location-c78ed5639b952ebbeb3b638c91aa0945`; season `season-2026`.
- The controller used the actual scoped role API, `POST /api/admin/users/{subject}/role`, to temporarily grant **Super Admin in A**, then demote back to the original **Admin in A**. The existing season authority already permitted the temporary role; no season/global role, password or Stall B membership change was needed. The controller remained authorized throughout.
- Populated one private pricing row in each stall through real secure-QR preparation. A local unqueued draft marks permitted Stall B data. In A, downloaded the existing request as a separate draft and queued EDIT, AGREEMENT, CLOSE and PAYMENT offline. These were never authorized to commit after demotion.

The demotion happened while the device was offline. Retaining the old role at that point was expected. The failure below is specifically **after reconnection and fresh server confirmation of the lower role**, not a claim that an offline device must learn a remote change immediately.

### G07 results

| Check | Status | Observed evidence |
| --- | --- | --- |
| G07-01: privileged user positively populates IndexedDB | **PASS** | Fresh A preparation records cached `super_admin` and one private pricing row; Owner financial estimate is visibly rendered. B also has one positively populated private row. Four A operations are saved offline with their original IDs and payloads. Evidence: `G/populated-A-before-demotion.json`, `G/populated-B.json`, `G/results.json`. |
| Safe scoped role demotion | **PASS — prerequisite** | Controller's scoped API succeeds. Fresh subject `/api/admin/session` confirms effective role **admin** in A. B remains **owner**. Final read-only membership query confirms A is back at its original Admin role. |
| G07-02: private cache inaccessible after fresh authority confirmation | **FAIL** | Online Admin UI hides the financial estimate, but the same subject's A IndexedDB profile still says `super_admin` and contains **one readable private pricing row**. Evidence: `G/after-confirmed-demotion-before-sync.json`; `results.json/afterAuthorityRefresh` records effective role `admin`, cached role `super_admin`, private rows 1, visible financial estimate false. |
| G07-03: confirmed demotion survives offline restart | **FAIL** | Close the full Chrome process, relaunch the same profile offline, reopen the cached workspace and select the preserved A draft. The **Owner financial estimate reappears**, including purchase/profit information from the retained private row. Evidence: `G/demoted-offline-restart.json`, `G/demoted-offline-visible.txt`, `results.json/offlineAfterDemotion`. This is a normal application UI exposure, not only a developer-tools read. |
| G07-04: unauthorized sync preserves pending work | **PASS** | Re-login as A Admin and explicitly synchronize. First EDIT returns **403** and becomes failed; AGREEMENT/CLOSE/PAYMENT remain pending. All four immutable operation payloads, drafts and versions survive. Sync finally persists cached role Admin and removes A private preparation. Authoritative request snapshot is exactly unchanged: quoted, revision **8**. Evidence: `G/after-demoted-sync.json`, `G/database-verification.json`. |
| G07-05: re-login with permitted Stall B access | **PASS** | Fresh password login as the same subject, selecting B, confirms effective Owner access. Before B preparation, A request/financial estimate are not rendered. After B preparation and offline reload, only the B marker draft is rendered; B private product IDs differ from A's. A's four operations and all drafts remain unchanged. Evidence: `G/permitted-B-after-relogin-verified.json`, `G/permitted-B-visible.txt`. |

Pending A operations preserved:

| Kind | Original operation ID | Final state |
| --- | --- | --- |
| EDIT | `7165c0ae-e51e-4b87-8923-65628c27b7c0` | Failed, explicit 403 |
| AGREEMENT | `79865141-3aad-44c2-b0ad-3a9ffe6eceb3` | Pending, dependent |
| CLOSE | `a25a5e3b-2b4e-4402-9c9e-1cf7377dc760` | Pending, dependent |
| PAYMENT | `b1b147bd-c37a-48be-8163-f3a21788ef04` | Pending, dependent |

Read-only SQLite verification opens only the manifest-verified disposable file with URI `mode=ro` and `PRAGMA query_only=ON`. It confirms **zero server sync receipts and zero payment-ledger entries for all four operations**, zero payments on the target request, unchanged request revision/status, A Admin/B Owner memberships, and exact preservation of all four payloads plus drafts/versions. The unauthorized EDIT dispatch was rejected; no privileged operation was accepted or silently committed. No pending record was deleted as cleanup.

### Reproduction and implementation finding

1. With A Super Admin access, prepare private offline pricing and queue privileged work.
2. While that browser is offline, a separate Owner demotes the subject's A role to Admin.
3. Reconnect and select/reopen the same workspace; positively confirm a fresh Admin session. Return offline before explicit or periodic synchronization reconciles the cached profile.
4. Observe that IndexedDB still stores the old privileged role and private catalogue. Close/relaunch Chrome offline and open the saved draft: the Owner financial estimate is visible again.
5. Explicit online synchronization later updates the cached role/purges private preparation and rejects the original financial operation with 403. This eventual purge does not prevent step 4.

Source inspection supports the observed behavior: `AdminSessionContext.jsx` applies fresh authority to in-memory session state, while `AdminOfflineBillingPage.jsx:190` persists demotion/private-catalogue removal during `sync()`. At `AdminOfflineBillingPage.jsx:46`, a non-authenticated session falls back to the saved profile's role. Rendering at line 297 then enables the Owner financial estimate from the stale privileged profile. **Inference:** authority refresh and durable offline-profile reconciliation are not coupled, leaving an exposure window before synchronization. The reproduction, not source inference alone, establishes FAIL.

The first critical finding was reported to the user before any potential fix. No fix was attempted. The report does not treat server denial, eventual purge, or the passing B boundary as mitigation sufficient to pass demotion acceptance.

### Evidence and limits

- `G/results.json`: final 3 PASS / 2 FAIL scenario matrix, fresh API role evidence, scope/operation identities and sync trace.
- `G/initial-results.json` and `results.json/priorAttempts`: initial B assertion incorrectly used `productId` instead of the private catalogue's actual `id` field. Corrected only the temporary verification and reran only G07-05; its final result is PASS. The two genuine demotion failures were retained, not rerun or overwritten.
- `G/database-verification.json`, `G/verify-disposable.py`: final read-only server/local preservation checks, exit 0.
- `RUN/g07-20261104.mjs`, `RUN/g07-stall-b-20261104.mjs`: temporary orchestration using the retained browser helper; no replacement test service or database infrastructure.
- Sensitive profile snapshots, pricing and visible-text captures remain private under G. Only roles, counts and test identities are summarized here.

At the end of the original run, populated-cache membership revocation was **NOT TESTED**; it was subsequently tested during the fix validation below. Physical Android and genuine OS/browser storage eviction remain **NOT TESTED**. The original acceptance run used no migrations, production/original D1 access, deployment, Git commands, broad regressions, service restart or application/configuration changes; its only project-file change was this report.

## G07 security fix and post-fix acceptance (2026-11-04)

**Result: PASS — desktop, verified after full offline restart on the final build.** The previous two failures are closed by observed before/after results, not source inspection alone. `F` below means `RUN/g07-fix-20261104`.

### Reproduction and cause

Before implementation, reran only G07-02/03 with the same disposable subject, controller, Chrome profile, request and saved pending work. `F/before-results.json` records **FAIL / FAIL**: fresh effective Admin authority, cached role `super_admin`, private row count **1**, and the Owner financial estimate visible again after full offline Chrome restart. Drafts, outbox, versions and QR/device metadata remained preserved during reproduction.

Fresh authority previously updated only session memory. Durable role/private-preparation cleanup occurred inside explicit/periodic synchronization. Closing the app before sync left a privileged saved profile; offline startup used that profile's role and pricing. This allowed private pricing to reappear even though the device had already received confirmed lower authority.

### Small scoped implementation

| File | Security change |
| --- | --- |
| `src/admin/api/adminApi.js` | `fetchAdminSession()` awaits durable offline-authority reconciliation before returning parsed authority or a confirmed 401/403. Failure to secure offline state returns an explicit `offline_authority_unavailable` error instead of confirming success. |
| `src/admin/offline/authority.js` | Small bridge opens existing offline storage, awaits the reconciliation transaction and notifies the current workspace to reload its cached profile. Unsupported IndexedDB does not create a second offline mechanism. |
| `src/admin/offline/storage.js` | One existing-store transaction reduces cached authority for the confirmed user, matching complete business/stall/season tuples against the server's authorized list. Lower-role profiles lose private preparation. Removed memberships become durably revoked, nonprivileged and read-only. Confirmed scoped 401/403 invalidates the selected saved authority; network failure/status 0 and transient 503 do not invent revocation. Fresh preparation is required to re-establish revoked/increased offline privileges. Cached sync/review profile copies cannot reinsert purged preparation or re-elevate the stored role. |
| `src/admin/offline/synchronize.js` | Rechecks current persisted authority immediately before dispatch. Privileged pending operations denied by the new authority receive a visible local 403 (`offline_access_denied`) and remain saved; no operation POST is sent. Reuses the same access checks as local queueing. |
| `src/admin/pages/AdminOfflineBillingPage.jsx` | Reloads the cached profile after durable authority changes and hides revoked workspaces or an offline-authority storage failure. Offline fallback cannot restore a revoked/previously reduced privileged profile. |
| `src/admin/offline/authority.test.js` | Focused regressions exercise the two original failures, membership/session revocation, bill/QR preservation, other-stall/user isolation, transient failure behavior, denied dispatch and stale profile/session copies. |

The reconciliation transaction updates **profiles only**; it reads the existing active-profile pointer to constrain denial handling. It does not delete or rewrite drafts, version history, queued payloads, accepted-QR markers, signing identities, device metadata or selling catalogues. It does not change IndexedDB schema/version or any D1 schema. Existing server authorization remains enforced independently.

Successful session reconciliation considers only the confirmed user's cached tuples. A removed A membership invalidates A while an independently authorized B profile remains unchanged. No global clear-site-data operation, bulk outbox cleanup or unrelated user purge was introduced.

### Focused test evidence

| Check | Status | Evidence |
| --- | --- | --- |
| New focused production-module regressions | **PASS — 9 tests** | `node --test src/admin/offline/authority.test.js`; `F/authority-tests.log`, exit 0. Tests use the existing fake IndexedDB dependency and the real session client/storage/synchronizer; no D1, schema construction or migrations. |
| Existing atomic-save and permission-retention checks | **PASS — 2 tests** | `node --experimental-global-webcrypto --test --test-name-pattern="atomic draft/outbox failure\|expired authentication and permission changes" src/admin/offline/offline.test.js`; `F/existing-permission-tests.log`, exit 0. The other nine tests were skipped by the name filter, not rerun. |
| G07-02, final browser build: confirmed demotion immediately durable | **PASS** | `F/after-results.json`: effective Admin confirmation leaves cached role **admin**, private rows **0**, before explicit synchronization. `F/after-confirmed-demotion.json` is the raw snapshot. |
| G07-03, final browser build: full offline Chrome restart | **PASS** | `F/after-results.json`: financial estimate visible **false**. Closed the full browser, relaunched the same profile offline, reopened the shell and selected the preserved A draft. `F/after-offline-restart.json`, `F/after-offline-visible.txt`; all draft/outbox/version/QR/device snapshots preserved. |
| Demoted privileged sync is blocked before dispatch | **PASS** | Existing failed EDIT was explicitly retried unchanged under Admin authority. Local guard returned `offline_access_denied`, status **403**; **zero sync operation POSTs**. All four original payloads retained. `F/after-local-denial.json`, `F/boundaries-results.json`. |
| Populated-cache membership revocation and offline restart | **PASS** | Temporarily prepared A as Super Admin, then a separate Owner removed only A membership through the existing API. Actual scoped session refresh during sync returned **403**. Cached role became null, writable false, revoked true, private rows **0**. Full offline Chrome restart hid A's request and financial estimate. All pending rows and QR/device metadata remained; B's profile compared exactly unchanged. `F/confirmed-revocation.json`, `F/revoked-offline-restart.json`, `F/revoked-offline-visible.txt`, `F/boundaries-results.json`. |
| Final-build permitted B re-login and full offline restart | **PASS** | Fresh permitted Owner preparation in B, full Chrome close/relaunch offline: only the saved B marker draft appears; no A request is rendered. B has **1** private row; A has **0**. All original payloads, drafts, versions and QR/device metadata preserved. `F/final-stall-B-results.json`, `F/final-stall-B-latest.json`. |
| Disposable D1 no unauthorized mutation/duplication | **PASS** | `F/database-verification.json`, read-only verifier exit 0. All four operation IDs have **zero sync receipts and zero payments**. Existing request remains **quoted, revision 8**. A membership is restored to Admin; B remains Owner. |
| Local build and isolation | **PASS** | `F/build.json`, `F/source-hashes.json`, `F/isolation-final.json`. Final asset `assets/index-CZ5KB1J3.js`; existing preview still PID 17232 and local Worker listener still PID 19780, Wrangler PID 11848. Same config, local disposable binding and persistence throughout. |

The local isolated frontend artifact was rebuilt in the existing `RUN/frontend-dist` to exercise the fix; the earlier build is preserved in `F/frontend-dist-before`. No deployment or frontend/Worker process restart occurred. Normal service-worker update activation was allowed by closing test Chrome windows before the final replay. This is desktop acceptance of the fixed artifact, not deployed-runtime parity.

The revocation test used membership DELETE, which removes its row. An initial cleanup attempt through `/enable` correctly returned 404. Cleanup was corrected using the existing scoped user-grant API with `existingOnly: true`, restoring the same login's A membership as Admin; no new account or season/global authority was created. The passing local-denial and revocation checks were retained; only fixture restoration and the unfinished B boundary were resumed. The diagnostic remains in `F/boundaries-before-fixture-restore.json` and `boundaries-results.json/priorAttempts`.

The first local build's old service worker delayed shell refresh until browser closure; `F/harness-shell-update.json` retains that setup attempt. A new test initially assumed IndexedDB key order was dispatch order; its assertion was corrected to identify the failed row by state, with `F/authority-test-ordering-diagnostic.log` retained. Final nine-test output passes. These were test/setup diagnostics; no unrelated application workaround was added.

### Public products / Family Pack 503 investigation

**Cause identified; unrelated to privileged-cache demotion. No public endpoint/configuration fix made.** Direct local Worker requests to both `/api/public/products?limit=1` and `/api/public/family-packs` return HTTP **503** with error **`catalogue_unavailable`**.

The isolated config enables `ADMIN_LOCATION_MODE = "1"`, but neither it nor its `.dev.vars` supplies the required trusted public scope:

- `PUBLIC_REQUEST_BUSINESS_ID`
- `PUBLIC_REQUEST_LOCATION_ID`
- `PUBLIC_REQUEST_SEASON_ID`

`server/src/services/publicCustomerRequestContext.js` deliberately fails closed when that tuple is missing. Both public catalogue routes use that resolver. A focused read-only invocation with the observed missing tuple reproduces the 503 **before any database query**. This is not evidence of a missing D1 binding, a demotion-related purge, or database corruption.

`src/main.jsx` mounts both public catalogue providers above the router, including Admin pages. Their load effects run on provider mounting, so the full page navigations/restarts in these checks repeat the same public requests. The repeated 503s are separate from the authenticated offline/session paths. No retry loop, public scope, routing or provider refactor was introduced for this security fix. Evidence: `F/public-503-investigation.json`, including actual response bodies, missing variable names and zero-query resolver reproduction. Secret values were not logged.

### Final disposition and remaining boundaries

**G07 desktop demotion/revocation acceptance: PASS.** Both previously failing scenarios pass on the final artifact after full offline restart. No silent record deletion, cross-stall UI exposure or unauthorized server commit was observed. The prior FAIL evidence is retained as history.

Physical Android installation/reboot/storage policy, actual OS/browser origin-data eviction, and deployed-runtime parity remain **NOT TESTED**. The new browser G07 pending chain contains EDIT/AGREEMENT/CLOSE/PAYMENT; pending HANDOVER record preservation is covered by the focused real-storage module regression, unchanged QR/device records, and retained earlier QR evidence. No optical-camera or broad QR regression was repeated.

No production/original local D1 access, migrations, deployment, Git commands, broad regression reruns, dependency installation or unrelated refactoring occurred. Changed project files are only the five implementation files, focused regression file and this report listed above; temporary orchestration/evidence remain under RUN.

**Next single release-critical task:** run physical Android offline demotion/revocation and restart acceptance against the disposable environment using the fixed artifact.
