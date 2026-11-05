# Phase 4 — Complete Billing & Payment acceptance

**Phase 4 passes for the established local/desktop implementation: 38 acceptance rows PASS, zero FAIL, NOT TESTED or NOT IMPLEMENTED in the requested billing/payment matrix.** New execution: **18 real Worker/D1 checks**, **5 focused in-memory regression tests**, and **read-only preservation/integrity verification**, all PASS. Completed earlier suites were retained rather than rerun. No critical requested billing/payment scenario remains unverified within this scope. This is not overall release approval; outstanding device/toolchain and earlier feature-acceptance issues remain below.

Read [Multi-Stall acceptance](MULTI_STALL_ACCEPTANCE_2026-11-03.md), [Phase 3 authorization/isolation acceptance](ROLES_SEASONS_ISOLATION_ACCEPTANCE_2026-11-03.md), and [original release readiness](RELEASE_READINESS_2026-11-03.md). Also read its linked [blocker fix report](RELEASE_BLOCKER_FIXES_2026-11-03.md): the original legacy checkout duplicate defect, former unit failures and Vite advisory were already resolved there. The original report's initial failures are not treated as current failures. Saved HTTP, legacy and browser evidence still records 15/15, 6/6 and 14/14 PASS respectively; those suites were not repeated.

## Environment and safety

Same established isolated clone/disposable D1 root, abbreviated `RUN`:

```text
C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79
```

New Phase 4 evidence is `RUN/p4-8a7a5f1d`, abbreviated `P4`. The real Worker ran at `http://localhost:8793` using the existing isolated `wrangler.toml` and `persist` binding, location mode enabled and password authentication required. Five separate new identities authenticated normally: Admin A, Owner A, Super Admin A, Owner B, and a dual-stall Owner. Global account roles do not override effective memberships.

New fixtures: business `p4-8a7a5f1d-business`, Stall A `p4-8a7a5f1d-a`, Stall B `p4-8a7a5f1d-b`, three products, active `season-2026` and explicit memberships in the pre-existing archived fixture season. These permanent-location fixtures also gained a separate **new active season**, `p4-8a7a5f1d-active-season`, for testing season isolation independently of archived-write guards. No business setting or existing season was changed.

`P4/before.sqlite` was captured read-only before fixture insertion. All catalogue changes and transaction writes used only the new Phase 4 records. Original databases and production were never opened. No migrations were applied to any existing database; no deployment or Git command ran. No dependencies, configuration, application runtime, UI, offline, QR or Family Pack code changed.

Five selected fault-injection/large-integer regressions use the existing test helper's SQLite **`:memory:`** connection. Their disposable in-memory schemas are constructed from migration SQL; no existing database or Worker persistence directory is used by those tests. The server default integration/test lifecycle was not invoked.

## Complete billing/payment acceptance matrix

`P4-nn` names refer to the new real Worker checks indexed below. `MEM-*` refers to selected in-memory regressions. **Retained** means saved earlier evidence, not a fresh execution or a code-only inference.

| # | Scenario | Result | Test names / evidence |
| --- | --- | --- | --- |
| 1 | Admin creates requests | **PASS** | P4-01: authenticated Admin checkout persists a new request and quotation with creator identity. |
| 2 | Admin adds/removes products | **PASS** | P4-01: adds the second product, then removes it; expected final items and add/remove events remain. |
| 3 | Quantity changes and stable line IDs | **PASS** | P4-01/03: retained product quantity 1 → 3 → 2; same `lineId` survives, quotation references it; SQL audit independently confirms it. |
| 4 | Customer details and request history | **PASS** | P4-01: name, mobile, area and note round-trip; history has contiguous revisions, creation/item/quotation events and scoped actors. |
| 5 | Online handover to authorized Owner | **PASS** | P4-03: Admin assigns Owner A; invalid Admin/other-stall recipients return 400; missing assignment revision returns 428. |
| 6 | Online handover to authorized Super Admin | **PASS** | P4-18: Admin checkout atomically records Super Admin recipient/assignment; Owner later finalizes. MEM-HANDOVER rejects a recipient revoked during commit with no partial checkout. |
| 7 | Revision checks and stale-update rejection | **PASS** | P4-03: stale item adjustment and agreed-amount write each 409; history and recipient edits unchanged. P4-08/11: conflicting payment revision 409; missing revision 428. |
| 8 | Creator, recipient and actor history | **PASS** | P4-03/06/18 and SQL: Admin creator, separate Owner/Super Admin recipient, assigning Admin and distinct finalizer retain their own identities. |
| 9 | Admin cannot change selling prices or discounts | **PASS** | P4-02: bill unit override/discount 403. P4-16: both catalogue selling-price field aliases 403; catalogue price unchanged. |
| 10 | Admin cannot modify purchase/profit/margin or finalize | **PASS** | P4-02: financial aliases, agreement and finalize rejected 403; purchase/private-rate GET/PUT rejected 403; no audit side effects. |
| 11 | Owner/Super Admin permitted financial adjustments | **PASS** | P4-03/05: Owner unit 9,999 paise/discount 101, then Super Admin unit 9,901/discount 103; exact customer totals 19,897 and 19,699. |
| 12 | Original catalogue prices and adjustment history preserved | **PASS** | P4-05 plus SQL: original item and original quotation unit remain 10,001 despite new-fixture catalogue change to 99,999; old/new adjusted values remain in history, original quotation retained. |
| 13 | Final Price + ₹500 stays reference-only | **PASS** | P4-05: preview reference equals final subtotal + 50,000 paise; finalized/payment due remains explicit 12,345 paise. P4-06/07: separate bill due 18,007 equals exact received sum. **Retained:** prior browser offline bill due ₹500, received ₹100, outstanding ₹400; reference is not added. |
| 14 | Purchase/profit never leak to Admin | **PASS** | P4-02: request, quotation, history, payment and product responses exclude purchase/profit/margin/final-subtotal/bargaining-floor fields. P4-05 positively verifies privileged purchase/profit estimates so this is not an empty-data-only redaction test. **Retained:** P3-OFFLINE-01 and P2 browser role controls. |
| 15 | Owner and Super Admin finalization | **PASS** | P4-06: Super Admin closes the Owner-recipient request; P4-18: Owner closes Super Admin-recipient request. Other Phase 4 Owner bills finalize independently. |
| 16 | Final bill belongs to selected business/stall/season | **PASS** | P4-06/12 and SQL: every fixture request, quotation, finalized account, ledger and workflow event has the expected selected scope; B's bill remains independent. |
| 17 | Separate creator, handover recipient and finalizer | **PASS** | P4-06: Admin creator → Owner recipient → Super Admin finalizer. P4-18 verifies the reciprocal privileged roles. SQL checks the distinct persisted fields. |
| 18 | Duplicate checkout retry returns original result | **PASS** | P4-04: same key returns same request without overwriting recipient adjustments; altered input returns 409. Four simultaneous same-key calls commit one request/quotation. P4-18 retry preserves finalized bill. **Retained:** six passing fixed legacy-mode checks, including lost-delivery recovery. |
| 19 | Different legitimate checkouts remain independent | **PASS** | P4-04: same customer/items with distinct keys produce distinct request/quotation identities; SQL confirms all 15 expected requests, exactly one active quotation each, no unexpected requests. |
| 20 | Unpaid finalized balance | **PASS** | P4-06: finalized 18,007-paise account starts UNPAID, received 0, outstanding 18,007, no entries; finalization requires no payment. |
| 21 | Full payment | **PASS** | P4-09: one 12,345-paise payment reaches PAID; five concurrent retries retain one ledger entry. P4-14: offline sync fully settles another bill. |
| 22 | Partial payment | **PASS** | P4-07: first 1,000-paise receipt leaves 17,007 outstanding and PARTIAL; each later receipt produces the expected balance. |
| 23 | Multiple entries and all five methods | **PASS** | P4-07: CASH 1,000; UPI 1,001; CARD 1,002; BANK 1,003; OTHER 14,001 paise. Received sum 18,007, outstanding 0, payment count 5; HOLD/release remain separate entries. |
| 24 | HOLD without payment | **PASS** | P4-07: zero-amount HOLD gives HOLD state with received 0, unchanged due/outstanding and payment count 0; RELEASE_HOLD is independently recorded. P4-17: fully paid HOLD rejected 409. |
| 25 | Later payments after closure | **PASS** | P4-07: all five receipts arrive after closure; request remains closed. P4-17 rejects pre-finalization payment with 409. |
| 26 | Correct outstanding balances | **PASS** | P4-07/08/13 and SQL: account due minus PAYMENT sum equals outstanding for every new bill; hold entries do not receive money; no negative outstanding. |
| 27 | Recording mode independent of payment method | **PASS** | P4-07 alternates ONLINE/OFFLINE recording over the five methods. P4-14 uses actual offline synchronization with OTHER. P4-11 rejects ONLINE-as-method and CASH-as-mode with 400. |
| 28 | Payment history, actor and device metadata | **PASS** | P4-07/14: actor ID/role, terminal/device, occurrence/receipt timestamps, mode/method preserved. SQL matches actor names and every ledger row to its workflow event; pagination retains complete balance. |
| 29 | Duplicate payment retries | **PASS** | P4-07/09/14: original payment/operation acknowledged without another entry or event, even with obsolete revision. Altering payment details under the same operation ID returns 409. |
| 30 | Concurrent payment submissions | **PASS** | P4-08: distinct 7,001-paise submissions sharing one revision yield 201/409, received 7,001, outstanding 3,000; overpaying retry 400. P4-09: five identical submissions yield one 201 and four 200 replays. |
| 31 | Admin payment restrictions | **PASS** | P4-11: Admin PAYMENT and HOLD each 403, no entries/events/balance changes. **Retained:** Phase 3 rejects captured privileged offline operations after demotion. |
| 32 | Cross-stall payment read/write rejection | **PASS** | P4-12: dual-stall Owner uses legitimate B context with A request ID and vice versa; both GET/POST return 404, B balance unchanged. |
| 33 | Cross-season payment read/write rejection | **PASS** | P4-15: explicit Owner membership in another **active** season still yields 404 for foreign GET/POST. P4-12 also verifies historical GET 404 and archived POST 403. |
| 34 | Atomic business operations and audit events | **PASS** | SQL: all 122 workflow revisions contiguous, all 14 ledger entries paired one-to-one with matching audit scope/actor/device/time/payment IDs. MEM-WORKFLOW and MEM-PAYMENT inject audit failures and verify complete rollback. MEM-HANDOVER verifies no partial checkout after recipient revocation. Existing real-D1 batch rollback evidence is retained. |
| 35 | Integer-paise calculations and rounding | **PASS** | P4-05/07/13: exact odd-paise prices, discounts, decimal agreement and 1-paise settlement. Loose price follows existing floor rule: floor(25,003 / 3) = 8,334; quantity 2 totals 16,668. P4-11 rejects fractional/unsafe amounts; MEM-MAX settles MAX_SAFE_INTEGER exactly. |
| 36 | Unique operation/payment IDs; no duplicate bills/payments | **PASS** | P4-04/09/10/14 and SQL: unique complete checkout identities, one payment for concurrent same operation, global operation-ID reuse 409; normalized electronic reference reuse with a new operation ID also 409. |
| 37 | No silent overwrites | **PASS** | P4-03/04/08/09: stale adjustments/agreements rejected, checkout retry retains recipient edits, racing payment loser cannot overwrite winner, changed same-operation input conflicts. Failed probes leave history unchanged. |
| 38 | Historical/pre-existing records remain intact | **PASS** | Final read-only preservation: all **2,818 pre-existing rows across 34 tables unchanged**, including previous multi-stall/offline/QR/Family Pack fixtures; schema/migration records unchanged; integrity `ok`, zero foreign-key violations. |

Counts are scenario rows, not unique automated tests. The 18 HTTP checks combine related matrix rows; the five regressions supplement failure paths rather than multiplying acceptance scenarios.

The [machine-readable acceptance matrix](BILLING_PAYMENT_ACCEPTANCE_2026-11-03.json) records all 38 dispositions and evidence references.

## New test index

| Test | Name | Result |
| --- | --- | --- |
| P4-01 | Admin request preserves customer details, stable line IDs and quantity/add/remove history | PASS |
| P4-02 | Admin financial aliases are rejected and read/history surfaces redact sensitive estimates | PASS |
| P4-03 | Authorized online handover and recipient edits resist stale updates and retry overwrites | PASS |
| P4-04 | Checkout replay preserves recipient edits; distinct and simultaneous legitimate operations stay independent | PASS |
| P4-05 | Permitted adjustments preserve catalogue snapshots and reference-only Final Price plus 500 | PASS |
| P4-06 | Separate Super Admin finalization freezes agreed due with creator/recipient/finalizer history | PASS |
| P4-07 | HOLD without payment and later five-method ONLINE/OFFLINE entries have exact balances and metadata | PASS |
| P4-08 | Concurrent payments with distinct IDs cannot overwrite revision or overpay | PASS |
| P4-09 | Same-operation concurrent retries and lost delivery produce one ledger entry and event | PASS |
| P4-10 | Operation identity and normalized transaction references cannot be reused for another bill | PASS |
| P4-11 | Payment validation rejects fractional/unsafe/negative values, mode-method confusion and missing revisions | PASS |
| P4-12 | Authorized cross-stall and historical-season contexts cannot read or pay a foreign bill | PASS |
| P4-13 | Loose-piece price flooring and decimal agreement preserve exact integer paise | PASS |
| P4-14 | Real offline synchronization records device/mode/payment method independently and replays once | PASS |
| P4-15 | A second active season cannot read or write the first season payment account | PASS |
| P4-16 | Admin catalogue selling-price edits are denied for both field aliases | PASS |
| P4-17 | Unfinalized requests cannot receive money and a fully paid bill cannot acquire a HOLD | PASS |
| P4-18 | Admin checkout hands over atomically to Super Admin and a separate Owner finalizes | PASS |

The P4-09 test name includes lost delivery: this run verifies recovery by reusing an already committed operation with obsolete revision after concurrent submissions; it does not physically interrupt that HTTP response. Actual aborted checkout response and interrupted browser synchronization recovery are **retained** from the legacy fix/browser evidence. P4-14 calls the real offline synchronization API with a registered device; it does not repeat the completed browser restart/QR capture workflow.

Five focused regressions, **5 PASS / 0 FAIL / 35 skipped by name filter**:

- **MEM-HANDOVER:** `billAdjustmentsHandover.test.js` — `invalid or concurrently revoked handover recipients leave no partial checkout`.
- **MEM-PAYMENT:** `requestPayments.test.js` — `payment history and accounts are immutable; audit failures roll back the payment`.
- **MEM-MAX:** `requestPayments.test.js` — `integer paise balances remain exact at the safe-integer limit`.
- **MEM-SEASON:** `requestPayments.test.js` — `another authorized operating season cannot read or pay a previous season request`.
- **MEM-WORKFLOW:** `requestWorkflowHistory.test.js` — `history is append-only and audit failure rolls back the corresponding business operation`.

Command:

```text
node --test --test-concurrency=1 --test-name-pattern='history is append-only and audit failure|payment history and accounts are immutable|invalid or concurrently revoked handover recipients|integer paise balances remain exact|another authorized operating season' server/tests/requestWorkflowHistory.test.js server/tests/requestPayments.test.js server/tests/billAdjustmentsHandover.test.js
```

Focus lint passed without diagnostics for both added JavaScript harnesses. No runtime defect was reproduced, so no application fix or broader post-fix regression run was required. The existing desktop/QR/Family Pack suites were not rerun against their saved fixtures.

## Persisted integrity results

Read-only verification uses only `P4/before.sqlite` and the manifest-verified disposable D1. It confirms:

- Exactly **15 expected new requests**; no extra checkout from same-key retries. Each has exactly one active quotation; older quotation snapshots remain available.
- **122 workflow events**, scoped correctly and contiguous from revision 1 through each request's current revision.
- **14 ledger entries**, including HOLD/release; each has exactly one matching payment audit event with the same scope, actor, name, role, device, occurrence/receipt timestamps and payment metadata.
- Every finalized account matches its selected business/location/season and active quotation's agreed amount. Every received sum, payment count and outstanding balance matches the ledger.
- One offline PAYMENT sync receipt corresponds to exactly one ledger entry. No duplicate receipt/payment was introduced by replay.
- Original lifecycle quotation and request item units remain **10,001 paise**, with the stable line ID preserved, despite later catalogue/negotiated-price changes.
- All **2,818 rows** that existed before this phase remain unchanged across 34 tables, excluding SQLite/Cloudflare internal counters. Schema and migration records unchanged; integrity `ok`; zero foreign-key violations.

## Evidence and resumption

Private artifacts in `P4`:

- `before.sqlite`, `state.json`, `seed.sql`, `alternate-active-season.sql`: baseline and isolated fixtures. Credentials remain private.
- `http-progress.json`: current checkpoint, sanitized HTTP status/error trace, named PASS results, fixture transaction identities and retained harness-attempt diagnostic.
- `http-results-1793708210792.json`: first 14 passing HTTP checks.
- `http-results-1793708270205.json`: retains those checks plus new active-season check, 15 PASS.
- `http-results-1793708382792.json`: final **18 PASS**, retaining completed results while executing only new/unfinished checks.
- `preservation-1793708318536535700.json`: intermediate verification, 14 expected requests/114 events before the final Super Admin handover case.
- `preservation-1793708404762214400.json`: final verification, **15 requests / 122 events / 14 ledger entries**, plus full pre-existing-row preservation.
- `focused-regressions-summary.json`: five selected passing test names, command and counts transcribed from the observed test-run output; a summary rather than a raw TAP transcript.

A first P4-10 harness expectation received 400 instead of the expected 409: it reused a 12,345-paise payment against a bill owing only 10,001, so overpayment validation correctly ran before database operation uniqueness. The corrected probe reuses the operation ID with a valid 1-paise amount and receives 409. This diagnostic remains in `priorAttempts`; it is not an application failure and no application authorization/validation was relaxed. P4-01 through P4-09 were retained, not restarted. Subsequent additions likewise retained all completed PASS checks.

Retained source evidence is in `RUN/http-e2e-results.json`, `RUN/fix-legacy-http-results.json`, `RUN/browser-e2e-results.json`, Phase 2's `p2-d8b31a19` and Phase 3's `p3-4d7319f8`, as indexed in the preceding reports. No stored passwords/cookies/device secrets were reused from old identities; only new Phase 4 users authenticated during new execution. No private credentials, session cookies or device tokens are copied into this report.

Added tooling: `server/scripts/billing-payment-prepare.mjs`, `billing-payment-http.mjs`, and `billing-payment-db.py`. Preparation refuses to overwrite the saved phase pointer/snapshot; the HTTP harness retains completed checks. Do not recreate fixtures or rerun completed business scenarios just to inspect results.

## Unresolved issues and release disposition

No reproducible release-blocking billing/payment defect was found in this phase. All requested local billing/payment rows have verified dispositions. The phase does not broaden or implement unsupported reports/settings, customer directories, quantity ledgers, or Family Pack models.

These earlier release limits remain unresolved and were **not re-audited or retested** here:

- Physical Android install/camera scanning, device storage/reboot retention and mobile-network behavior. Existing desktop offline/QR/browser evidence remains valid for its stated scope.
- Server development-toolchain advisory findings documented in the blocker fix report. No dependency upgrade or new registry audit was performed in Phase 4.
- The isolated Worker's earlier compatibility-date/runtime parity limit and lack of production HTTPS/cookie/routing acceptance.
- Phase 2's unavailable standalone reports/stall settings and associated feature-acceptance decisions. These are not silently promoted to billing/payment PASS.

The older `REQUEST_BILL_ADJUSTMENTS.md` contains pre-ledger wording saying payments/HOLD are not implemented. The implemented ledger and observed Worker results supersede that statement; no feature was added to address it during this phase.

**Phase 4 billing/payment acceptance is verified within the existing local/desktop scope. Overall final release readiness remains conditional on the unresolved earlier items above.**
