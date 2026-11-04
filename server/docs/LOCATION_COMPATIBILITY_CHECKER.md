# Location compatibility checks for 0020 rehearsal

The checker opens only an explicitly supplied local SQLite file using `mode=ro`
and `query_only`. It prints JSON to stdout; it does not save files, run migrations,
invoke Wrangler, or access remote D1. Python 3 with standard-library SQLite is required.

Preserve these inputs unchanged:

- `server/reports/location-compatibility-baseline-2026-11-01.json`: approved season fingerprints, original schema metadata and expected counts.
- `server/reports/location-comparison-snapshot-pre-0020-2026-11-01.json`: historical v1 original-column fingerprints, including global settings, internal tables and records outside 2026.

The saved snapshot contains 22 tables: 20 application tables, `sqlite_sequence`,
and Cloudflare's `_cf_METADATA`. Validate its original checksum before deriving
an application-only view **in memory**. Never rewrite or re-seal either input.
The historical full-schema hashes must still agree between the two saved inputs;
they are not compared with the current application's schema hash.

One case-insensitive, literal-prefix rule excludes names starting with `_cf_`.
Schema objects are excluded if either their name or owning table matches, including
neutral-named indexes/triggers belonging to platform tables. Their table columns
and data are not inspected or fingerprinted. Application FKs and integrity checks
remain enabled; platform tables are excluded from those logical checks too.
All other tables remain covered, including `sqlite_sequence`, extra application
tables, global settings and unmapped records. No general `sqlite_`/underscore
exemption is applied. Sequence changes beyond the exact permitted migration-counter
advance still fail, including changes caused by other AUTOINCREMENT activity.

New snapshots use `--database <local-file> --snapshot`. Capture before schema changes;
do not overwrite either saved input. All columns, SQLite types and duplicate rows
participate in deterministic hashes; raw rows, SQL definitions and default literals
are never exported. Column/schema-object names are metadata, not row contents.
Schema SQL and default expressions are represented by hashes.

New audits and snapshots use `formatVersion: 2`, `schemaScope: "application"`;
row hashing remains `sha256-sqlite-typed-rows-v1`. Existing v1 artifact pairs remain
supported unchanged. Pair new v2 snapshots with matching v2 audit baselines, using
new filenames only. Mixed-version pairs fail closed: the old aggregate full-schema
hash cannot be converted into an application-only hash. The saved companion's
retained per-object SQL hashes provide pre-0020 schema verification instead.

To verify unchanged **pre-0020** state with the existing saved artifacts:

```powershell
node server/scripts/audit-location-compatibility.mjs `
  --database "C:\path\to\explicit-local-d1.sqlite" `
  --verify-pre-0020 "server/reports/location-comparison-snapshot-pre-0020-2026-11-01.json" `
  --baseline "server/reports/location-compatibility-baseline-2026-11-01.json"
```

This checks retained original columns, FKs, schema-object descriptors, all row
counts/hashes and both baseline seasons. No new schema objects, ownership columns,
migration entries or sequence changes are allowed. Platform-only changes are
ignored. Success is `compatible: true`, `readOnly: true`, no violations and exit 0.
No schema policy is needed or accepted in this mode. Do not compare whole snapshot
checksums to verify current state; the historical snapshot includes platform data.

After a separately authorized disposable rehearsal, compare with both inputs:

```powershell
node server/scripts/audit-location-compatibility.mjs `
  --database "C:\path\to\disposable-post-0020.sqlite" `
  --compare "server/reports/location-comparison-snapshot-pre-0020-2026-11-01.json" `
  --baseline "server/reports/location-compatibility-baseline-2026-11-01.json" `
  --schema-policy "C:\path\to\independently-reviewed-schema-policy.json"
```

The policy must contain exactly:

```json
{
  "formatVersion": 2,
  "schemaScope": "application",
  "migration": "0020_business_location_foundation.sql",
  "schemaSha256": "<64 lowercase hexadecimal characters from independent schema review>"
}
```

This hash covers post-0020 `sqlite_master` rows `(type,name,tbl_name,sql)` ordered
by `type,name`, **after** excluding `_cf_` object names or owning table names using
the rule above. Serialize the retained rows as compact ASCII-escaped JSON row arrays
and hash using SHA-256, exactly as the checker's Python `digest` function does.
It is not the database file hash or a hash of the per-object descriptors.
Review all table definitions, original constraints, nullable ownership FKs, indexes
and lifecycle/rate triggers. Missing/wrong scope, legacy v1 full-schema policies,
extra policy fields and mismatched schema hashes fail closed. Existing full-schema
approvals require independent review under the new scope.
The candidate schema hash in comparison output is evidence for review, never
automatic approval. This tool cannot establish that a human reviewed a policy.

Comparison requires the baseline and companion metadata/counts to agree, then:

- Verifies every retained original column and record against the companion snapshot,
  including all 20 application tables and `sqlite_sequence`. Original FKs and schema
  objects remain strict; the policy pins the seven permitted table alterations and
  every retained post-0020 index, view, trigger and new table definition.
- Rebuilds both season fingerprints using baseline columns, including child records,
  memberships and shared identities. Missing baseline cannot silently weaken this check.
- Requires only the expected 0020 migration-history addition; existing entries and
  timestamps remain unchanged. Only its exact expected AUTOINCREMENT advance is allowed.
- Checks 2026 ownership against baseline counts: categories 14, products 162,
  packs 6, private rates 161, purchase rates 180, requests 67, quotations 66,
  location memberships 3. Fixture baselines may have smaller counts.
- Requires every non-2026 ownership value to remain NULL, including 2099; requires
  exactly the initial business/location/2026 association and matching 2026 memberships.
- Checks rate/product and quotation/request scope consistency, FKs and SQLite integrity.

Exit codes: `0` passed/captured, `1` input/inspection failure, `2` comparison violations.
Failure reports contain codes, metadata subjects and counts, not offending row values.
An approved schema hash cannot override data/ownership failures.

Saved hashes are preservation evidence, not backups or signatures. They cannot prove
the historical completeness of a captured snapshot without a trusted earlier inventory.
Actual database state was not opened to validate the saved artifacts. Migration execution,
trigger behavior and D1/ Wrangler rollback atomicity require separate authorized tests;
fixture comparison tests do not prove these properties.

Focused tests only (bypasses npm migration hooks):

```powershell
node --test server/tests/auditLocationCompatibility.test.js
```
