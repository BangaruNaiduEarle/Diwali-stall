# Server tooling security remediation — 3 November 2026

**All six server audit findings are resolved.** The complete online server audit now exits 0 with zero vulnerabilities, including development dependencies. Backend 286/286, scope 420/420, payment/QR/Family Pack/checkout 138/138 and offline 37/37 regressions pass. Three additional tooling compatibility tests pass on the existing Node 20.20.0 installation.

This is not project release approval: the actual Android device checklist remains pending. No production access, deployment, Git commands, application features, existing D1 writes or migration changes occurred.

## Findings and dependency paths

The six findings represent **six vulnerable packages**, not six distinct GHSAs. Four leaf packages account for 35 underlying advisory entries; Wrangler and Miniflare inherit their findings.

All paths below start at `server`. Only Wrangler is a direct development dependency. `jose`, the server's direct production dependency, was unaffected and unchanged.

| Package / path | Before | Audit affected range | After | Resolution |
| --- | --- | --- | --- | --- |
| `wrangler` (direct dev) | 4.85.0 | `4.16.0–4.113.0` plus old prereleases, inherited | **4.85.0**, unchanged | Its esbuild/Miniflare dependency findings are cleared by patched children |
| `wrangler → miniflare` (transitive dev) | 4.20260424.0 | `3.20250204.0–5.20260801.0-alpha` plus old prereleases, inherited | **4.20260424.0**, unchanged | Its sharp/undici/ws dependency findings are cleared |
| `wrangler → esbuild` (transitive dev, low) | 0.27.3 | `>=0.27.3 <0.28.1` | **0.28.1** | First patched release; Windows dev-server file-read advisory GHSA-g7r4-m6w7-qqqr |
| `wrangler → miniflare → sharp` (transitive dev, high) | 0.34.5 | Three advisories: `<0.35.0`, `<0.35.4`, `<0.35.5` | **0.35.5** | First stable release fixing all three inherited libvips/libheif/librsvg advisory groups |
| `wrangler → miniflare → undici` (transitive dev, high) | 7.24.8 | Combined `7.0.0–7.30.0`; individual ranges in inventory | **7.30.1** | First version fixing all 29 reported TLS, HTTP/cookie/cache and denial-of-service advisories |
| `wrangler → miniflare → ws` (transitive dev, high) | 8.18.0 | Memory disclosure `<8.20.1`; fragment exhaustion `<8.21.0` | **8.21.0** | First version fixing both GHSA-58qx-3vcg-4xpx and GHSA-96hv-2xvq-fx4p |

Every advisory ID, exact affected range, title and source link is listed in [the full advisory inventory](../server/reports/tooling-security-2026-11-03/ADVISORIES.md). The complete original registry response is also retained; no findings are suppressed or omitted.

## Remediation decision and compatibility

The audit suggested Wrangler 4.156.2. Registry inspection showed both 4.114.0 and 4.156.2 require Node ≥22; 4.156.2 also selects Miniflare 5 beta. Adopting those versions would change the installed Node/runtime setup rather than supply the smallest compatible patch. No Node upgrade, Wrangler major upgrade or Miniflare major/beta upgrade was needed.

Added four exact overrides, restricted to the server toolchain:

```json
{
  "wrangler": { "esbuild": "0.28.1" },
  "miniflare@4.20260424.0": {
    "sharp": "0.35.5",
    "undici": "7.30.1",
    "ws": "8.21.0"
  }
}
```

Wrangler remains `~4.85.0` / installed 4.85.0, Miniflare remains 4.20260424.0 and workerd remains 1.20260424.1. Existing server scripts and engine declaration are unchanged. No `npm audit fix --force`, dependency removal, vulnerability ignore list or artificial package metadata change was used.

The selected minimum Node versions are esbuild ≥18, sharp ≥20.9.0, undici ≥20.18.1 and ws ≥10. The existing installed Node 20.20.0 satisfies them. Undici already required ≥20.18.1 before the change, so the practical Node requirement has not increased.

Sharp's necessary 0.34→0.35 update removes deprecated APIs and Node 18 support. Reviewed [its 0.35.0 changes](https://sharp.pixelplumbing.com/changelog/v0.35.0/) against Miniflare's actual calls: constructor options `{}`, metadata, rotation, resize and standard image output. Miniflare does not use the removed options/properties. The [0.35.5 release](https://sharp.pixelplumbing.com/changelog/v0.35.5/) supplies the updated native library bundle. Compatibility was then verified by executing these operations through Miniflare, not merely by obtaining a clean audit.

These overrides deliberately replace upstream dependency pins/ranges. This exact project combination is tested on Node 20.20.0/Windows x64; it is not a new upstream Wrangler release. Keep the compatibility tests when changing the toolchain. A future Node/Wrangler upgrade should review whether these overrides can be removed.

## Lockfile review

Compared every package entry against a saved pre-change lockfile:

- Four intended JavaScript package version changes: esbuild, sharp, undici, ws.
- Their required native/platform packages changed too: esbuild platform binaries, sharp platform binaries, and sharp-libvips packages 1.2.4→1.3.4.
- Two new optional sharp platform entries: FreeBSD WASM and WebContainers WASM, both 0.35.5.
- **54 version-changed entries, two added entries, zero removed entries, zero unrelated changes and zero metadata changes on otherwise unchanged entries.**
- Wrangler, Miniflare, workerd, jose, tslib and all other dependency versions remain unchanged.

An intermediate npm resolution introduced an unwanted `diwali: file:..` parent-project link and advanced optional tslib. Both were detected and removed. Regenerated from the saved lockfile, retained compatible tslib 2.8.1, and verified that neither change remains. No frontend dependency link is present in the final server lockfile.

`npm ci --ignore-scripts --dry-run` succeeds against the final lockfile. Installation skipped lifecycle scripts; native dependencies were loaded/executed successfully by the compatibility tests. The prior isolated development Worker was stopped so it would not retain a loaded old esbuild executable.

## Validation

| Check | Result |
| --- | --- |
| Complete registry server audit, explicit online mode | **0 vulnerabilities**, exit 0 |
| `npm ls --all --json` | Valid installed dependency tree; selected overrides applied |
| Wrangler CLI startup / `--version` | 4.85.0 on Node 20.20.0 |
| Actual `wrangler dev --local` bundling/startup | Pass; three `/health` requests returned 200, no D1 binding |
| `npm ci --ignore-scripts --dry-run` | Pass; no installed files replaced by the dry run |
| Safe backend unit script | **286/286 pass** |
| Stall/season/platform scope group | **420/420 pass** |
| Payment, workflow, QR, Family Pack and atomic checkout regressions | **138/138 pass** |
| Offline synchronization, storage and PWA regressions | **37/37 pass** |
| New tooling compatibility tests | **3/3 pass** |
| Focused lint on new test | Pass, no diagnostics |
| Original local D1 main/WAL hashes | Match the prior verified backup, all three SQLite files |

The new compatibility tests:

1. Bundle the actual application Worker with patched esbuild, start its output in workerd/Miniflare and make repeated local `/health` requests using patched undici.
2. Perform a real WebSocket upgrade/message/close through Miniflare/workerd using patched ws.
3. Execute Miniflare image-info and resize/output with patched sharp's native binaries for PNG, JPEG, WebP and AVIF; validate the resulting dimensions.

All tooling tests explicitly disable persistence and configure **no D1 binding**. No existing database, migration runner or production configuration is loaded. The existing isolated D1 billing harness was intentionally not run because it writes fixture transactions and this task prohibits changes to existing D1 databases.

A final real Wrangler CLI smoke also bundled and served the actual Worker on `127.0.0.1:8797` with a dedicated test configuration, no D1 binding, and a separate new smoke-state directory. All three health requests passed; that temporary server was stopped afterward. This checks Wrangler's own esbuild/plugin pipeline in addition to the in-memory compatibility tests. Evidence: `cli-smoke-results.json`.

Used `npm --prefix server run test:unit`, which does not invoke the dangerous default `pretest` migration hook. The scope group uses the same file selection as the prior 420-test baseline. Checkout idempotency tests are included in the 138-test handover group and legacy Quick Bill tests in the 286-test backend group; suite counts overlap and should not be summed.

Frontend dependencies, shared application source and frontend configuration did not change. The conditional frontend build was therefore not repeated; server Worker bundling was directly tested instead. No application behavior or authorization checks were modified.

## Evidence and changed files

Evidence directory: `server/reports/tooling-security-2026-11-03/`. It contains the before/after audits and trees, saved baseline lockfile, final lockfile diff, complete advisory inventory, install/clean-install logs, test logs, original-D1 hashes and machine-readable results. These files contain dependency/test evidence, not credentials or business rows.

Changed implementation/validation files:

- `server/package.json`: four scoped patched dependency overrides.
- `server/package-lock.json`: resolved patched packages and required platform binaries.
- `server/tests/serverToolingCompatibility.test.js`: new in-memory tooling regression tests.
- `docs/SERVER_TOOLING_SECURITY_2026-11-03.md`: this report.
- `docs/RELEASE_BLOCKER_FIXES_2026-11-03.md`: follow-up pointer to resolved server findings.
- `docs/ANDROID_RELEASE_CHECKLIST.md`: mark server security work complete; retain device/runtime sign-off items.
- `server/reports/tooling-security-2026-11-03/*`: supporting evidence.

No unresolved audit finding or automated regression failure remains from this task. Actual Android installation/camera/storage/restart checks and deployment/runtime parity sign-off remain outside these verified results; the project is not declared release-ready.
