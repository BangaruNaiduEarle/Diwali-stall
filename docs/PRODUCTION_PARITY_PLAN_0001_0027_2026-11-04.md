# Full production parity plan — 0001–0027 — 4 November 2026

**Prepared only. Execution BLOCKED; deployment remains NO-GO.** Target: latest local Worker/frontend and the complete 28-file migration history (two different 0010 filenames). No production operation, migration, test, backup access, code change or deployment was performed to prepare this plan.

## Recorded production identity and reconciliation

The preceding read-only production prerequisite check established:

- Worker: `diwali-api`, enabled `diwali-api.naiduearle2662.workers.dev`.
- D1: `diwali-quotation`, binding `DB`, UUID `c2ae3b00-7356-4e54-97ba-e7b92ca79346`.
- 18 applied migration filenames through 0017; no unknown applied names. The two 0010 files were applied at different positions in production history. Do not reorder/rewrite that history: membership by complete filename determines pending status.
- Production schema lacks the 0018 and later foundation tables. Current local application is not compatible with that schema.

This plan reuses that result; history was not queried again. Reconfirm exact target/history at the authorized write-pause cutoff because it can change before execution. Never use a numeric maximum alone or mark an unapplied migration as applied.

| Full migration filename | Recorded production state | Operator action |
| --- | --- | --- |
| `0001_initial_schema.sql` | Applied | Preserve; do not replay |
| `0002_seed_categories.sql` | Applied | Preserve; do not replay or reseed |
| `0003_products_company.sql` | Applied | Preserve; do not replay |
| `0004_products_selling_price_paise.sql` | Applied | Preserve; do not replay |
| `0005_product_purchase_rates.sql` | Applied | Preserve; do not replay |
| `0006_quotations_one_active_per_request.sql` | Applied | Preserve; do not replay |
| `0007_admin_password_auth.sql` | Applied | Preserve; do not replay |
| `0008_admin_owner_bootstrap_lock.sql` | Applied | Preserve; do not replay or bootstrap again |
| `0009_family_packs.sql` | Applied | Preserve; do not replay |
| `0010_customer_request_unit_price.sql` | Applied | Preserve exact filename; do not replay |
| `0010_products_final_price_paise.sql` | Applied | Preserve exact filename; do not replay |
| `0011_admin_super_admin_role.sql` | Applied | Preserve; do not replay |
| `0012_customer_request_public_reference.sql` | Applied | Preserve; do not replay |
| `0013_customer_request_delivery_fields.sql` | Applied | Preserve; do not replay |
| `0014_products_pieces_per_pack_loose_sale.sql` | Applied | Preserve; do not replay |
| `0015_quotations_quick_bill_audit.sql` | Applied | Preserve; do not replay |
| `0016_customer_request_finalization_assignment.sql` | Applied | Preserve; do not replay |
| `0017_customer_request_workflow_audit.sql` | Applied | Preserve; do not replay |
| `0018_business_seasons_foundation.sql` | Pending | First: season registry, membership mirror, season columns/backfill |
| `0019_platform_admins.sql` | Pending | Second: platform registry; does not auto-promote any account |
| `0020_business_location_foundation.sql` | Pending; incompatible preconditions | STOP until the production-safe adaptation below is approved and qualified |
| `0021_request_workflow_history.sql` | Pending | After 0020: revisions, stable line IDs and workflow history |
| `0022_request_payment_ledger.sql` | Pending | After 0021: eligible account backfill and immutable payment ledger |
| `0023_offline_sync_receipts.sql` | Pending | After 0022: devices and idempotent operation receipts |
| `0024_qr_handover.sql` | Pending | After 0023: signing-key registry and QR claims |
| `0025_bill_purchase_cost_snapshots.sql` | Pending | After 0024: new-finalization immutable cost snapshots |
| `0026_stall_settings.sql` | Pending | After 0025: scoped settings and audit |
| `0027_location_final_rate_access.sql` | Pending; included in requested target | Last: per-stall/season Admin Final Rate grant, default denied |

Expected completion: 28 distinct exact filenames, no missing or duplicate history names. Apply only the difference between this manifest and actual applied names at execution time. Any unexpected/partial state requires reconciliation before proceeding.

## 0020: definite baseline incompatibility and required resolution

Source inspection establishes a blocker, not merely a missing production count:

- 0018 creates only `season-2026`; 0019 creates an empty platform-admin registry.
- 0020 requires a `season-2099` record in `pre.real_and_protected_seasons`. The normal 0017 → 0018 → 0019 path cannot produce it. No fixture season may be inserted to satisfy that assertion.
- 0020 also hard-codes both pre/post counts: categories 14, products 162, Family Packs 6, private rates 161, purchase rates 180, requests 67, quotations 66, and three memberships. Actual production counts are not established and must not be forced to match rehearsal data.
- It enforces exact table/column/history inventories, valid relationships, proposed-identity conflict checks, scoped ownership and original-column preservation. These protections must remain meaningful.

**Required engineering/operator resolution before any production migration:** prepare and approve a production-compatible revision strategy for the still-pending 0020. Remove the requirement that fixture-only seasons exist; preserve every non-target season if present. Replace fixture count assumptions in both preconditions and postconditions with a consistent captured production baseline and before/after ownership/preservation comparisons. Retain FK/relationship checks, exact approved schema/history checks, atomic execution and abort-on-mismatch behavior. Review all embedded pre/post assertions, not just the first failure.

Approve original mapping `business-diwali` / `location-diwali-2026` / `season-2026`, preserving existing catalogue, prices, request/quotation IDs, account identities and membership roles/disabled states. Reject conflicting identities or unaccounted rows rather than silently mapping them elsewhere.

Pin the approved revised SQL checksum and review its previously unverified production-path behavior using an authorized disposable source, without repeating unchanged completed suites. Prior 0020/0021–0026 checksum and rehearsal results do not automatically qualify a revised file. Never replay/rewrite already-applied 0020 in another environment. No SQL or fixture was altered here.

**Until this is resolved, the unchanged 0001–0027 chain cannot safely complete against the recorded production baseline.** Do not begin a partial rollout just to discover this known failure.

## Required production configuration

| Setting | Recorded state / required decision |
| --- | --- |
| Worker/D1 identity | Confirm the identity above and pin the Cloudflare account in the approved operator configuration. Working OAuth credentials were established; that is not execution authorization. |
| Runtime | Local and live use `2025-04-01`; retained rehearsal used `2026-05-01`. Approve the intended runtime for the pinned candidate/fallback and resolve compatibility evidence for that pairing. |
| `ADMIN_LOCATION_MODE` | Absent remotely, therefore currently disabled by code default. Approve `1` for the full multi-stall release after schema/mapping completion. |
| Trusted public scope | Configure `PUBLIC_REQUEST_BUSINESS_ID=business-diwali`, `PUBLIC_REQUEST_LOCATION_ID=location-diwali-2026`, `PUBLIC_REQUEST_SEASON_ID=season-2026` only after operator approval of this original-stall mapping. All three were absent remotely. |
| `HANDOVER_SIGNING_JWK` | Absent remotely. Securely provision/approve the required private ECDSA P-256 signing JWK for full QR functionality; retain it server-side with recovery custody. Do not expose its value or rotate an established key casually. |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` are present as remote secret bindings; preserve them. Names/presence do not attest validity or complete the security attestation. |
| Admin authentication | No remote local-auth bypass was found. Keep local-only `ADMIN_LOCAL_DEV_*` out of the production configuration; do not copy `.dev.vars`. Preserve existing logins/passwords/sessions under the approved cutover policy. |
| Platform Admin access | 0019 grants nobody. Identify and explicitly authorize the existing login(s) requiring platform authority through an approved provisioning procedure. Do not recreate the Owner or infer platform authority from an Owner role. |
| CORS and frontend | Recorded CORS includes `https://diwali-stall.vercel.app,http://localhost:5173`. Approve intended production origins. Root `vercel.json` proxies `/api/*` to the confirmed Worker, then serves SPA fallback. Confirm Vercel production domain/project/build settings and keep production `VITE_API_BASE_URL` empty for this same-origin design. |
| Build/artifact | Root `npm run build` produces `dist`. Pin latest local Worker/frontend sources and resulting release identifiers/checksums, including the latest UI changes; do not deploy a previously retained temporary build as the current candidate. Build not executed here. |

0027 is included in the owner's requested deployment scope; its inclusion does not need to be asked again. Actual production execution remains explicitly withheld. Existing Admin grants default to zero; Owner/Super Admin access remains role-based. After 0027, the existing Users control and `POST /api/admin/users/:id/final-rate-access` support authorized grant/revocation for the selected stall/season. No automatic Admin grants are planned. Purchase access and financial write permissions stay unchanged. Preserve unavailable historical cost data; never reconstruct it from today's prices.

## Ordered operator sequence — future execution only

1. **Finish the package before the outage.** Resolve 0020; pin all 28 filenames/checksums and latest application artifacts; approve target, runtime, mapping, secrets, recovery pairing, verification/abort criteria and responsible operators. Keep the candidate off production until its schema prerequisites exist.
2. **Approve and enforce the write/sync pause.** Cover public checkout, Admin mutations/payments/imports and offline synchronization. Record cutoff and pending client identities without deleting/forcing sync of outboxes. Old writers must not continue against a partially upgraded schema.
3. **Capture a verified production recovery point and baseline.** Use the approved production mechanism, with identity/time, consistency, retention/custody and approved restore/reconciliation procedure. Retain target-specific original-column fingerprints/counts and existing financial/operation identities. The recorded pre-0021 local SQLite backup is not a production recovery artifact.
4. **Reconcile under the pause.** Read exact production `d1_migrations` names and schema metadata using a SELECT-only path. Do not use the installed Wrangler `migrations list` as a strictly read-only preflight: its implementation calls `initMigrationsTable`. Compare names with the full manifest; do not replay already-applied files or edit history.
5. **Apply 0018, then 0019, with the pause held.** Run only if absent. Check their committed filenames and expected registry/backfill structure. Before 0020, history must contain the exact approved 20 preceding filenames. Stop if post-0019 schema/baseline differs from the approved production-compatible 0020 entry state.
6. **Apply the qualified 0020 as one complete migration.** No statement splitting, disabled FKs, assertion bypasses, fake seasons or data cleanup. Verify original-column preservation and the approved ownership mapping before continuing.
7. **Apply 0021 → 0022 → 0023 → 0024 → 0025 → 0026 → 0027**, only when each filename remains pending. Use normal migration-runner history bookkeeping and agreed file-level checkpoints. Do not invent historical payments, costs, receipts or claims. Treat every committed migration as a possible partial completion; the full chain is not one transaction.
8. **Verify final metadata/preservation.** Require all 28 exact filenames; expected tables/constraints and `location_members.can_view_final_rate`; preserved original business values and memberships; only documented backfills/defaults. Stop on any unexplained difference. This is target-specific post-change validation, not a replay of completed local suites. Any verification writes require explicit authorization.
9. **Deploy the pinned Worker, then the matching frontend while writes remain paused.** Use the approved production configuration above, preserved secrets and approved platform access. Build through the approved frontend pipeline (`npm run build`, output `dist`) and pin the Vercel production project/domain and source/artifact identity. Do not ship the frontend ahead of its compatible API/schema.
10. **Obtain explicit reopening approval.** Check the agreed minimum cutover safety conditions and record the first accepted write. Reconcile pending client identities under the approved rules. Physical Android and full deployed-runtime parity checks remain owner-approved post-deployment work, NOT TESTED; their deferral does not waive schema, recovery, scope/configuration or reopening safeguards.

### Bounded migration runner plan

The current default migration directory contains every pending file through 0027. A general apply command cannot provide a deliberate stop before 0020.

Prepare separately approved operator stage configurations outside the checked-in deployment configuration. Each must retain the exact attested account/database binding, production target and normal `d1_migrations` table, and point to a frozen migration directory containing the full approved filename prefix through that stage only. The prefix includes both historical 0010 files unchanged. Advance the cap through 0018, 0019, qualified 0020, and then each file through 0027; verify recorded completion before advancing. Do not rename files or run raw SQL outside migration bookkeeping.

Command template, from `C:\naidu\Diwali\server`, for future approved execution:

```powershell
node node_modules/wrangler/bin/wrangler.js d1 migrations apply diwali-quotation --remote --config <approved-absolute-stage-config>
```

The placeholder is not an executable production package today. Stage configurations, the qualified 0020 checksum and recovery authorizations remain to be supplied. Do not substitute the default config and execute the entire pending set. On failure, preserve state and read committed history before deciding whether any retry is safe.

## Genuine remaining prerequisites

1. **Engineering/acceptance owner:** qualified production-compatible 0020 strategy/file and evidence for changed behavior; unchanged rehearsal tests need no repeat. Current mandatory 2099/fixture-count assumptions are a definite incompatibility.
2. **Production operator + release/financial-data owners:** fresh attested production recovery point, demonstrated intended recovery application/schema pairing, loss-aware pre-/post-reopen recovery and offline reconciliation, enforceable write pause and named recovery/escalation ownership. Never restore the older local fixture over production or assume a mode flag/old binary is a safe rollback.
3. **Release/security/platform operators:** approve and provision missing location/public scope and signing key; identify platform-admin authorization; resolve runtime choice, candidate/fallback identities, secret/custody attestations and Vercel production settings/access.
4. **Release owner:** approve the frozen complete migration/command/checkpoint manifest through 0027, cutoff, preservation and stop criteria, actual deployment execution and reopening. Bounded Phase 1 evidence-reuse/Phase 8 checkpoint approvals are not these execution approvals; other outstanding formal sign-offs remain unchanged.

Customer Directory/Quantity Ledger remain deferred until after Diwali. Physical Android/full deployed-runtime parity remain deferred until after deployment. Neither is reintroduced as a pre-deployment testing blocker. Existing Cloudflare credential availability, Worker/D1 identity and already-applied 0001–0017 migrations are not missing prerequisites.

Sources: [recovery demonstration](DISPOSABLE_RECOVERY_RESTORATION_DEMONSTRATION_2026-11-04.md), [backup/rollback review](FINAL_MIGRATION_BACKUP_ROLLBACK_REVIEW_2026-11-04.md), [prior through-0026 cutover runbook](PRODUCTION_MIGRATION_CUTOVER_RUNBOOK_2026-11-04.md), [current Phase 1/8 decisions](FINAL_ACCEPTANCE_GAP_REVIEW_2026-11-03.md), `server/docs/FINAL_RATE_ACCESS.md`, current migration SQL and configuration. The preceding production metadata check is the source for recorded remote state; it was not repeated or converted into recovery PASS.
