export async function readStorageHealth(storage = globalThis.navigator?.storage, requestPersistence = false) {
  let persistent = null, estimate = null
  try { persistent = await storage?.persisted?.() ?? null } catch { /* Optional browser API. */ }
  if (requestPersistence && persistent !== true) {
    try { persistent = await storage?.persist?.() ?? persistent } catch { /* Continue preparing the shell even if permission fails. */ }
  }
  try { estimate = await storage?.estimate?.() ?? null } catch { /* Report unknown usage. */ }
  const usage = Number.isFinite(estimate?.usage) ? estimate.usage : null
  const quota = Number.isFinite(estimate?.quota) && estimate.quota > 0 ? estimate.quota : null
  const low = usage !== null && quota !== null && (usage / quota >= 0.8 || quota - usage < 50 * 1024 * 1024)
  return { persistent, usage, quota, low }
}

export function storageWarning(health) {
  if (health?.low) return 'Browser storage is nearly full. Synchronize pending work when online and free device space. Do not clear Diwali site data or uninstall while work is pending.'
  if (health?.persistent === false) return 'Persistent storage has not been granted. Android may evict local data under storage pressure. Synchronize regularly; avoid private browsing and clearing site data.'
  return null
}
