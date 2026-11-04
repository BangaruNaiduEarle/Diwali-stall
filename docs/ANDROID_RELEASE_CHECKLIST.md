# Android release checklist — pending actual devices

No Android device was tested in the 3 November 2026 local readiness exercise. Record phone model, Android/Chrome versions, origin/build, stall, role, timestamps, request/transfer/operation IDs, expected/actual totals and result for each case. Use disposable fixtures and an authorized non-production backend.

## Setup and installation

- [ ] Use at least two Android phones with separate Admin and Owner/Super Admin Chrome profiles. Use four Admin phones for the physical concurrency check if available.
- [ ] Use a secure, reachable test origin. For the existing loopback-only rehearsal, USB debugging/port reversal may map phone `localhost:5193` and `localhost:8793` to these PC ports; this setup was not performed here. Plain LAN HTTP is insufficient for service-worker/camera testing. Do not expose or migrate production for this test.
- [ ] Sign in online, select the same authorized season/stall on both phones, and prepare both offline catalogue and secure QR handover. Confirm offline preparation completed and the intended recipients are available.
- [ ] Install using the app's install option or Chrome menu **Install app / Add to Home screen**. Confirm correct name/icon and standalone launch from the Android home screen.
- [ ] Check storage estimate/persistence status and warnings. Chrome may decline persistent storage; verify the app explains that state and remains usable.

## Offline recovery and billing

- [ ] Disconnect Wi-Fi/mobile data (and USB if it provides test-server access). Close the installed app and Chrome, reopen from its icon, and confirm offline shell/catalogue access.
- [ ] Admin creates a request containing ordinary products and a supported complete Family Pack variant. Verify pack ID/label, stable line IDs, every component ID/quantity/unit, prices and catalogue version in the preview. QR must contain no purchase price/profit/margin.
- [ ] Save/queue the request; refresh, close/reopen and reboot the phone. Verify draft and outbox IDs/values are unchanged and pending indicators are accurate. Do not clear site data.
- [ ] Generate multipart QR offline. On the second phone, allow camera permission and scan all frames, including out-of-order/duplicate frames; confirm no acceptance before the sequence is complete. Test realistic distance, glare, focus and screen brightness.
- [ ] Owner previews the complete pack and explicitly accepts provisionally offline. Repeat the scan; verify one local acceptance and one pending HANDOVER.
- [ ] Owner adjusts an ordinary product price/discount, saves an agreed amount, queues closure and records a partial payment. Confirm displayed due/balance and pending status.
- [ ] Refresh/restart/reboot offline again. All request/pack snapshots and queued IDs must survive. Confirm there is no false “paid/synchronized” state.
- [ ] Deny camera permission, then enable it in site/Android settings. Verify clear guidance, successful retry and camera shutdown when leaving/stopping scanning. Test pasted complete frames as fallback.

## Reconnection, conflicts and duplicates

- [ ] Restore connectivity and sign in if necessary. **Reselect the authorized season/stall in the online workspace**, return to Offline billing and synchronize saved operations.
- [ ] Test both Admin-first and Owner-first synchronization. Verify the same original request identity, business/stall/season, separate creator/recipient/finalizer/recorder identities and original captured pack snapshot.
- [ ] Interrupt connectivity mid-chain. Confirm acknowledged operations stay acknowledged, dependent operations stay saved, and retry uses the same IDs. Complete recovery with one bill, claim and payment.
- [ ] Repeat synchronization and QR scans after acknowledgement. Verify no duplicate bill, transfer claim, receipt or payment.
- [ ] Test HOLD/release, full and partial CASH/UPI/CARD/BANK payments against the same integer-paise expected balances.
- [ ] Expire a test session or revoke test membership after preparation. Sync must refuse unauthorized commits and preserve pending data. Restore access explicitly and retry without recreating operations.
- [ ] Change a fixture pack price/composition/unit/version after capture; remove/deactivate a component; test a different variant. Preview/server must surface the mismatch and retain the original signed/request snapshot without substitution.
- [ ] Test a large supported pack/multipart sequence, malformed/mixed frames, tampering, invalid recipient and expired preparation. Oversized/unsupported requests must fail explicitly without truncation.
- [ ] Two Owners accept the same transfer offline, then reconnect. One server claim must win; the other remains an explicit preserved conflict.
- [ ] Compete for closure; attempt stale Admin synchronization after Owner finalization. Compare local and server versions; resolve explicitly without silently losing a transaction.
- [ ] Four Admins synchronize distinct requests concurrently. Verify four distinct bills/requests, correct stalls and no cross-stall data exposure. Platform Admin must not gain operational membership implicitly.

## Sign-off

- [ ] Verify app/API/private responses never appear in shared service-worker caches; pending records remain in scoped IndexedDB.
- [ ] Record failed/unverified cases and browser-specific limitations. Confirm installed app reopening and storage retention on each phone, not only in a desktop emulator.
- [x] Fix legacy checkout retries, all 20 backend unit/scope failures and the Vite advisory; rerun affected automated and local end-to-end checks. See [the fix report](RELEASE_BLOCKER_FIXES_2026-11-03.md).
- [x] Resolve the server-tooling advisories; verify the complete online audit and required regressions. See [the server security report](SERVER_TOOLING_SECURITY_2026-11-03.md).
- [ ] Review runtime/configuration parity before release approval. Actual Android checks above remain pending.

Unsupported Family Pack scenarios remain those in [QR_HANDOVER.md](QR_HANDOVER.md#family-pack-limits-and-unsupported-scenarios): custom substitutions/nesting, incomplete historical snapshots, offline pack unit-price overrides and requests beyond documented limits.
