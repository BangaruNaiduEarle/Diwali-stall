import { offlineScopeKey, offlineOperationError } from './storage.js'

/** Per-operation commits allow independent drafts to progress while a conflicting
 * chain stays blocked. The caller supplies authenticated, context-bound transport. */
export async function synchronizeOutbox({ storage, scope, deviceToken, send, fetchSnapshot, now = Date.now, onChange = () => {}, isCurrent = () => true }) {
  const run = async () => {
    const rows = (await storage.list('outbox', scope)).sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt))
    const byId = new Map(rows.map(row => [row.payload.operationId, row]))
    let acknowledged = 0
    for (const row of rows) {
      if (!isCurrent()) break
      if (row.state !== 'pending' || row.nextAttemptAt > now()) continue
      const parent = row.payload.parentOperationId && byId.get(row.payload.parentOperationId)
      if (row.payload.parentOperationId && parent?.state !== 'synced') continue
      // Captured grant proofs are immutable. Send them even after local expiry
      // so the Worker can return an existing receipt or explicitly reject a new
      // commit. Never mint a replacement ID/time during recovery.
      const denied = offlineOperationError(await storage.get('profiles', scope, 'profile'), row.payload, true)
      if (denied) {
        await storage.updateOperation(scope, row.payload.operationId, { state: 'failed', lastError: { status: 403, code: 'offline_access_denied', message: denied } })
        onChange()
        break
      }
      const attempts = row.attempts + 1
      await storage.updateOperation(scope, row.payload.operationId, { state: 'syncing', attempts }); onChange()
      let result
      try { result = await send({ ...row.payload, deviceToken }) } catch { result = { ok: false, status: 0, message: 'Connection interrupted. The same operation will be retried.' } }
      if (result.ok && result.operationId === row.payload.operationId && result.requestId && Number.isSafeInteger(result.revision)) {
        const saved = await storage.updateOperation(scope, row.payload.operationId, { state: 'synced', acknowledgement: result, acknowledgedAt: now(), lastError: null })
        byId.set(row.payload.operationId, saved); acknowledged++; onChange(); continue
      }
      const requestId = row.payload.requestId ?? parent?.acknowledgement?.requestId
      const conflict = result.status === 409 && result.error !== 'stale_context'
      let serverSnapshot = null
      if (conflict && requestId && isCurrent()) {
        try { const snapshot = await fetchSnapshot(requestId); if (snapshot.ok) serverSnapshot = snapshot } catch { /* Original operation still survives. */ }
      }
      const retry = result.status === 0 || result.status >= 500 || result.status === 429
      const saved = await storage.updateOperation(scope, row.payload.operationId, {
        state: conflict ? 'conflict' : retry ? 'pending' : 'failed', serverSnapshot,
        lastError: { status: result.status, code: result.error ?? 'invalid_acknowledgement', message: result.message ?? 'The server did not acknowledge this operation.' },
        nextAttemptAt: now() + Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)),
      })
      byId.set(row.payload.operationId, saved); onChange()
      const chainOnlyDenied = row.payload.kind === 'HANDOVER' && ['sender_denied','sender_device_denied'].includes(result.error) || result.error==='offline_grant_denied'
      if ([0,401].includes(result.status) || result.status === 403 && !chainOnlyDenied || result.error === 'stale_context') break
    }
    return { acknowledged }
  }
  // Cross-tab serialization is an optimization; server receipts guarantee exactly
  // one business commit even after a crash or on browsers without Web Locks.
  return globalThis.navigator?.locks ? navigator.locks.request('diwali-sync:' + offlineScopeKey(scope), run) : run()
}
