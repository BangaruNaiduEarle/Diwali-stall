# Android PWA preparation and validation

This extends the existing Step 6 React/Vite offline workspace. It uses the same
`diwali-offline-billing-v1` IndexedDB database and synchronization protocol.
No native wrapper, new database, migration, deployment or QR flow is required.

## What is prepared

The manifest installs **Diwali Stall Billing** in standalone mode and opens
`/admin/offline`. It includes 192px/512px PNG icons and a maskable icon with a
central safe area. The existing online routes keep their network behavior.

Vite generates the existing worker with a content-derived cache name and an exact
list of built assets, including lazy chunks, plus the manifest and icons. The
worker stores only those static resources and the public offline workspace HTML.
Preparation omits credentials, rejects redirects and missing assets, and confirms
success only after every asset and the shell are cached. Unknown assets, query
variants, API, authentication and cross-origin requests are not cached by it.
Catalogue snapshots, identities, drafts, versions and outbox records continue in
the existing scoped IndexedDB stores.

Updates wait for old app windows to close. Activation removes only old Diwali
shell caches, never IndexedDB. A release mismatch during refresh asks the user to
reload online and prepare again. An already prepared shell remains usable after
a failed refresh. Fonts and product images are not necessary for offline billing
and are not bulk cached; the workspace uses text and fallback fonts.

Preparation requests persistent storage where supported, without allowing a
permission failure to block shell preparation. Storage usage is estimated on
opening, local saves/outbox changes, window focus and every minute. Warnings appear
at 80% quota usage or less than 50 MiB remaining, and when persistence is denied.
The usage estimate covers the entire origin, not just billing.

## Local preview

Run from the repository root:

```sh
npm run test:offline
npm run lint
npm run build
npm run preview -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173/admin/offline`. Vite dev/HMR cannot prepare a durable
production shell. Preview retains the existing local API proxy configuration; an
already available local backend and authorized test account are needed for actual
stall preparation. Do not initialize databases or apply migrations for this task.

For a USB-connected Android device, Chrome DevTools **Remote devices / Port
forwarding** can map device port 5173 to computer `localhost:5173`. Open
`http://localhost:5173/admin/offline` on the phone and keep forwarding active.
Alternatively use an already available HTTPS test origin. Plain HTTP on a LAN IP
does not provide the secure context required by service workers. The phone's
localhost normally refers to the phone itself.

## Android Chrome checklist (manual)

1. Use a normal Chrome profile. Sign in to an authorized test account, choose a
   stall and season, open **Offline billing**, and prepare online. Wait for
   **Offline page reload is ready**. Confirm storage status and resolve warnings.
2. Use Chrome's three-dot menu, **Add to Home screen / Install app**, and confirm.
   Open its Diwali icon. Verify standalone display and the correct saved stall.
3. Save a request snapshot if needed. Create/edit a local draft and wait for
   **Draft saved on this device**. Queue a valid request and record its pending
   count and operation ID. Local actions remain provisional.
4. Disable internet access. On localhost port forwarding, use DevTools Offline
   mode to simulate loss of the forwarded origin; airplane mode alone may leave
   USB localhost access available. Refresh. Close all Chrome/app windows and
   reopen via the installed icon while still offline.
5. Verify catalogue, draft quantities and pending outbox count/IDs survive. Make
   another local edit, wait for save completion, and repeat refresh/restart.
   Confirm online/offline and pending/failed/synced indicators are understandable.
6. Restore connectivity. Sign in/select the same user, stall and season if needed.
   Use **Synchronize pending operations** or wait for the existing 15-second
   retry. Verify server acknowledgement, correct totals and a single server
   transaction/payment per operation. Refresh and verify acknowledged history.
7. Repeat with expired authentication and a revision conflict from another test
   tab/device. Pending work must remain until resolved explicitly. Check an
   ordinary online catalogue/admin operation for regression.
8. In remote DevTools Application, inspect Cache Storage: only shell/static assets
   should exist in the Diwali shell cache. Inspect IndexedDB for preserved scoped
   records. Test persistence denied/unsupported and storage pressure where feasible.

## Limits

Android installation and a real authenticated offline-to-online workflow require
the phone and a configured test backend; localhost HTTP checks and automated tests
cannot certify those outcomes. Automated IndexedDB tests simulate connection
reopening, not an Android OS restart. The browser can deny persistence. Clearing
site data, private mode cleanup, uninstall behavior, disk failure and device loss
can remove unsynchronized work. Never clear data to troubleshoot pending work.
Offline access is limited to the prepared workspace and explicitly saved data;
other online admin routes still require a connection. Browser connectivity status
does not prove API reachability; existing synchronization errors remain authoritative.

## Validation performed on 3 November 2026

- `npm run test:offline`: **37 passed, 0 failed**. Existing server tests use only
  disposable in-memory fixtures; no application database migration was applied.
- `npm run lint`: exit 0 with existing repository warnings. Focused lint of all
  changed JS/JSX files: exit 0 with no diagnostics.
- `npm run build`: passed; Vite reported the existing large-bundle warning.
- Production preview served at `http://localhost:5173`. HTTP smoke checks passed
  for the workspace, manifest, versioned worker, all six static resources and PNG
  dimensions. No deployment or production configuration changes were made.
- Headless desktop Chrome, using a disposable profile with API requests blocked:
  actual worker registration/cache acknowledgement, offline workspace reload, full
  browser process close/restart while offline, retained catalogue/draft quantity/
  pending count/operation ID, cache allowlist inspection and restored connectivity
  all passed. Test records were seeded through the existing storage module; this
  does not certify authenticated preparation or server synchronization on a phone.
- Android installation and authenticated end-to-end device checks were not run.

## Files changed for this task

- `index.html`, `public/manifest.webmanifest`, `public/icons/diwali-192.png`,
  `public/icons/diwali-512.png`, `public/icons/diwali-maskable-512.png`
- `vite.config.js`, `scripts/pwaShellPlugin.js`, `public/offline-billing-sw.js`
- `src/admin/components/OfflineStorageStatus.jsx`,
  `src/admin/offline/storageHealth.js`, `src/admin/pages/AdminOfflineBillingPage.jsx`
- `src/admin/offline/appShell.test.js`, `src/admin/offline/storageHealth.test.js`,
  `package.json`, `docs/ANDROID_PWA.md`
