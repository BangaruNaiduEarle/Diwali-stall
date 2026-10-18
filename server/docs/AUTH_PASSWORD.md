# Admin password authentication (production)

Cloudflare **Zero Trust is optional**. Production admin uses **email + password** and **HttpOnly session cookies** stored in D1.

## First owner (one-time)

1. Set a Worker secret (min 32 characters): `ADMIN_BOOTSTRAP_SECRET` via `wrangler secret put ADMIN_BOOTSTRAP_SECRET`.
2. Call once (HTTPS):

```http
POST /api/admin/auth/bootstrap-owner
Content-Type: application/json

{
  "email": "owner@example.com",
  "password": "minimum-12-char-password",
  "bootstrapSecret": "<same as ADMIN_BOOTSTRAP_SECRET>",
  "displayName": "Owner"
}
```

- If the email already exists in `admin_users` (Access-era row), this sets `role=owner` and the password hash.
- Fails with **409** after an owner password exists.
- Remove or rotate `ADMIN_BOOTSTRAP_SECRET` after bootstrap.

## Sign in / sign out

- `POST /api/admin/auth/login` — `{ email, password }` → `Set-Cookie: diwali_admin_session=…` (Secure, HttpOnly, SameSite=None for Vercel → workers.dev).
- `POST /api/admin/auth/logout` — clears cookie and deletes session row.
- `GET /api/admin/session` — requires valid session (or legacy Access JWT if configured).

## User management (owner only)

- `GET /api/admin/users`
- `POST /api/admin/users` — create **admin** only (max **5** active users including the one owner; cannot create a second owner)
- `POST /api/admin/users/:id/disable` | `/enable`
- `POST /api/admin/users/:id/reset-password` — `{ password }`

Disabled users cannot sign in; existing sessions are revoked on disable/password reset.

## Security notes

- Passwords: **PBKDF2-SHA256**, **100k** iterations (Workers Web Crypto maximum), unique salt per user. Older **210k** hashes still verify once, then rehash to 100k on successful login.
- Login rate limits: failed attempts per email and IP (D1 `admin_login_attempts`).
- **`ADMIN_LOCAL_DEV_*` is loopback-only** and must not be set in production Worker secrets.
- Optional `CF_ACCESS_*` still works if configured; session cookie is checked first.

## Local development

See [LOCAL_ADMIN_DEV.md](./LOCAL_ADMIN_DEV.md) for loopback JWT (Vite proxy). You can also use password login against local D1 after bootstrap on `http://127.0.0.1:8787`.

## Migration

Apply pending migrations on remote D1 before enabling password login (includes `0007_admin_password_auth.sql` then `0008_admin_owner_bootstrap_lock.sql`):

```bash
cd server
npx wrangler d1 migrations apply diwali-quotation --remote
```

Does **not** modify products, purchase rates, or X4 rates. Full deploy steps: **[PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md)**.

## Production CORS

Set **`CORS_ALLOWED_ORIGINS`** as a **plain Worker variable** (e.g. `https://diwali-stall.vercel.app`), not a secret — see [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md).
