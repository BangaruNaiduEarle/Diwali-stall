export async function prepareOfflineAppShell(serviceWorker = globalThis.navigator?.serviceWorker) {
  if (!serviceWorker) throw Error('Service workers are unavailable. Use HTTPS or localhost in a supported browser for offline reload.')
  const registration = await serviceWorker.register('/offline-billing-sw.js')
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
  } finally { clearTimeout(timer); channel?.port1.close(); channel?.port2.close() }
}
