# Admin request origin and JSON policy

This protection applies independently of `ADMIN_LOCATION_MODE`, which remains
disabled by default. It does not select locations, authenticate users or grant
business/platform permissions.

The request wrapper checks unsafe methods before authentication, session
last-seen updates, body parsing and route execution. GET, HEAD and OPTIONS are
safe for this guard; POST, PUT, PATCH, DELETE and all other methods are unsafe.
Existing CORS preflight processing runs first.

The boundary covers authentication/bootstrap/logout, user/password management,
platform controls, catalogue/rates, family packs, customer requests, quotations,
Quick Bill and upload-signing admin routes. Anonymous public request creation
does not use admin credentials; its JSON media type is still enforced.

For unsafe `/api/admin*` requests:

- A supplied Origin must be one serialized HTTP(S) origin matching the request
  URL origin or an exact configured `CORS_ALLOWED_ORIGINS` entry. Configuration
  entries retain their existing normalization. Request Origin values must not
  contain paths, credentials, multiple origins, `null` or wildcards.
- Any request carrying `diwali_admin_session`, even an empty/invalid cookie,
  must supply a trusted Origin. Adding a JWT header does not exempt the cookie.
- Cookie-free browser-signalled requests (`Sec-Fetch-*`) also require Origin.
  Cookie-free CLI/JWT/Access/password-bootstrap/login requests without browser
  metadata may omit it; ordinary authentication/authorization still applies.
- X-Forwarded-Host, X-Forwarded-Proto and Referer never establish origin trust.
  A supported frontend proxy must preserve Origin and its frontend origin must
  be configured. CORS response filtering is not request authorization.

Failures return 403 `untrusted_origin`, `Cache-Control: no-store`, with no D1
access. Cookie-based Postman/curl mutations must now explicitly send, for example,
`Origin: https://<worker-host>` or the configured frontend origin. A missing
Origin is not inferred from forwarded headers or Referer.

All current API bodies use `Content-Type: application/json`, optionally with
`charset=utf-8` (case-insensitive; quoted UTF-8 is accepted). Missing/wrong media
types, including text/plain, form bodies and other charsets, return 415
`unsupported_media_type` before route execution. `readJsonBody` independently
enforces the same rule. Bodyless POST/DELETE actions, including platform archive,
membership toggles and logout, do not require a JSON content-type header. No
location/season selectors are required for global auth or platform actions.

Session and local-dev suppression cookies default to HttpOnly, Secure on HTTPS,
and SameSite=Lax. Same-origin/proxy and cookie-free CLI logins use Lax. Explicitly
trusted direct cross-origin frontend requests over HTTPS retain SameSite=None;
Secure for the supported split-host deployment. An allowed forwarded-host hint
can choose the stricter proxy/Lax policy; it cannot authorize an Origin. Set and
clear cookie policies use the same topology resolver. Loopback HTTP uses Lax
without Secure. Session identity, lifetime, password hashing and revocation are
unchanged; real browser third-party-cookie restrictions still apply.

Focused tests use mocked D1 and real Worker route dispatch. No real local or
remote database is needed. They verify server decisions/cookie attributes,
not browser cookie enforcement or live proxy forwarding.
