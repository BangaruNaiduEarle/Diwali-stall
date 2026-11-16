import { verifyTransfer } from '../../shared/handoverProtocol.js'
import { assertHandoverPreparation } from './handover.js'

// No network requests and no imports into storage. A stalled IDB/WebCrypto
// operation must not leave the receiver waiting forever or accept a late result.
export async function verifyReceivedBill({ storage, scope, envelope, timeoutMs = 15000 }) {
  let timer, stage = 'reading this phone\'s cached QR preparation'
  const work = async () => {
    const current = await storage.get('profiles', scope, 'profile')
    stage = 'checking this phone\'s QR certificate and signing key'
    await assertHandoverPreparation(storage, current)
    if (!['owner', 'super_admin'].includes(current.role)) throw Error('Only an authorized Owner / Super Admin can receive this bill.')
    stage = 'checking the sender signature, intended recipient and business/stall/season'
    return verifyTransfer(envelope, { rootKey: current.handover.rootKey, grantRootKey: current.handover.grantRootKey,
      scope, recipientUserId: scope.userId })
  }
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`QR verification timed out while ${stage}. No bill was imported. Restart the scanner; if it repeats, reconnect and prepare QR on this receiving phone again.`)), timeoutMs)
    })])
  } catch (reason) {
    throw Error(`QR verification failed while ${stage}: ${reason?.message || 'This browser could not complete local verification.'}`)
  } finally { clearTimeout(timer) }
}
