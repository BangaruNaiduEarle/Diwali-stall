# Phase 6 — Offline QR & Family Pack Acceptance

**Verdict: desktop/local acceptance passes; full Phase 6 acceptance remains INCOMPLETE pending physical Android testing.** The requested matrix records **11 PASS and 1 partial NOT TESTED**, with no application FAIL. Normal-product and two-variant Family Pack QR were decoded through the application's actual camera scanner using synthetic desktop camera video. This is not an Android optical-camera result.

New execution: **6 browser/Worker checks PASS**, **30 focused production-module checks PASS**, **1 real expired-session check PASS**, and final read-only data preservation **PASS**. Existing completed phases were retained, not rerun. No reproducible critical application defect was found and no application fix was made.

## Sources and isolated environment

Read the current QR protocol, Family Pack snapshot validators, catalogue matching, camera lifecycle, offline storage/synchronizer, editor, financial preview and Worker handover implementation. Read [QR implementation/limits](QR_HANDOVER.md), [release readiness](RELEASE_READINESS_2026-11-03.md), [Multi-Stall](MULTI_STALL_ACCEPTANCE_2026-11-03.md), [Phase 3](ROLES_SEASONS_ISOLATION_ACCEPTANCE_2026-11-03.md), [Phase 4](BILLING_PAYMENT_ACCEPTANCE_2026-11-03.md), [Phase 5](FOUR_ADMIN_CONCURRENCY_ACCEPTANCE_2026-11-03.md), and the newer [server-tooling security report](SERVER_TOOLING_SECURITY_2026-11-03.md). The latter resolves the tooling advisories still mentioned in older reports; no new audit was run here.

Reused the established isolated Worker/D1 root, abbreviated `RUN`:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

Phase 6 evidence, abbreviated `P6`: `RUN/p6-87ca4e48`.

- Actual Worker: `http://localhost:8793`; existing isolated configuration and disposable persistence, location mode enabled, normal password/session authentication required.
- Existing isolated frontend build: `http://localhost:5193`, `RUN/frontend-dist`. Both services were already running. No rebuild/deployment.
- New business/stall: `p6-87ca4e48-business` / `p6-87ca4e48-a`, operating `season-2026`.
- New Admin, Owner and Super Admin fixture accounts; three separate Chrome profiles: Admin sender, normal-transfer Owner and mixed-pack Owner. Owner profiles share the intended user identity but have separate sessions, registered devices, keys and IndexedDB.
- Two new products and two fixed catalogue-backed Family Pack records, Classic and Premium. Existing business/catalogue/request data was not changed.

`P6/before.sqlite` was captured read-only before fixture insertion. All new Worker writes target only new Phase 6 identities/records. A later expiry probe inserts one **new** deliberately expired session for the new Owner; the existing authentication resolver rejects/removes that new expired row. No pre-existing session is expired or changed for the probe.

No original local database or production access, migration, deployment or Git command occurred. No runtime/UI/shared workflow, dependency or configuration was changed. The module guard checks use **fake IndexedDB only**, without SQL schema construction or migrations. Credentials, cookies, device tokens and browser profiles remain private under `P6`.

## Requested acceptance matrix

**New** means executed in Phase 6. **Retained** means inspected saved passing evidence from the named earlier run, rather than a fresh execution or code-only inference.

| # | Requested scenario | Result | Evidence and precise scope |
| --- | --- | --- | --- |
| 1 | PWA offline readiness and offline request creation | **PASS** | **New P6-01/04:** actual online catalogue/device/QR preparation, two requests queued offline, cached shell verified, full Owner Chrome process restart and offline page reopening with all five mixed-request operation IDs/snapshots intact. Desktop scope; Android installation remains NOT TESTED below. |
| 2 | Normal QR generation, scanning, preview, acceptance and handover | **NOT TESTED — partial** | **New desktop PASS, P6-01/02/05:** real signed v1 export, three QR frames, actual `getUserMedia` → video → canvas → `jsQR` decoding → full preview → explicit offline acceptance → later Worker handover. Repeated camera scan retains one operation; tracks stop after decoding. Camera input is synthetic desktop video, not a physical Android camera. Full physical screen-to-screen acceptance remains unperformed. |
| 3 | Supported Family Pack variants/components/quantities/units/selling prices | **PASS** | **New P6-01/03/05 + DB:** v2 mixed transfer with two separate fixed catalogue variants, complete ordered components and metadata, exact quantities/labels/prices, actual synthetic-camera preview and acceptance, unchanged saved snapshots through adjusted quotation, closure and payment. **Retained:** `logs/fix-handover.log` passing 80-component transfer/server-boundary tests. |
| 4 | Owner offline adjustments, finalization and payment | **PASS** | **New P6-04/05:** ordinary loose-unit override ₹9 and bill discount ₹10; queued ₹500 agreement, closure and ₹100 payment. Original pack prices unchanged. Adjusted quotation ₹1,617; final due ₹500; received ₹100; outstanding ₹400. **Retained:** Phase 4's full/partial/HOLD/method/permission matrix. |
| 5 | Reconnection and interrupted-sync recovery | **PASS** | **New P6-05:** successful HANDOVER response dropped after commit; original HANDOVER retried, EDIT acknowledged, AGREEMENT then interrupted before dispatch. Same five IDs eventually acknowledge once. No second bill, claim, receipt or payment. |
| 6 | Duplicate scans/acceptance, lost responses and duplicate operations | **PASS** | **New P6-02/05 + DB:** same normal camera sequence scanned/accepted twice, one local HANDOVER; mixed lost-response replay returns original identity; six receipts for six acknowledged operations, one payment. **Retained P5-03/07:** simultaneous same-operation CREATE/payment/QR copies share one commit, plus duplicate local QR acceptance. |
| 7 | Expired authentication, changed membership and invalid recipients | **PASS** | **New P6-AUTH-TTL:** real newly inserted expired Owner session returns 401, fresh password session 200; server clock unchanged. **New P6-06:** invalid-session replay of the acknowledged mixed operation returns 401. Guards reject expired preparation and wrong recipient. **Retained P3-QR-01/02:** signature-valid wrong Owner rejected; sender removal and recipient demotion invalidate new reconciliation attempts (403); intended recipient succeeds. |
| 8 | Tampering, incompatible catalogue versions and revision conflicts | **PASS** | **New guards:** tampered composition, private-field injection, missing products/variants, version-only mismatch, changed composition/unit/price/variant and substitution explicitly rejected with no local draft/outbox commit. **Retained real Worker:** `Family Pack catalogue drift rejects handover and preserves original accepted snapshot`; P5-04/05 stale revisions preserve local/server versions and final bills. |
| 9 | Competing QR claims and offline closures | **PASS** | **Retained real Worker:** `competing offline QR claims preserve one server claim and detect the loser`, `competing closures cannot both commit`. **Retained P5-06:** separate Owner/Super Admin browser closures produce one winner and a preserved 409 conflict. **New DB:** exactly two claims, one per new normal/mixed transfer, without retry duplication. No new competitive race was executed merely to repeat Phase 5. |
| 10 | Admin cannot access Owner-only purchase/profit information | **PASS** | **New P6-01/03/06:** Admin private preparation is empty; Owner preparation positively contains two private rows. QR contains no purchase/profit/margin/final-price/device-secret/private-key data. Admin catalogue/request/quotation/history surfaces redact private values. Guards reject Admin acceptance and private snapshot field injection. **Retained:** P3/P4 role and financial-modification denials. |
| 11 | QR handover independent from cloud synchronization | **PASS** | **New P6-02/03/05:** offline QR acceptance produces only local draft/outbox; authoritative Worker lookup still returns 404 and no sync POST occurs. Only explicit online synchronization materializes each original request/claim. Sender retains its original CREATEs; later source sync becomes preserved conflicts against the same request IDs, not new bills. |
| 12 | Unsupported Family Pack cases safely blocked | **PASS** | **New P6-BLOCK/P6-GUARD cases:** unsupported options/nesting/empty definitions, invalid quantities/loose packs, over-limit payloads, missing historical snapshots, legacy partial drafts and offline pack price overrides rejected explicitly. Failed imports leave zero new drafts/outbox entries in isolated module tests. Unsupported capabilities remain NOT IMPLEMENTED, as detailed below. No feature was added. |

The partial NOT TESTED disposition on scenario 2 preserves the physical-camera gap rather than promoting synthetic scanning to Android acceptance. Positive desktop results remain independently recorded. The Android checklist below contains additional device-specific subchecks; its count should not be added to the 12 requested scenario count.

The [machine-readable matrix](OFFLINE_QR_FAMILY_PACK_ACCEPTANCE_2026-11-03.json) records these dispositions, all 30 guard-test names, artifact references and the separate Android NOT TESTED checks.

## Actual camera-path testing and its limit

The Admin's real UI-generated frame strings were rendered as lossless QR images, independently bitmap-decoded, then placed in Y4M camera-input files. Desktop Chrome launched with its fake media-device/file-capture flags. The application itself called `navigator.mediaDevices.getUserMedia`, played the video, drew camera frames to canvas and decoded them with its normal `jsQR` loop. No QR frame was pasted, injected into the preview or accepted by bypassing the UI.

Evidence records **640 × 640, 5 fps**, three frames for the normal transfer and six for the mixed transfer, eight repetitions per frame. The receiving paste textareas stayed empty. The actual media tracks reached `ended` after complete decoding, verifying cleanup. Normal-product scanning was repeated through a second real camera-loop invocation; acceptance returned the already accepted local draft/operation.

This tests the software capture/decoding/assembly/verification path against deterministic synthetic images. It does **not** test Android installation, real camera optics, autofocus, glare, screen refresh, Android permissions, real phone storage policies or screen-to-screen capture quality.

| Physical Android subcheck | Status | Evidence / remaining action |
| --- | --- | --- |
| Android PWA installation and cold offline startup | **NOT TESTED** | No actual Android device used. Desktop prepared-shell/restart result is not device sign-off. |
| Android camera permission lifecycle and physical normal/Family Pack screen-to-screen scanning | **NOT TESTED** | Synthetic desktop stream and earlier desktop camera-denial result do not establish physical Android behavior. |
| Real Android reconnection, device reboot/storage retention and authenticated finalization/payment sync | **NOT TESTED** | Desktop process restart and controlled network faults passed; actual phone workflow remains required. |

Use the existing [Android release checklist](ANDROID_RELEASE_CHECKLIST.md) and [QR phone-validation steps](QR_HANDOVER.md#android-phone-validation) on actual isolated-test devices. No production or original-database access is needed for that sign-off.

## Two fixed variants and preserved pricing

The existing model stores each sellable variant as a separate `family_packs` record. It has no independent customizable variant-option entity. The new test transfers both supported records together:

| Line | Selected quantity | Fixed selling unit | Ordered components and exact unit labels |
| --- | --- | --- | --- |
| Classic fixed variant | 2 whole packs | ₹450 per pack | Product A: 2 per pack, label `box`; Product B: 1 per pack, label `piece` |
| Premium fixed variant | 1 whole pack | ₹700 per pack | Product A: 3 per pack, label `packet`; Product B: 2 per pack, label `bundle` |
| Ordinary product | 3 loose pieces | ₹10 per piece before adjustment | Product A's 10-piece pack snapshot and loose-sale permission preserved |

Variant IDs/slugs/labels, component row IDs/product IDs/names, ordering, per-pack component quantities, literal unit labels, product pack/company/pieces/loose-sale data, selling-price snapshots, availability and catalogue-version hashes are retained. Classic totals four `box`-labelled A components and two `piece`-labelled B components; Premium totals three `packet`-labelled A and two `bundle`-labelled B components. Labels remain descriptive metadata; they are never silently converted into another unit or used to recompute the fixed pack price.

Original quotation: **163,000 paise** = 90,000 Classic + 70,000 Premium + 3,000 ordinary pieces. Owner's ordinary-unit override changes the ordinary subtotal to 2,700; discount 1,000 gives adjusted quotation **161,700 paise**. The separately saved agreement determines final/payment due **50,000 paise**, followed by received **10,000** and outstanding **40,000**. Both pack prices and complete pack snapshots remain unchanged in request and quotation rows.

For pack-containing drafts, purchase/profit/margin and Final Price + ₹500 estimates remain **unknown** where descriptive component units do not establish a price basis. A new module check confirms null estimates/reference and explicit payable 50,000 paise, rather than an invented pack cost or added ₹500. Owner bill-level discount/agreement remain supported.

## QR versus cloud state

| Step | Device state | Authoritative Worker state |
| --- | --- | --- |
| Admin queues request and exports signed QR offline | Original CREATE stays pending; stable source identity retained | Request lookup 404 |
| Owner scans, previews and accepts offline | Local draft, duplicate marker and HANDOVER outbox entry only | Request lookup still 404; no sync POST |
| Explicit cloud synchronization commits, response is lost | Owner retains original pending operation until acknowledgement recovery | Original request/claim/receipt already exist once |
| Reconnection/retry and dependent workflow | Same HANDOVER/EDIT/AGREEMENT/CLOSE/PAYMENT IDs acknowledge | One final bill/account/payment; snapshots preserved |
| Sender eventually synchronizes original CREATE | Original payloads remain as explicit conflicts | Same recipient-materialized request IDs; no duplicate bill |

QR display or acceptance is provisional; it neither finalizes a bill nor records payment. Current server authentication/membership/device/scope checks still apply during reconciliation.

## Unsupported feature and guard disposition

| Case | Capability disposition | Rejection/handling evidence |
| --- | --- | --- |
| Custom variant options / component substitution | **NOT IMPLEMENTED** as a custom transfer model | P6-BLOCK-custom-options; P6-GUARD-component-substitution and catalogue-definition checks PASS. Supported fixed catalogue records remain separate variants. |
| Nested Family Packs / zero-component definitions | **NOT IMPLEMENTED** | P6-BLOCK-nested-pack / empty-components PASS; strict complete-snapshot allowlists reject them. |
| Reconstruct historical pack composition when the saved snapshot is missing | **NOT IMPLEMENTED** | P6-BLOCK-historical-missing-snapshot PASS; no reconstruction from today's catalogue. |
| Treat old partial cached drafts as complete pack edits | **NOT IMPLEMENTED** | P6-BLOCK-legacy-partial-draft PASS; explicit fresh revision is required while old work remains saved. |
| Offline Family Pack unit-price overrides | **NOT IMPLEMENTED** | P6-BLOCK-pack-unit-price-override PASS with actionable rejection. Bill discount/agreement work through established controls. |
| Infer pack purchase/profit/reference values from arbitrary component labels | **NOT IMPLEMENTED** | P6-GUARD-no-inferred-pack-financials PASS; null estimates and unchanged payable amount. |
| Fractional packs, loose pack units, >99 whole packs, invalid/>999 component quantities, >80 components | Outside supported limits | Named P6-BLOCK cases PASS; no truncation or reinterpretation. **Retained:** 80-component positive tests in `RUN/logs/fix-handover.log`. |
| >50 request lines / oversized signed cart | Outside supported limits | P6-BLOCK-51-request-lines / oversized-cart PASS; explicit safe-limit errors. Existing 64 KiB envelope/100-frame limits retained. |
| Missing/incompatible catalogue, changed version/variant/composition/unit/fixed price | Requires matching supported snapshot | New catalogue guard checks PASS with zero imported drafts/outbox rows; prior actual Worker Family Pack-drift rejection retained. |

These NOT IMPLEMENTED feature dispositions are intentional existing limits. They are not silently presented as supported, and safe rejection is the scenario-12 PASS criterion.

## New test index and retained evidence

| New test | Name | Result |
| --- | --- | --- |
| P6-01 | Real prepared PWA exports normal v1 and two-variant mixed v2 QR while offline | PASS |
| P6-02 | Normal-product camera stream is decoded, previewed and accepted offline exactly once | PASS — synthetic desktop camera |
| P6-03 | Mixed Family Pack camera transfer previews exact variants/components/units and accepts separately from cloud | PASS — synthetic desktop camera |
| P6-04 | Owner queues two-variant adjustments/agreement/closure/payment and reopens the PWA offline | PASS |
| P6-05 | Explicit cloud sync recovers dropped handover acknowledgement and interrupted agreement without duplicates | PASS |
| P6-06 | Expired/invalid session cannot replay an acknowledged Family Pack operation and Admin views stay redacted | PASS |
| P6-AUTH-TTL | New real expired session rejected; fresh password session allowed | PASS |
| P6-GUARD / P6-BLOCK | 30 named production-module controls, invalid inputs and unsupported cases | PASS |
| DB-PRESERVATION | Baseline plus request/receipt/claim/snapshot/payment integrity | PASS |

The 30 module checks use the **actual new signed two-variant envelope**, production protocol/catalogue/storage/financial functions and independent fake IndexedDB instances. No browser IndexedDB or Worker business data was injected or altered by those module checks. Malformed/mismatched import cases explicitly assert zero drafts and zero outbox rows. Structural-only cases test validators before any import. Two supplementary substitution/unknown-financial checks ran separately; the already passed 28 were not repeated.

Retained evidence was inspected rather than rerun:

- `RUN/http-e2e-results.json`: all 15 passing checks, including real Worker Family Pack acceptance, tampered/wrong-recipient denial, competing QR claims, competing closures, changed-membership/expired-session rejection, revision/catalogue conflicts and unchanged accepted pack snapshots after catalogue drift.
- `RUN/browser-e2e-results.json`: 14 passing earlier real-preparation/browser checks, including mixed Family Pack multipart paste verification, duplicate acceptance, offline restarts, interrupted synchronization and private shared-cache/key boundaries. Those earlier receives used pasted frames; they are not relabeled as physical scans.
- `RUN/logs/fix-handover.log`: passing named module/in-memory service tests for Admin-first and Owner-first Family Pack sync, fixed snapshots, explicit pack removal, version changes, 80 components and framing limits. Their original in-memory schema setup was **not rerun** in Phase 6.
- `RUN/p3-4d7319f8/qr-history-1793707582109.json`: signature-valid wrong recipient, removed sender and demoted recipient checks.
- `RUN/p5-218d6b5a/browser-results-1793709828200.json`: concurrent duplicate CREATE/payment/QR operations, Owner/Super Admin closure race, stale Admin edit protection and conflict preservation.

No completed phase, broad test suite or previous fixture preparation was rerun. All six added JavaScript acceptance tools pass focused lint without diagnostics. No application defect required a fix or post-fix regression run.

## Final integrity and private artifacts

Final read-only audit confirms:

- **All 3,382 pre-existing rows across 34 tables unchanged**, including prior offline/QR/Family Pack/concurrency fixtures; schema and migration records unchanged, integrity `ok`, zero foreign-key violations. Only SQLite/Cloudflare internal counters excluded.
- Exactly **2 new requests**, **8 durable operations**, **6 acknowledgements/receipts**, **2 preserved source CREATE conflicts without receipts**, **2 QR claims**, **1 finalized account**, **1 payment**, and **31 contiguous workflow events**.
- Every receipt's SHA-256 fingerprint independently matches its original immutable payload. Actor/device/scope/occurrence/receipt metadata and acknowledgement revision match the corresponding completed audit event.
- Both Family Pack snapshots, quantities 2/1, variant IDs, component ordering/quantities/unit labels and fixed prices are identical in signed transfer, saved request and active quotation. Quotation linkage uses existing stable request line IDs.
- Original quotation 163,000 paise retained; active adjusted quotation 161,700; agreed due 50,000, received 10,000, outstanding 40,000. No duplicate payment or claim after dropped-response recovery.

Evidence in `P6`:

- `state.json`, `seed.sql`, `before.sqlite`: private fixture identities and read-only baseline.
- `normal-camera.y4m`, `mixed-camera.y4m`: deterministic synthetic video made from the actual exported normal/mixed QR frames.
- `browser-progress.json`, `browser-results-1793711104949.json`: six final PASS checks, prepared profile/device evidence, camera settings/track cleanup, frame/envelope data, scoped traces, dropped-response/interruption records and preserved operation IDs.
- `guard-results-1793711178478.json`: 28 passing production-module checks.
- `guard-results-1793711402948.json`: two additional passing substitution/unknown-financial checks; earlier 28 retained.
- `expiry-1793711496181.json` and its private new-session seed SQL: actual TTL rejection 401 and fresh password-session catalogue read 200, no server-clock change.
- `preservation-1793711552391394000.json`: final preservation and complete 2-request/6-receipt/2-variant audit after the TTL probe. Earlier `preservation-1793711309363792900.json` is retained too.

Harness diagnostics are retained: `browser-results-1793710957405.json` passed P6-01–04 and synchronized the mixed chain, then incorrectly expected a quotation object in the offline-request response. Corrected the assertion to use the existing quotation endpoint. `browser-results-1793711061334.json` records a resume login-form/redirect race; resumed authenticated profiles through their context route. Final resumption retained P6-01–04 and all five already committed mixed operations, then finished only the remaining observations/normal-source synchronization. No scan, restart or committed mixed operation was recreated. An initial read-only audit assumed a nonexistent quotation `family_pack_id` column; corrected that query to join existing stable request line IDs. No schema or runtime fix was made.

Added tools: `server/scripts/offline-qr-pack-prepare.mjs`, `offline-qr-pack-browser-client.mjs`, `offline-qr-pack-video.mjs`, `offline-qr-pack-browser.mjs`, `offline-qr-pack-guards.mjs`, `offline-qr-pack-expiry.mjs`, `offline-qr-pack-db.py`. Do not rerun preparation, expire an existing session or synchronize completed/conflicting fixture work just to inspect evidence.

## Phase verdict and remaining blockers

**Desktop/local Phase 6 behavior is verified. Full Phase 6 acceptance and overall release readiness remain INCOMPLETE because physical Android camera/device testing is NOT TESTED.** No new reproducible critical application failure remains from the executed checks.

Actual Android PWA installation, optical normal/multipart Family Pack scanning, permission lifecycle, real device reconnect/reboot/storage retention and authenticated end-to-end sync must still be performed. Synthetic camera and desktop restart results cannot close that blocker. Production HTTPS/cookie/routing/runtime parity and earlier report/settings/feature-acceptance decisions retain their prior dispositions. Unsupported Family Pack features remain explicitly unavailable with passing rejection checks; no new feature was implemented in this phase.
