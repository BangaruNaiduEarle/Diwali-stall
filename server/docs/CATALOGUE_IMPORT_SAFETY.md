# Legacy catalogue importer safety

`scripts/import-catalogue-local.mjs` is now disposable-only. The old argument-free
`npm run catalogue:import:local` fails before accessing D1. It cannot select the
repository configuration, normal local persistence or a remote database.

Supply an existing absolute `--workspace` under the system TEMP directory, outside
the repository. The script creates/verifies a standalone `import.wrangler.toml`
with binding `DB_IMPORT`, dummy database ID
`11111111-1111-4111-8111-000000000004`, and explicit workspace `persist` directory.
Persistence links and hard-linked files are rejected. Use only a disposable copy,
never a link to an original DB. Copying/bootstrap/seeding is a separately reviewed
step; the importer does not apply migrations or prepare a schema.

The installed Wrangler is invoked via Node with `shell: false`, workspace cwd,
and explicit `--local --config ... --persist-to ...`. No `npx`, implicit config,
remote flag, environment selection or target override is accepted. Read-only
schema inspection through Wrangler can still create disposable bookkeeping files.

Example from the repository root, after a disposable target has been prepared:

```powershell
$workspace = 'C:\Users\naidu\AppData\Local\Temp\catalogue-import-reviewed-case'
node server/scripts/import-catalogue-local.mjs --workspace $workspace --input server/data/catalogue-import.json --reviewed-scope "$workspace\scope.json"
# Review the generated plan. Only after reviewing the input, scope and overwrites:
node server/scripts/import-catalogue-local.mjs --workspace $workspace --input server/data/catalogue-import.json --reviewed-scope "$workspace\scope.json" --apply --confirm-upsert
```

The first command plans only. It writes unique SQL evidence under the workspace,
never `server/data/generated/`. Neither command changes input or reviewed scope.

A location-enabled schema requires a manually reviewed JSON scope:

```json
{
  "formatVersion": 1,
  "workspace": "C:\\Users\\naidu\\AppData\\Local\\Temp\\catalogue-import-reviewed-case",
  "inputSha256": "<SHA-256 of exact input file bytes>",
  "reviewedBy": "<reviewer attribution>",
  "businessId": "<explicit business>",
  "locationId": "<explicit location>",
  "seasonId": "<authorized operating season / new catalogue provenance>"
}
```

`workspace` must equal the resolved real workspace path. This is a review manifest,
not cryptographic proof of reviewer identity; the script never generates approval.
Missing, mismatched, inactive or incomplete business/location/season associations
fail. No season-to-location inference occurs. Existing location catalogue rows may
retain earlier provenance; updates never rewrite ownership or provenance. New rows
receive the explicit location and season.

Pre-location schemas with season columns instead require explicit
`--legacy-season-id`; updates/categories must belong to that season. Original
pre-season schemas support non-destructive product UPSERTs without that option.
Neither mode permits importing `season-2099`, known legacy test IDs `TEST-*`,
`P900/P901/P902/P903/P905/P906`, or updating NULL-owned rows in location mode.

## SQL inventory and guarantees

Removed all eight cleanup statements: the `TEST-*` delete, six individual
`P900/P901/P902/P903/P905/P906` deletes, and `DELETE ... WHERE id NOT IN (...)`.
There is no product deletion, archive, category creation or dependent-row cleanup.

The only writes are one `INSERT INTO products ... ON CONFLICT(id) DO UPDATE` per
input product, gated by `--apply --confirm-upsert`. Existing authorized rows update
category, name, pack, description, featured, stock status, active, sort order,
images, company and updated_at. Price columns, IDs, creation dates, existing
ownership/provenance and all other tables are untouched. This confirmation is
required because replacing existing field values can discard manual edits.

Each write checks category ownership, active context and conflicting global IDs
inside SQL. Foreign/NULL-owned ID conflicts fail via the existing NOT NULL
category_slug constraint, rather than silently skipping or taking ownership.
Global product IDs and category slug constraints remain unchanged.

SQL has no explicit transaction control. In-memory SQLite tests verify SQL guards
and rollback inside an explicit fixture transaction; CLI tests intercept Wrangler
and verify targeting. They do not prove Wrangler/D1 runtime batch atomicity for
this importer. A separate authorized disposable D1 run is required before relying
on that behavior. Do not repurpose this tool as a production importer.

Run focused tests directly (no npm migration prehooks):

```powershell
node --test server/tests/00-catalogueImportLocal.test.js
```
