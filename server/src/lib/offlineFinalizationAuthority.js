// Not a role override. Only server-verified offline operations receive this
// in-memory capability; body/header objects cannot manufacture WeakMap entries.
const authorities = new WeakMap()
const handoverSources = new WeakMap()
export function authorizeHandoverSource(context,deviceId,operationIds){handoverSources.set(context,{deviceId,ids:new Set(operationIds)})}
export function hasHandoverSource(context,operation){const source=handoverSources.get(context);return Boolean(source&&source.deviceId===operation.scope?.deviceId&&source.ids.has(operation.operationId))}
export function authorizeOfflineFinalization(context, scope, kind, grantId) {
  authorities.set(context, { ...scope, kind, grantId })
}
export function hasOfflineFinalization(context, scope, kind = 'CLOSE') {
  const authority = context && authorities.get(context)
  return Boolean(authority && authority.kind === kind && authority.grantId &&
    ['businessId','locationId','seasonId','userId'].every(key => authority[key] === scope?.[key]))
}
