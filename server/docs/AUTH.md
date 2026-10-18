# Authentication

Production admin uses **email + password** and **HttpOnly session cookies**. See **[AUTH_PASSWORD.md](./AUTH_PASSWORD.md)** for bootstrap, login, user management, and migrations.

## Optional: Cloudflare Access

You may still configure **`CF_ACCESS_TEAM_DOMAIN`** and **`CF_ACCESS_AUD`**. The Worker checks **session cookie first**, then Access JWT, then (loopback only) local dev JWT.

| Condition | Admin API response |
|-----------|-------------------|
| No valid session / JWT | `401 unauthorized` |
| Database binding missing | `503 database_unavailable` |
| Valid Access JWT but email not active in `admin_users` | `403 forbidden` |
| Disabled admin account | `403 forbidden` (Access) or failed login (password) |

There is **no** public registration, shared production password, or production bypass.

### Bootstrapping the owner (password auth)

One-time `POST /api/admin/auth/bootstrap-owner` with `ADMIN_BOOTSTRAP_SECRET` — see AUTH_PASSWORD.md. Existing Access-era rows in `admin_users` can be promoted without touching catalogue or rate data.

### Local development

- **Password login** against local D1 after bootstrap on `http://127.0.0.1:8787`.
- **Loopback JWT** (optional): **[LOCAL_ADMIN_DEV.md](./LOCAL_ADMIN_DEV.md)** — never enable on deployed Workers.

### Future alternatives (not implemented)

- Service tokens for machine-to-machine.
- Separate admin Worker on a private hostname with mTLS.
