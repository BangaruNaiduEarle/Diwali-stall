/**
 * Admin API stubs (Phase 2A) — protected by requireAdmin in index.js.
 */

/**
 * @param {Request} _request
 * @param {{ identity: { email: string, sub?: string } }} context
 */
export function handleAdminSession(_request, context) {
  return Response.json(
    {
      ok: true,
      email: context.identity.email,
      role: context.identity.role ?? 'admin',
      userId: context.identity.userId ?? null,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
