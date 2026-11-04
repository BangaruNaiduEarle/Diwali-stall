import { resolveLocationScopedAuthorizationFromContext } from '../middleware/adminLocationGuards.js'

export function readWorkflowTransport(request) {
  const deviceId = request.headers.get('X-Device-Id')
  const occurredAt = request.headers.get('X-Device-Occurred-At')
  const revision = request.headers.get('If-Match')
  if ((deviceId != null && (!/^[\w.:@-]{1,128}$/.test(deviceId))) ||
      (occurredAt != null && (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt)))) ||
      (revision != null && !/^(?:0|[1-9]\d*)$/.test(revision.replace(/^"|"$/g, '')))) {
    throw Object.assign(new Error('Invalid workflow device, occurrence time or revision header.'), { status: 400, code: 'invalid_audit_metadata' })
  }
  const expectedRevision = revision == null ? null : Number(revision.replace(/^"|"$/g, ''))
  if (expectedRevision != null && !Number.isSafeInteger(expectedRevision)) throw Object.assign(new Error('Invalid request revision.'), { status: 400, code: 'invalid_audit_metadata' })
  return { deviceId, occurredAt: occurredAt == null ? null : new Date(occurredAt).toISOString(), expectedRevision }
}

/** SQL literals are only server-resolved identity or validated optional transport hints. */
export const auditSqlLiteral = value => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'"

export function workflowActorSql(context) {
  const auth = resolveLocationScopedAuthorizationFromContext(context)
  if (!auth.ok) throw Object.assign(new Error('Validated workflow actor is required.'), { status: 403, code: 'forbidden' })
  const id = auditSqlLiteral(auth.userId)
  return {
    id, name: `(SELECT display_name FROM admin_users WHERE id = ${id})`,
    role: auditSqlLiteral(auth.effectiveRole),
    device: auditSqlLiteral(context.workflowTransport?.deviceId),
    occurred: auditSqlLiteral(context.workflowTransport?.occurredAt),
  }
}

/** Events only store permitted fields. Admin history additionally omits price/agreement snapshots. */
export function presentWorkflowEvent(row, privileged) {
  const metadata = JSON.parse(row.metadata_json)
  const sanitize = value => {
    if (Array.isArray(value)) return value.map(sanitize)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([key]) =>
      !/purchase|profit|margin|cost|finalSubtotal|bargainFloor/i.test(key) &&
      (privileged || !/price|rate|amount/i.test(key))).map(([key, item]) => [key, sanitize(item)]))
  }
  return {
    eventId: row.event_id, requestId: row.request_id, businessId: row.business_id,
    locationId: row.location_id, seasonId: row.season_id, actorUserId: row.actor_user_id,
    actorName: row.actor_name, actorRole: row.actor_role, deviceId: row.device_id,
    eventType: row.event_type, occurredAt: row.occurred_at, receivedAt: row.received_at,
    revision: row.revision, changes: sanitize(metadata),
  }
}
