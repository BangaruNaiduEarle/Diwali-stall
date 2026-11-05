export async function prepareOfflineAppShell(serviceWorker = globalThis.navigator?.serviceWorker) {
  if (!serviceWorker) throw Error('Service workers are unavailable. Use HTTPS or localhost in a supported browser for offline reload.')
  const registration = await serviceWorker.register('/offline-billing-sw.js')
  if (registration.waiting) throw Error('An app update is waiting. Synchronize saved bills, close all Diwali tabs and reopen online before preparing the new version.')
  let timer, channel
  try {
    await Promise.race([
      (async () => {
        const active = registration.active ?? (await serviceWorker.ready).active
        if (!active) throw Error('The offline app shell could not be activated.')
        await new Promise((resolve, reject) => {
          channel = new MessageChannel()
          channel.port1.onmessage = event => {
            channel.port1.close(); channel.port2.close()
            if (event.data?.ok) resolve(); else reject(Error(event.data?.message ?? 'Offline shell caching failed.'))
          }
          active.postMessage({ type: 'CACHE_OFFLINE_WORKSPACE' }, [channel.port2])
        })
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Offline app shell was not confirmed. Build and preview locally, then prepare again online.')), 20000) }),
    ])
    globalThis.window?.dispatchEvent(new Event('diwali-offline-shell-prepared'))
  } finally { clearTimeout(timer); channel?.port1.close(); channel?.port2.close() }
}

// Check durable cache contents without a download. A saved profile alone does
// not prove that a service worker can reopen the application offline.
export async function offlineAppShellReady(serviceWorker = globalThis.navigator?.serviceWorker) {
  let channel, timer
  try {
    const registration = await serviceWorker?.getRegistration?.('/admin/offline')
    if (!registration?.active) return false
    return await new Promise(resolve => {
      channel = new MessageChannel()
      timer = setTimeout(() => resolve(false), 2500)
      channel.port1.onmessage = event => resolve(event.data?.ok === true)
      registration.active.postMessage({ type: 'CHECK_OFFLINE_WORKSPACE' }, [channel.port2])
    })
  } catch { return false }
  finally { clearTimeout(timer); channel?.port1.close(); channel?.port2.close() }
}
