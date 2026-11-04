import { digest, publicJwk, verifyTransfer } from '../../shared/handoverProtocol.js'
import { matchTransferCatalogue } from './handover.js'
import { transferProductIds } from '../../shared/familyPackSnapshot.js'

const stores = ['meta', 'profiles', 'catalogues', 'drafts', 'versions', 'outbox']
const id = () => crypto.randomUUID()
const requestResult = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
export function offlineScopeKey(scope) {
  const keys = ['businessId','locationId','seasonId','userId','deviceId']
  if (!scope || keys.some(key => typeof scope[key] !== 'string' || !scope[key])) throw Error('A complete business/location/season/user/device scope is required.')
  return JSON.stringify(keys.map(key => scope[key]))
}
const scopedKey = (scope, key) => JSON.stringify([offlineScopeKey(scope), key])

export function offlineOperationError(profile, operation) {
  if (!profile?.writable || profile.authorityRevoked) return 'This saved workspace is read-only. Reconnect to verify membership.'
  if (['AGREEMENT','CLOSE','PAYMENT','HANDOVER'].includes(operation?.kind) && !['owner','super_admin'].includes(profile.role)) return 'Only Owner or Super Admin can accept handovers, record agreements, close or record payments.'
  if (profile.role === 'admin' && (operation?.kind === 'CREATE' ? operation.body.pricingMode && operation.body.pricingMode !== 'selling' || operation.body.acceptedAmountPaise != null
    : operation?.kind === 'EDIT' && (Object.keys(operation.body).some(key => key !== 'items') || operation.body.items?.some(item => Object.hasOwn(item, 'unitRatePaise'))))) return 'Admin cannot change financial amounts.'
  return null
}

export function openOfflineStorage({ indexedDB = globalThis.indexedDB, name = 'diwali-offline-billing-v1' } = {}) {
  if (!indexedDB) return Promise.reject(Error('IndexedDB is unavailable. Offline changes cannot be saved on this browser.'))
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, 1)
    opening.onupgradeneeded = () => {
      for (const name of stores) {
        const store = opening.result.createObjectStore(name, { keyPath: 'key' })
        if (name !== 'meta') store.createIndex('scopeKey', 'scopeKey', { unique: false })
      }
    }
    opening.onerror = () => reject(opening.error)
    opening.onblocked = () => reject(Error('Close other Diwali tabs to upgrade offline storage.'))
    opening.onsuccess = () => {
      const db = opening.result
      db.onversionchange = () => db.close()
      resolve(new OfflineStorage(db))
    }
  })
}

class OfflineStorage {
  constructor(db) { this.db = db }
  close() { this.db.close() }
  transact(names, mode, work) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(names, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined)
      let value, failure
      tx.oncomplete = () => resolve(value)
      tx.onabort = () => reject(failure ?? tx.error ?? Error('Offline save was aborted.'))
      tx.onerror = () => { /* onabort owns the error; never report a successful save. */ }
      try { Promise.resolve(work(tx)).then(result => { value = result }, error => { failure = error; tx.abort() }) }
      catch (error) { failure = error; tx.abort() }
    })
  }
  async device() {
    return this.transact(['meta'], 'readwrite', async tx => {
      const store = tx.objectStore('meta'), existing = await requestResult(store.get('device'))
      if (existing) return existing
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const device = { key: 'device', deviceId: 'device-' + id(), deviceToken: [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') }
      store.add(device); return device
    })
  }
  get(store, scope, key) { return this.transact([store], 'readonly', tx => requestResult(tx.objectStore(store).get(scopedKey(scope, key)))) }
  list(store, scope) { return this.transact([store], 'readonly', tx => requestResult(tx.objectStore(store).index('scopeKey').getAll(offlineScopeKey(scope)))) }
  async activate(profile, products, familyPacks, familyPackIssues) {
    const scopeKey = offlineScopeKey(profile.scope)
    return this.transact(['profiles','catalogues','meta'], 'readwrite', async tx => {
      const current = await requestResult(tx.objectStore('profiles').get(scopedKey(profile.scope, 'profile')))
      // Sync/conflict review may still hold a pre-demotion profile. Only online
      // preparation (which supplies no handover) can establish a fresh profile.
      if (profile.handover && current) {
        const ranks = ['admin','super_admin','owner']
        const role = ranks[Math.min(ranks.indexOf(profile.role), ranks.indexOf(current.role))] ?? null
        profile = { ...profile, role, writable: profile.writable && current.writable, authorityRevoked: current.authorityRevoked === true,
          handover: current.handover ? { ...current.handover, privateCatalogue: ['owner','super_admin'].includes(role) && !current.authorityRevoked ? current.handover.privateCatalogue : [] } : undefined }
      }
      const previous=await requestResult(tx.objectStore('catalogues').get(scopedKey(profile.scope,'catalogue')))
      tx.objectStore('profiles').put({ ...profile, key: scopedKey(profile.scope, 'profile'), scopeKey })
      tx.objectStore('catalogues').put({ key: scopedKey(profile.scope, 'catalogue'), scopeKey, products,familyPacks:familyPacks??previous?.familyPacks??[],familyPackIssues:familyPackIssues??previous?.familyPackIssues??[], capturedAt: new Date().toISOString() })
      tx.objectStore('meta').put({ key: 'active-profile', profileKey: scopedKey(profile.scope, 'profile') })
    })
  }
  activeProfile() {
    return this.transact(['meta','profiles'], 'readonly', async tx => {
      const active = await requestResult(tx.objectStore('meta').get('active-profile'))
      return active ? requestResult(tx.objectStore('profiles').get(active.profileKey)) : null
    })
  }
  clearActiveProfile() { return this.transact(['meta'], 'readwrite', tx => { tx.objectStore('meta').delete('active-profile') }) }
  /** Commit only authority reductions. Drafts, QR identities and queued input are untouched. */
  reconcileAuthority(session, requested = {}) {
    const confirmed = session.ok && session.locationModeEnabled && session.userId && Array.isArray(session.authorizedLocations)
    const denied = !session.ok && [401,403].includes(session.status)
    if (!confirmed && !denied) return Promise.resolve(false)
    return this.transact(['profiles','meta'], 'readwrite', async tx => {
      const store = tx.objectStore('profiles'), profiles = await requestResult(store.getAll())
      const active = await requestResult(tx.objectStore('meta').get('active-profile'))
      const activeProfile = profiles.find(profile => profile.key === active?.profileKey)
      const ranks = ['admin','super_admin','owner']
      let changed = false
      for (const profile of profiles) {
        const scope = profile.scope
        let authority
        if (confirmed) {
          if (scope.userId !== session.userId) continue
          authority = session.authorizedLocations.find(row => row.business.id === scope.businessId && row.location.id === scope.locationId && row.operatingSeason.id === scope.seasonId)
        } else {
          // A failed request has no trusted user ID: constrain it to the saved identity
          // and requested tuple, or the active profile if no tuple was requested.
          if (!activeProfile || scope.userId !== activeProfile.scope.userId) continue
          if (requested.activeLocationId && requested.activeSeasonId) {
            if (scope.locationId !== requested.activeLocationId || scope.seasonId !== requested.activeSeasonId || requested.activeBusinessId && scope.businessId !== requested.activeBusinessId) continue
          } else if (profile.key !== activeProfile.key) continue
        }
        const revoked = !authority
        const role = revoked ? null : ranks[Math.min(ranks.indexOf(profile.role), ranks.indexOf(authority.effectiveRole))] ?? null
        const writable = profile.writable && !revoked && authority.capabilities.write === true
        const privateAllowed = !revoked && authority.capabilities.viewSensitiveProductPricing === true && ['owner','super_admin'].includes(role)
        const authorityRevoked = profile.authorityRevoked === true || revoked
        if (role === profile.role && writable === profile.writable && authorityRevoked === (profile.authorityRevoked === true) && (privateAllowed || !profile.handover?.privateCatalogue?.length)) continue
        store.put({ ...profile, role, writable, authorityRevoked,
          ...(profile.handover && !privateAllowed ? { handover: { ...profile.handover, privateCatalogue: [] } } : {}) })
        changed = true
      }
      return changed
    })
  }
  async signingIdentity(scope) {
    const key = scopedKey(scope, 'qr-signing-key')
    const existing = await this.transact(['meta'], 'readonly', tx => requestResult(tx.objectStore('meta').get(key)))
    if (existing) return existing
    const pair = await crypto.subtle.generateKey({ name:'ECDSA',namedCurve:'P-256' }, false, ['sign','verify'])
    const publicKey = publicJwk(await crypto.subtle.exportKey('jwk', pair.publicKey))
    return this.transact(['meta'], 'readwrite', async tx => {
      const store = tx.objectStore('meta'), winner = await requestResult(store.get(key))
      if (winner) return winner
      const identity = { key, privateKey:pair.privateKey,publicKey }; store.add(identity); return identity
    })
  }
  saveHandoverPreparation(scope, preparation) {
    return this.transact(['profiles'], 'readwrite', async tx => {
      const store = tx.objectStore('profiles'), key = scopedKey(scope, 'profile'), profile = await requestResult(store.get(key))
      if (!profile || preparation.certificate?.claims.userId !== scope.userId || preparation.certificate.claims.deviceId !== scope.deviceId) throw Error('QR preparation belongs to a different device or user.')
      if (!['owner','super_admin'].includes(profile.role) && preparation.privateCatalogue?.length) throw Error('Restricted profiles cannot store privileged QR pricing.')
      const next = { ...profile,handover:preparation }; store.put(next); return next
    })
  }
  async transferExport(scope, key, value) {
    return this.transact(['meta'], value ? 'readwrite' : 'readonly', async tx => {
      const store = tx.objectStore('meta'), scoped = scopedKey(scope, 'qr-export:' + key), previous = await requestResult(store.get(scoped))
      if (previous || !value) return previous?.envelope ?? null
      store.add({key:scoped,envelope:value}); return value
    })
  }
  async acceptHandover(scope, envelope, catalogue, familyPacks) {
    const profile = await this.get('profiles', scope, 'profile')
    if (!profile?.writable || !['owner','super_admin'].includes(profile.role) || !profile.handover) throw Error('Prepare an authorized Owner/Super Admin profile online before accepting QR.')
    await verifyTransfer(envelope, {rootKey:profile.handover.rootKey,scope,recipientUserId:scope.userId})
    if(!familyPacks)familyPacks=(await this.get('catalogues',scope,'catalogue'))?.familyPacks??[]
    const payload = envelope.payload, fingerprint = await digest(envelope)
    if (matchTransferCatalogue(payload,catalogue,familyPacks).some(row=>!row.matches)) throw Error('The QR selling catalogue or Family Pack catalogue version/composition does not match this receiving stall. No data was imported.')
    const products = transferProductIds(payload.lines).map(id=>catalogue.find(row=>row.id===id))
    if (products.some(row=>!row)) throw Error('Some QR products are missing from this stall catalogue. Nothing was imported. Refresh preparation online.')
    return this.saveDraft(scope, { draftId:crypto.randomUUID(),requestId:payload.requestId,expectedRevision:payload.revision,
      handover:{transferId:payload.transferId,creatorUserId:payload.creatorUserId,initiatorUserId:envelope.certificate.claims.userId,recipientUserId:scope.userId,recipientDeviceId:scope.deviceId,occurredAt:new Date().toISOString()},
      body:{customer:payload.customer,items:payload.lines.map(line=>line.familyPackId?{lineId:line.lineId,familyPackId:line.familyPackId,quantity:line.quantity,unitType:'box',familyPackSnapshot:structuredClone(line.packSnapshot)}:{lineId:line.lineId,productId:line.productId,quantity:line.quantity,unitType:line.unitType})},agreedInr:'',discountInr:'' },
      {kind:'HANDOVER',body:{transfer:envelope},requestId:payload.requestId,expectedRevision:payload.revision,catalogue:products}, null, fingerprint)
  }
  async saveDraft(scope, draft, operation = null, resolving = null, transferFingerprint = null) {
    const scopeKey = offlineScopeKey(scope), draftId = draft.draftId ?? id()
    const result = await this.transact(['drafts','versions','outbox','profiles','meta'], 'readwrite', async tx => {
      const profile = await requestResult(tx.objectStore('profiles').get(scopedKey(scope, 'profile')))
      const permissionError = offlineOperationError(profile, operation)
      if (permissionError) throw Error(permissionError)
      const transferId = operation?.kind === 'HANDOVER' ? operation.body.transfer.payload.transferId : null
      if (transferId) {
        if (!transferFingerprint || !['owner','super_admin'].includes(profile.role)) throw Error('A verified owner handover is required.')
        const previous = await requestResult(tx.objectStore('meta').get(scopedKey(scope, 'qr-accepted:' + transferId)))
        if (previous) {
          if (previous.fingerprint !== transferFingerprint) throw Error('This transfer ID was already used with different content.')
          return {draft:await requestResult(tx.objectStore('drafts').get(scopedKey(scope,previous.draftId))),duplicate:true}
        }
      }
      const previous = await requestResult(tx.objectStore('drafts').get(scopedKey(scope, draftId)))
      if (previous && draft.localRevision !== previous.localRevision) {
        // Commit the competing local input to history before reporting conflict.
        // No outbox entry or current draft is changed by this stale writer.
        const versionKey = scopedKey(scope, id())
        tx.objectStore('versions').add({ key: versionKey, scopeKey, draftId, savedAt: new Date().toISOString(), attemptedDraft: draft,
          body: draft.body, agreedInr: draft.agreedInr ?? null, discountInr: draft.discountInr ?? null,
          attemptedOperation: operation, conflict: 'local_revision_conflict', baseLocalRevision: draft.localRevision ?? null })
        return { localConflict: true, versionKey, currentDraft: previous, attemptedDraft: draft, attemptedOperation: operation }
      }
      let payload
      if (operation) {
        if (previous?.localClosure && operation.kind !== 'PAYMENT' && !resolving) throw Error('This draft has a queued closure. Resolve or synchronize it before making further changes.')
        if (operation.kind === 'PAYMENT' && !previous?.localClosure && previous?.serverSnapshot?.request.status !== 'closed' && !resolving) throw Error('Finalize the request or queue its closure before capturing a payment.')
        payload = { ...operation, operationId: id(), scope: { ...scope }, capturedRole: profile.role, occurredAt: operation.occurredAt ?? new Date().toISOString() }
        delete payload.deviceToken
        if (resolving) {
          const old = await requestResult(tx.objectStore('outbox').get(scopedKey(scope, resolving)))
          if (!old || !(old.state === 'conflict' || old.state === 'failed' && [400,428].includes(old.lastError?.status)) || old.draftId !== draftId) throw Error('The conflict must be reviewed before replacing it.')
          if (payload.kind !== old.payload.kind || payload.kind !== 'CREATE' && !Number.isSafeInteger(payload.expectedRevision) || payload.parentOperationId) throw Error('Choose the reviewed server revision explicitly.')
          payload.resolutionOf = old.payload.operationId
          tx.objectStore('outbox').put({ ...old, state: 'resolved', resolvedBy: payload.operationId })
          const rows = await requestResult(tx.objectStore('outbox').index('scopeKey').getAll(scopeKey))
          const cancelled = new Set([old.payload.operationId])
          let added = true
          while (added) { added = false; for (const row of rows) if (cancelled.has(row.payload.parentOperationId) && !cancelled.has(row.payload.operationId)) { cancelled.add(row.payload.operationId); added = true } }
          for (const row of rows) if (row.payload.operationId !== old.payload.operationId && cancelled.has(row.payload.operationId) && row.state !== 'synced') tx.objectStore('outbox').put({ ...row, state: 'discarded', resolution: 'preceding_conflict_replaced' })
        } else if (previous?.tailOperationId) payload.parentOperationId = previous.tailOperationId
        const counterKey = 'outbox-order:' + scopeKey
        const counter = await requestResult(tx.objectStore('meta').get(counterKey))
        const order = (counter?.value ?? 0) + 1
        tx.objectStore('meta').put({ key: counterKey, value: order })
        tx.objectStore('outbox').add({ key: scopedKey(scope, payload.operationId), scopeKey, draftId, payload, state: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: Date.now(), order })
      }
      const saved = { ...previous, ...draft, draftId, key: scopedKey(scope, draftId), scopeKey, scope: { ...scope },
        localRevision: (previous?.localRevision ?? 0) + 1,
        tailOperationId: payload?.operationId ?? previous?.tailOperationId ?? null, savedAt: new Date().toISOString() }
      if (previous?.lastAcknowledgement) { saved.lastAcknowledgement = previous.lastAcknowledgement; saved.requestId = previous.requestId }
      if (resolving) saved.localClosure = null
      if (payload?.kind === 'CLOSE') saved.localClosure = { operationId: payload.operationId, occurredAt: payload.occurredAt, actorUserId: scope.userId, roleSnapshot: profile.role, deviceId: scope.deviceId }
      tx.objectStore('drafts').put(saved)
      if (transferId) tx.objectStore('meta').add({key:scopedKey(scope,'qr-accepted:'+transferId),draftId,fingerprint:transferFingerprint,operationId:payload.operationId})
      tx.objectStore('versions').add({ key: scopedKey(scope, id()), scopeKey, draftId, savedAt: saved.savedAt, body: structuredClone(saved.body),
        agreedInr: saved.agreedInr ?? null, discountInr: saved.discountInr ?? null, operationId: payload?.operationId ?? null, resolvesLocalVersion: saved.localConflictResolution ?? null })
      return { draft: saved, operation: payload }
    })
    if (result.localConflict) throw Object.assign(Error('Another tab changed this offline draft. Both local versions were preserved; review them before continuing.'), { code: 'local_revision_conflict', ...result })
    return result
  }
  async updateOperation(scope, operationId, changes) {
    return this.transact(['outbox','drafts'], 'readwrite', async tx => {
      const store = tx.objectStore('outbox'), row = await requestResult(store.get(scopedKey(scope, operationId)))
      if (!row || ['synced','resolved','discarded'].includes(row.state)) return row
      if (Object.keys(changes).some(key => !['state','attempts','nextAttemptAt','acknowledgement','acknowledgedAt','lastError','serverSnapshot'].includes(key))) throw Error('Queued operation identity and payload are immutable.')
      const next = { ...row, ...changes }; store.put(next)
      if (changes.state === 'synced') {
        if (changes.acknowledgement?.operationId !== row.payload.operationId) throw Error('The acknowledgement belongs to another operation.')
        const draftStore = tx.objectStore('drafts'), draft = await requestResult(draftStore.get(scopedKey(scope, row.draftId)))
        if (draft) draftStore.put({ ...draft, requestId: changes.acknowledgement.requestId, lastAcknowledgement: changes.acknowledgement })
      }
      return next
    })
  }
  async recover(scope) {
    const rows = await this.list('outbox', scope)
    for (const row of rows) if (row.state === 'syncing') await this.updateOperation(scope, row.payload.operationId, { state: 'pending', nextAttemptAt: 0 })
  }
  async acceptServer(scope, operationId, snapshot) {
    return this.transact(['outbox','drafts','versions'], 'readwrite', async tx => {
      const store = tx.objectStore('outbox'), rows = await requestResult(store.index('scopeKey').getAll(offlineScopeKey(scope)))
      const original = rows.find(row => row.payload.operationId === operationId)
      if (!original || !['conflict','failed'].includes(original.state) || !snapshot?.request && original.payload.kind !== 'CREATE') throw Error('A reviewed server version is required.')
      const ids = new Set([operationId])
      let added = true
      while (added) { added = false; for (const row of rows) if (ids.has(row.payload.parentOperationId) && !ids.has(row.payload.operationId)) { ids.add(row.payload.operationId); added = true } }
      for (const row of rows) if (ids.has(row.payload.operationId) && row.state !== 'synced') store.put({ ...row, state: 'discarded', resolution: 'server_accepted', reviewedServer: snapshot })
      const draftStore = tx.objectStore('drafts'), draft = await requestResult(draftStore.get(scopedKey(scope, original.draftId)))
      if (draft) {
        tx.objectStore('versions').add({ key: scopedKey(scope, id()), scopeKey: offlineScopeKey(scope), draftId: draft.draftId, body: draft.body, savedAt: new Date().toISOString(), resolution: 'before_server_accepted' })
        draftStore.put({ ...draft, localRevision: draft.localRevision + 1, tailOperationId: null, localClosure: null, requestId: snapshot?.request.id ?? null, serverSnapshot: snapshot ?? null, expectedRevision: snapshot?.request.revision ?? null })
      }
    })
  }
}
