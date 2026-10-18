# D1 migrations

Versioned SQL files applied by Wrangler. Applied migration names are stored in **`d1_migrations`** (managed by Wrangler; no custom `schema_migrations` table).

## Local (no production credentials)

```bash
cd server
npm run db:migrate:local
npm run db:migrations:list:local
```

Tests run `pretest` → apply migrations locally before `npm test`.

## Remote (Phase 2B+ — not used in Phase 2A)

```bash
npx wrangler d1 migrations apply diwali-quotation --remote
```

Replace placeholder `database_id` in `wrangler.toml` after `wrangler d1 create diwali-quotation`.

## Money

All quotation amounts use **integer paise** (`unit_rate_paise`, `line_total_paise`, `subtotal_paise`, `total_paise`). Public `products` rows have **no** customer price column; private rates live only in `private_rates`.

## Admin auth migrations (production)

After `0006`, apply **`0007_admin_password_auth.sql`** then **`0008_admin_owner_bootstrap_lock.sql`** via the same `migrations apply --remote` command. Owner password setup: `docs/AUTH_PASSWORD.md` and `docs/PRODUCTION_DEPLOY.md`.
