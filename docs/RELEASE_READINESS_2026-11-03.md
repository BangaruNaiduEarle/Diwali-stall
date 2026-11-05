# Final release readiness — 3 November 2026

> Follow-up: the three original code/test/dependency blockers below have been fixed.
> See [the blocker fix report](RELEASE_BLOCKER_FIXES_2026-11-03.md) for current results,
> all 20 passing former failures, and newly identified server tooling advisories.
> This document retains the original rehearsal findings; it is not release approval.

**Decision: NOT RELEASE READY.** Local migration rehearsal, location-mode Worker/D1 workflows and desktop Chrome offline recovery passed. A real legacy-mode checkout retry created a duplicate request; backend unit and scope regressions have 20 unresolved test failures; the installed Vite version has a high-severity advisory; actual Android installation/camera/device testing remains unverified. No application features were changed during this exercise.

## Evidence and environment

All evidence below is under this disposable directory, abbreviated `RUN`:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

- Production frontend build/preview: `http://localhost:5193`, output `RUN/frontend-dist`.
- Real Worker with location mode enabled: `http://localhost:8793`.
- Separate real Worker with legacy mode enabled: `http://localhost:8794`.
- Both Workers bind only the disposable D1. Password authentication remains enabled; local authentication bypass remains disabled.
- Frontend API URL was overridden only for this build process to the local Worker. `.env.local`, production configuration and application dependencies were not changed.
- Wrangler 4.85.0's installed runtime rejected compatibility date `2026-10-01`; the temporary configurations use its supported `2026-05-01`. This limits runtime parity. No project/production compatibility date was changed.
- Browser tests used headless desktop Chrome with separate persistent Admin and Owner profiles, actual UI password login, actual catalogue/device preparation, actual IndexedDB and service worker, and the real Worker. Non-local browser requests were blocked, including Google Fonts; the offline interface remained usable.
- Backups contain existing local business/authentication data. Fixture credentials, session cookies, test signing key and browser profiles remain inside `RUN`; they are not committed into this report, frontend assets or QR frames.

## 1. Migration rehearsal

Inspected migrations 0021–0024 and their prerequisite chain. The current active database already has 0020 and 21 migration records, including both historical `0010` migration filenames. Only these four migrations were copied into the temporary configuration's migration directory:

1. `0021_request_workflow_history.sql`: stable historical line IDs, request revisions and audit history; unknown historical actors remain unknown.
2. `0022_request_payment_ledger.sql`: scoped immutable payment accounts and append-only ledger; depends on workflow history.
3. `0023_offline_sync_receipts.sql`: scoped devices, immutable identities and operation receipts; depends on the preceding schema.
4. `0024_qr_handover.sql`: signing-key registrations, unique transfer claims, authority and history triggers; depends on offline devices/receipts.

Actual `wrangler d1 migrations apply ... --local` applied all four in order against `RUN/persist`. Verification found all **50 expected tables/indexes/triggers**, **25 migration records**, SQLite integrity `ok`, and **zero foreign-key violations**. Reapplying found no pending migrations.

Immediately after migration, before fixtures: the clone still had 70 requests, 274 request items, 72 quotations, 297 quotation items, 165 products and 7 Family Packs. Nine eligible historical payment accounts were backfilled. No historical payment receipts, workflow events, offline receipts or QR claims were invented.

Real Wrangler batch probes verified a failed unique insert rolls back preceding inserts in that batch while retaining earlier committed data. A valid foreign-key fixture rejected an orphan child. Separate CLI invocations retained committed rows; the browser-created bill/payment also survived a complete Worker restart.

Rollback risk: these migrations add columns, backfill identities and install immutable financial/audit records. There is no rehearsed down migration. Removing tables/triggers after live writes would destroy history and idempotency guarantees. Any future rollout needs a separately approved backup/restore and application compatibility plan; this task did not perform a rollout or restore the original database.

Evidence: `isolation.json`, `migration-verification.json`, `additional-probes.json`, `worker-restart-persistence.json`, `logs/migration-final.log`.

## 2. Disposable database and verified backups

Original directory, used read-only:

```text
C:\naidu\Diwali\server\.wrangler\state\v3\d1\miniflare-D1DatabaseObject
```

Active database: `5264016ce8a63a3f1f9239770b32628020abc7fe1141bfbdd036d824a8f8ea73.sqlite`.

Verified SQLite backups of that database, the older `9ba2b04b…` database and `metadata.sqlite` are in `RUN/backup`. SQLite backup API snapshots included committed WAL content. Each backup passed integrity, schema/per-table logical hashes and SHA-256 checks.

Disposable database:

```text
RUN/persist/v3/d1/miniflare-D1DatabaseObject/
10117598a2d3d609371c5086d310b837fcfaad24d6f891aa935c4987527cc6d4.sqlite
```

It was initialized as an empty real Wrangler D1, populated from the verified backup and checked for equality before migrations. Its dummy database name/UUID and persistence/configuration are independent of the project's original database binding.

Final verification: all three original databases have unchanged main-file/WAL hashes and unchanged schema/per-table logical content relative to the successful backup. Additionally, every original row projected onto its original columns remains present and unchanged in the exercised clone, excluding SQLite/Cloudflare internal metadata.

An initial backup attempt detected creation of an empty WAL/shared-memory sidecar while opening the WAL-mode source read-only. It stopped before migration/testing. Main-file bytes, schema and business content were unchanged; the successful retry established the verified baseline. That failed attempt is retained separately at `diwali-release-dfd556fd92e345b4b30b654414ee0ba2` rather than deleting source sidecars.

Evidence: `backup-verification.json`, `original-preservation-final.json`, `historical-preservation.json`.

## 3. Real Worker + D1 end-to-end results

**15 HTTP workflow checks passed; zero failed.** These exercise actual route authorization, password/session cookies, device registration, server certificates, transactions, triggers and persisted D1 records.

Admin creates a request, adds/removes products and changes quantities. Restricted financial changes and finalization return 403. Online assignment to Owner succeeds; Owner applies price overrides/discount and an agreed amount; a separately authenticated Super Admin finalizes. Creator, recipient and finalizer are distinct, and payment recorder identity is retained in payment/audit records. Request/account scope remains the selected business/stall/season rather than a user's personal ownership.

The separate legacy-mode Worker returned a valid Owner session and product catalogue, and accepted checkout. However, repeating that checkout with the same `Idempotency-Key` produced a different request ID. This is an observed legacy retry/duplication risk requiring resolution or explicit contract clarification before release. The test created only disposable fixture requests. The failing legacy/service unit tests below also remain unresolved.

Evidence: `http-e2e-results.json`, `additional-probes.json`.

## 4. Stall A/B isolation

Added fixtures only to the clone: business `rr-business`, stalls `rr-a`/`rr-b`, four Admins, Owner A, Super Admin A, Owner B and a Platform Admin without operational membership.

- A sees only its two fixture products; B sees only its independent product and pricing.
- A→B and B→A scoped catalogue access returns 403; cross-stall request details are rejected.
- Platform Admin session retains platform authority but cannot bypass stall membership (403).
- Admin catalogue/request responses omit restricted private pricing/profit fields.
- Historical Stall A rows remain unchanged both in the original database and the clone.

Evidence: HTTP checks and `historical-preservation.json`.

## 5. Four-Admin concurrency

Four distinct authenticated Admin users, registered devices and prepared catalogues submitted different offline CREATE operations concurrently through the real Worker. Four distinct requests committed. Replaying each unchanged operation returned an idempotent acknowledgement.

Two Owner devices competing for one QR transfer produced one success and one 409. Two competing closures likewise produced one success and one 409. Stale Admin changes after Owner finalization were rejected and preserved as an explicit conflict. No automatic merge was invoked.

Evidence: `http-e2e-results.json`, desktop browser conflict check.

## 6. Offline QR and Family Pack results

**14 desktop Chrome checks passed; zero failed.** The complete production-preview flow used real preparation, not injected IndexedDB/catalogue fixtures:

1. Admin prepares the authorized stall/signing device online, then creates a mixed ordinary-product/Family-Pack request offline and queues creation.
2. Generates multipart QR; Node verifies its actual server-issued certificate and signature using the corresponding public root key.
3. Closes/restarts Chrome offline; the cached application and pending Admin draft reopen.
4. Owner separately prepares online, disconnects, verifies the complete pasted multipart sequence, previews the Family Pack and accepts provisionally. Repeating acceptance retains one operation/draft.
5. Owner queues product-price adjustment/discount, agreement, closure and partial payment offline. A second complete browser restart preserves all five operation IDs and the original pack version.
6. Reconnects, reselects the authorized stall online and synchronizes. A deliberately interrupted AGREEMENT request leaves two acknowledged operations and three pending dependencies. Retrying completes all five unchanged identities.
7. Admin's stale source CREATE becomes a durable conflict after Owner finalization. Neither side is silently discarded.

The actual Worker also rejected a Family Pack handover after its catalogue price changed, and an already accepted request's captured pack snapshot remained byte-for-byte equivalent. The fixture catalogue price was restored in a `finally` block. Ordinary product handovers, invalid recipient, signature tampering, changed membership, expired-session rejection and catalogue/revision conflicts passed HTTP checks.

Camera permission refusal produced actionable UI guidance. **Physical camera decoding, screen-to-screen scanning and Android installation were not exercised.** Pasting actual signed multipart frames exercises verification/acceptance but does not prove camera capture quality. Larger 80-component packs and missing/incompatible component cases are covered by existing focused automated tests; they were not separately captured with a physical camera or repeated as every real-Worker variant.

Operational observation: reconnecting a page opened offline after browser restart does not itself restore the selected authenticated stall. Reselect the authorized workspace online, return to Offline billing and synchronize. Pending operations remain saved throughout. The first harness attempt omitted that required step; its diagnostic is retained as `browser-before-context-reselection.json`.

Existing unsupported scenarios remain explicit: custom/substituted/nested packs, empty definitions, historical pack lines without complete captured snapshots, offline pack unit-price overrides, and oversized envelopes. Supported catalogue variants are separate pack records; no independent variant entity exists. Current limits are 80 components/pack, component quantities 1–999, whole-pack quantities 1–99, 50 request lines, 64 KiB signed envelope and 100 QR frames. Over-limit data must fail explicitly. See [QR_HANDOVER.md](QR_HANDOVER.md#family-pack-limits-and-unsupported-scenarios).

Evidence: `browser-e2e-results.json`, `browser-complete-success.json`, `http-e2e-results.json`, focused test logs.

## 7. Payments and duplicate prevention

Real online sequence: HOLD → CASH → RELEASE_HOLD → UPI → CARD → BANK, with partial and full settlement, correct balances and unchanged operation retries. A separate full CASH payment also reached PAID. Admin payment writes were rejected. Direct mutation/deletion of workflow history, payment accounts, ledger, claims and sync receipts was blocked by database triggers.

Real browser offline bill: agreed due **₹500**, received **₹100**, outstanding **₹400**, exactly **one payment**, still present after Worker restart. The ₹500 reference figure is not added to the amount due. Acknowledged dependencies share the original transferred request identity. Repeated location-mode scans/operation retries did not create another claim, bill or payment. This guarantee was not met by the separate legacy-mode checkout retry described above.

Evidence: HTTP/browser reports and `worker-restart-persistence.json`.

## 8. Security and Vite advisory

- QR verification used server-issued signing authority plus device signatures; tampering and wrong recipient were rejected.
- The generated server private JWK secret was absent from built JavaScript and actual QR payloads. Admin QR payloads contained no purchase/profit/margin/device-token fields. This proves the tested generated secret boundary, not an exhaustive scan for unknown production secrets (production secrets/configuration were not accessed).
- Browser shell caches contained only `/admin/offline`, manifest, assets and icons. API responses, authentication and business records were not present in shared shell caches; durable business data remained in scoped IndexedDB.
- Cross-stall membership, role, origin, device and stale-revision protections remained enabled. Changed membership returned 403 and expired authentication returned 401.

Installed **Vite 8.3.2** is affected by the **high** Windows launch-editor command-execution advisory [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm). The affected Vite range is 8.3.0–8.3.2; the online audit also lists five related lower-severity editor/middleware/filesystem advisories under that package. [Vite 8.3.3](https://github.com/vitejs/vite/releases/tag/v8.3.3) includes the patch set, including launch-editor 2.14.2 ([maintainer change](https://github.com/vitejs/vite/pull/23654)).

Safe remediation option: separately update the direct Vite development dependency to patched 8.3.3 or a reviewed maintained patched 8.x release, inspect the lockfile/dependency changes and rerun online audit, tests, lint and build. No dependency update or `npm audit fix --force` was performed. Binding development servers to loopback reduces exposure but does not remediate the dependency.

`npm audit --json --offline=false --prefer-online` against the registry confirmed one high vulnerable package and exited 1. The environment's plain/default offline audit returned zero findings; that is not accepted as evidence of remediation. Evidence: `npm-audit-online.json`.

## 9. Failed tests and unresolved limitations

| Command/check | Result |
| --- | --- |
| `npm test` | 173 passed |
| `npm run test:handover` | 136 passed |
| `npm run test:offline` | 37 passed |
| `npm --prefix server run test:unit` | 272 passed, **14 failed**, 286 total |
| Focused stall/season/platform regressions | 414 passed, **6 failed**, 420 total |
| Actual Worker HTTP harness | 15 passed |
| Actual desktop browser harness | 14 passed |
| Additional D1/legacy probes | 4 passed, **1 failed** (legacy checkout retry creates a second request) |
| `npm run lint` | Exit 0; existing warnings remain |
| Focused lint on new JavaScript harness files | No diagnostics |
| Production frontend build | Passed; existing >500 kB chunk warning (main JS ~1.06 MB) |
| Original DB preservation + clone historical rows | Passed |
| Physical Android installation/camera/device restart | **Not tested** |

Do not sum suite totals into a unique-test count: focused suites overlap.

Real Worker failure: legacy mode (`ADMIN_LOCATION_MODE=0`) accepted the same checkout body and `Idempotency-Key` twice but returned different request IDs (`962f3316-6a3c-4a82-ad5e-2ac75fbe8944` and `32510651-d8de-4617-9b56-a59e9587ac6c`). The location-mode atomic/idempotent path passed. No runtime change was made to hide or fix this legacy behavior. Evidence: `additional-probes.json`.

Unresolved backend unit failures:

- `adminPhase5.test.js`: six failures — independent selling/private updates, quotation creation, missing private rate, idempotent quotation and stable rate snapshot.
- `adminProductRateEdit.test.js`: four failures — purchase/X4 independence and unchanged-rate no-op behavior.
- `mixedEstimateWorkflow.test.js`: three failures — mixed product/pack persistence, two billable quotation lines and historical pack price retention.
- `adminRoutesAuth.test.js:71`: public customer-request POST unexpectedly returns 503.
- Additional scope regressions: `adminCustomerRequestSeasonIsolation.test.js` has six failures — scoped list enrichment, missing-season finalization, cross-season status update, missing/cross-season public agreement and cross-season private-pricing filtering.

The first thirteen and the six additional scope failures throw `location_context_unavailable` / “Service DB location mode is missing or invalid” in direct service/mock calls. The public route test reports an unexpected 503. These are observed fixture/service-contract failures, not proof that all corresponding online behavior is correct. They were not bypassed or repaired during release testing. Full details: `backend-unit-failures.json`, `scope-regression-failures.json`, `logs/backend-unit.log`, `logs/scope-regressions.log`.

The additional regression selection ran `server/tests/*Location*.test.js`, `*Season*.test.js` and `*Platform*.test.js`, excluding `auditLocationCompatibility` (previous implementation audit) and Family Pack files already exercised in the handover suite. It uses mocks and a SQLite `:memory:` constraint helper, not existing local business storage.

The server's default `npm test`/integration lifecycle automatically migrates the original local database. Those entry points were intentionally not invoked. Used the explicit safe unit script, focused suites and isolated real-Wrangler probes instead. Existing migration/integration helpers that reset their own persistence were not pointed at original data.

Additional limits: no physical four-phone concurrency, Android storage eviction/persistence-policy check, physical QR capture, production routing/cookie/HTTPS parity or complete legacy write rehearsal. Desktop CDP network interruption is controlled simulation; it is not proof of real mobile-network behavior. No release approval follows from these results.

## 10. Separate Android checklist and changed files

Use [ANDROID_RELEASE_CHECKLIST.md](ANDROID_RELEASE_CHECKLIST.md). Every device result remains unchecked until performed on actual Android hardware.

Added release-only files:

- `server/scripts/release-readiness-backup.py`
- `server/scripts/release-readiness-prepare.mjs`
- `server/scripts/release-readiness-db.py`
- `server/scripts/release-readiness-fixtures.mjs`
- `server/scripts/release-readiness-http.mjs`
- `server/scripts/release-readiness-browser.mjs`
- `server/scripts/release-readiness-probes.mjs`
- `docs/RELEASE_READINESS_2026-11-03.md`
- `docs/ANDROID_RELEASE_CHECKLIST.md`

Scripts require the explicit verified disposable run directory. The preparation/fixture scripts deliberately refuse to overwrite their generated files. Browser harness on Node 20 requires `node --experimental-websocket`. Scripts are rehearsal tooling, not a production migration runner.

No Git commands, deployment, original-database migrations, production access, feature changes or weakening of security checks occurred.
