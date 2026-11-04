import { useEffect, useState } from 'react'
import { readStorageHealth, storageWarning } from '../offline/storageHealth.js'

export default function OfflineStorageStatus({ revision }) {
  const [health, setHealth] = useState(null)
  useEffect(() => {
    let cancelled = false
    const refresh = async () => { const next = await readStorageHealth(); if (!cancelled) setHealth(next) }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [revision])
  const warning = storageWarning(health)
  const mib = bytes => (bytes / (1024 * 1024)).toFixed(1)
  return <aside aria-label="Browser storage">
    <p>Browser storage: {health?.usage != null && health?.quota != null ? `${mib(health.usage)} MiB used of approximately ${mib(health.quota)} MiB for this site` : 'usage estimate unavailable'}.
      {' '}{health?.persistent === true ? 'Persistent storage granted.' : health?.persistent === false ? 'Storage may be evicted.' : 'Persistence status unavailable.'}</p>
    {warning ? <p role="alert">{warning}</p> : null}
    <details><summary>Install on Android Chrome</summary>
      <p>Prepare your selected stall online and wait for “Offline page reload is ready”. In Chrome, open the three-dot menu, choose “Add to Home screen” or “Install app”, then confirm. Open the Diwali icon to return to this offline workspace.</p>
      <p>Use HTTPS or localhost with a normal browser profile. If installation is unavailable, bookmark this page. Keep drafts and pending work here until synchronization is acknowledged. Wait for local saves to finish before closing.</p>
    </details>
  </aside>
}
