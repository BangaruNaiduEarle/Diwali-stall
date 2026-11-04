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

- If the email already exists in `admin_users` (Access-era row), this sets `role=owner` and the password hash on that row.
- Fails with **409** after an owner password exists.
- Remove or rotate `ADMIN_BOOTSTRAP_SECRET` after bootstrap.

Bootstrap establishes the **login identity** only. Season permissions for admin APIs come from **`season_members`** (see below), not from bootstrap alone.

## Sign in / sign out

- `POST /api/admin/auth/login` — `{ email, password }` → `Set-Cookie: diwali_admin_session=…` (Secure, HttpOnly; SameSite=Lax for proxy/same-origin, None only for explicitly trusted direct cross-origin requests).
- `POST /api/admin/auth/logout` — clears cookie and deletes session row.
- `GET /api/admin/session` — requires valid session (or legacy Access JWT if configured). Returns **`admin_users.role`** for compatibility; **do not use it as the permission source** for catalogue, requests, or user management (use active-season membership instead).

## Active business season

After authentication, most `/api/admin/*` routes (excluding **`/api/admin/platform/*`**) resolve an **active business season** from the signed-in user’s **`season_members`** rows:

- Optional request header: **`X-Admin-Season-Id`** — must match a **non-disabled** membership for that user. Invalid or disabled membership for the requested season → **no active season** (`activeSeasonId` / `seasonRole` null on session; season-scoped APIs **403** when a season is required).
- If the header is **absent**: exactly **one** non-disabled membership → that season is selected automatically; **zero** or **more than one** active membership → **no active season** until the operator chooses (multi-season users must pick explicitly in the admin UI).
- Mutations (including user invites and membership changes) also require a **writable** season (`business_seasons.status` is not `archived`).

The admin UI must send **`X-Admin-Season-Id`** on season-scoped API calls after the operator selects a season. It must **not** infer a season from the membership list when the server reports `activeSeasonId: null`.

### `DEFAULT_ADMIN_SEASON_ID` (`season-2026`)

- Kept for **migration/bootstrap** compatibility (e.g. **`0018_business_seasons_foundation.sql`** backfill and tests).
- **Not** used for runtime season selection when a user has **multiple** active memberships (no silent default to 2026 or “first” membership).
- Single-membership operators (typical post-migration **2026-only** shop) still get that season without a header when it is their only active membership.

## Roles and permission source

| Layer | Field / table | Use |
|-------|----------------|-----|
| Login identity | **`admin_users.role`** | Retained for **login/session compatibility** (`GET /api/admin/session` still returns `role` from the login row). **Do not** use it to gate catalogue, requests, uploads, or user management. |
| Business permissions | **`season_members.role`** (`owner` \| `super_admin` \| `admin`) | **Source of truth** for season-scoped admin APIs (catalogue, requests, Quick Bill, uploads, user listing, assignees, etc.). Exposed as **`seasonRole`** when an active season is selected. |
| Platform operations | **`platform_admins`** | **Source of truth** for **`/api/admin/platform/*`** (seasons, cross-season members, public catalogue season setting). Exposed as **`platformAdmin: true`** on session. Not granted via `admin_users.role = owner`. |

- One login may belong to **multiple seasons** with **different** `season_members.role` values. Duplicate `(season_id, admin_user_id)` rows are rejected.

**Admin frontend:** authorization and nav must use **`seasonRole`** and **`platformAdmin`** (and writable/archived season status), **never** the legacy session **`role`** from `admin_users`.

## User management (active season)

All endpoints below require **valid session**, **active season membership**, and (for writes) a **writable** season.

| Endpoint | Who may call (season role) |
|----------|----------------------------|
| `GET /api/admin/users` | **Owner** or **Super Admin** — lists members of the **active season** (`season_members` joined to `admin_users`). |
| `POST /api/admin/users` | **Owner** may invite **super_admin** or **admin**. **Super Admin** may invite **admin** only. Cannot assign **owner** via API. New email: creates `admin_users` + membership (global cap **5** active accounts). Existing email: adds a **new season membership** only (no duplicate in the same season). |
| `POST /api/admin/users/:id/role` | **Owner** only — updates **`season_members.role`** for the active season. |
| `POST /api/admin/users/:id/disable` \| `/enable` | **Owner** only — sets **`season_members.disabled_at`** for the active season (not global account disable). Revokes sessions when disabling a membership. |
| `POST /api/admin/users/:id/reset-password` | **Owner** only — updates **`admin_users.password_hash`** (login identity). Revokes sessions. |

**Assignee listing** (Quick Bill assignment UI):

- `GET /api/admin/users/assignees` — requires season membership and a season role allowed to assign requests (**owner**, **super_admin**, or **admin**). Returns active-season members with eligible roles; excludes globally disabled users and disabled memberships.

### Season membership disable vs global account disable

| | Season membership disable | Global account disable |
|--|---------------------------|-------------------------|
| Storage | `season_members.disabled_at` for one season | `admin_users.disabled_at` |
| API | `POST …/disable` on user routes (owner, active season) | Not exposed on current user-management routes |
| Effect | User may still sign in; they lose access and assignee visibility **for that season** | User **cannot sign in**; all seasons blocked |

Password reset always affects the **global** login row; season roles are unchanged.

## Security notes

- Passwords: **PBKDF2-SHA256**, **100k** iterations (Workers Web Crypto maximum), unique salt per user. Older **210k** hashes still verify once, then rehash to 100k on successful login.
- Login rate limits: failed attempts per email and IP (D1 `admin_login_attempts`).
- **`ADMIN_LOCAL_DEV_*` is loopback-only** and must not be set in production Worker secrets.
- Optional `CF_ACCESS_*` still works if configured; session cookie is checked first.

## Local development

See [LOCAL_ADMIN_DEV.md](./LOCAL_ADMIN_DEV.md) for loopback JWT (Vite proxy). You can also use password login against local D1 after bootstrap on `http://127.0.0.1:8787`.

## Migration

Apply pending migrations on remote D1 before enabling password login (includes `0007_admin_password_auth.sql` then `0008_admin_owner_bootstrap_lock.sql`). Multi-season tables and backfilled `season_members` come from later migrations (e.g. **`0018_business_seasons_foundation.sql`**):

```bash
cd server
npx wrangler d1 migrations apply diwali-quotation --remote
```

Does **not** modify products, purchase rates, or X4 rates. Full deploy steps: **[PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md)**.

## Production CORS

Set **`CORS_ALLOWED_ORIGINS`** as a **plain Worker variable** (e.g. `https://diwali-stall.vercel.app`), not a secret — see [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md).


Origin/CSRF and JSON media-type rules apply before unsafe admin actions. Cookie-based mutations require an explicit trusted Origin, including Postman/curl. See [ADMIN_REQUEST_SECURITY.md](./ADMIN_REQUEST_SECURITY.md).
