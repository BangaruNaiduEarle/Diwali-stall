# Admin location memberships

The feature gate remains disabled. Disabled mode retains the existing season
user-management and session response behavior, including session revocation.

In enabled mode, the existing `/api/admin/users` endpoints operate on the
validated `X-Admin-Location-Id` and operating season context. Body IDs cannot
change the target location. Both memberships and the location-season association
are validated again before service operations and inside mutation predicates.

- GET lists members of that location/season. GET `/assignees` excludes disabled
  users, season memberships and location memberships, and reports effective roles.
- POST invites a new account or grants an existing account membership. Owners may
  grant admin/super_admin; super_admin may grant admin. Owner grants are forbidden.
- POST `/{userId}/role`, `/disable`, `/enable` and DELETE `/{userId}` require owner
  authority in both season and location. Changes affect only that location/season.
- Existing season roles are never raised or re-enabled by location management.
  A missing season membership is created for an invitation, with no other location
  grants. New roles cannot exceed an existing season role. New accounts use the
  existing password policy/hash and account limit; the entire invitation is batched.
- Self-disable/removal and removal/demotion of the last active location owner are
  blocked. Location changes do not revoke global sessions: subsequent requests
  resolve membership permissions again.

An existing account's password, name, global role and disabled state are not
changed by location grants. The location-mode `/{userId}/reset-password` endpoint
returns 403: location authority cannot authorize global credential changes. The
existing global password-reset service, authentication, password handling and its
revocation of all target-user sessions remain unchanged.

Enabled `/api/admin/session` adds `authorizedLocations`, `activeBusinessId`,
`activeLocationId`, `locationRole`, `effectiveRole`, `locationModeEnabled` and
`locationSelectionRequired`. Each authorized entry contains business/location,
operating-season/association metadata, both roles and intersected capabilities.
Disabled or invalid memberships are excluded; archived associations permit read
discovery with write capabilities disabled. No password hashes or other users'
memberships are returned.

Explicit invalid/empty location selection returns 403. Missing ambiguous
selection leaves active location/business null; the existing unique canonical
2026 selection rule is retained. Unmapped 2099 rows acquire no location. Missing
location schema fails closed with a generic 503. Tests use mocked D1 only; real
D1 execution is not established by these tests.
