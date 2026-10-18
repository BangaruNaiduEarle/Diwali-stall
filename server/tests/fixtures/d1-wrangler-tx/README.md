# Wrangler local D1 transaction probe

Isolated database **`wrangler-tx-isolated-test`** (not `diwali-quotation`).

Persistence: `.persist/` (gitignored via local convention — safe to delete).

Manual repro:

```bash
cd server/tests/fixtures/d1-wrangler-tx
npx wrangler d1 execute wrangler-tx-isolated-test --local --persist-to .persist --config wrangler.toml --file 01-schema.sql
npx wrangler d1 execute wrangler-tx-isolated-test --local --persist-to .persist --config wrangler.toml --file 02-fail-mid-transaction.sql
npx wrangler d1 execute wrangler-tx-isolated-test --local --persist-to .persist --config wrangler.toml --file 03-count.sql --json
```

Automated: `server/tests/d1WranglerTxAtomic.test.js` (also in `npm run test:integration`).
