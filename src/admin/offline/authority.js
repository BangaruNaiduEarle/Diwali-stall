import { openOfflineStorage } from './storage.js'

/** Do not confirm fresh authority to the UI until its offline reductions commit. */
export async function reconcileOfflineAuthority(session, requested) {
  if (!globalThis.indexedDB || !(session.ok && session.locationModeEnabled && session.userId || !session.ok && [401,403].includes(session.status))) return
  const storage = await openOfflineStorage()
  try {
    if (await storage.reconcileAuthority(session, requested)) {
      globalThis.window?.dispatchEvent(new Event('diwali-offline-authority-changed'))
    }
  } finally { storage.close() }
}
