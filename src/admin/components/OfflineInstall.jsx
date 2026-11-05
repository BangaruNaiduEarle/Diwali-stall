import { useEffect, useState } from 'react'

/** Installation is independent of catalogue preparation and pending bills. */
export default function OfflineInstall({ visible = true }) {
  const [prompt, setPrompt] = useState(null)
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)
  const [message, setMessage] = useState('')
  const [prompting, setPrompting] = useState(false)
  const [updateWaiting,setUpdateWaiting] = useState(false)
  useEffect(() => {
    const mode = window.matchMedia('(display-mode: standalone)')
    const before = event => { event.preventDefault(); setPrompt(event) }
    const done = () => { setInstalled(true); setPrompt(null); setMessage('') }
    const changed = () => setInstalled(mode.matches || navigator.standalone === true)
    window.addEventListener('beforeinstallprompt', before)
    window.addEventListener('appinstalled', done)
    mode.addEventListener('change', changed)
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', done); mode.removeEventListener('change', changed) }
  }, [])
  useEffect(()=>{
    let cancelled=false
    const check=async()=>{try{const registration=await navigator.serviceWorker?.getRegistration('/admin/offline');if(!cancelled)setUpdateWaiting(Boolean(registration?.waiting))}catch{/* optional browser API */}}
    check()
    const timer=setInterval(check,30000)
    window.addEventListener('focus',check);window.addEventListener('diwali-offline-shell-prepared',check)
    return()=>{cancelled=true;clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('diwali-offline-shell-prepared',check)}
  },[])
  async function checkUpdate(){
    try{
      const registration=await navigator.serviceWorker?.getRegistration('/admin/offline')
      if(!registration){setMessage('Prepare this stall first to register the offline app.');return}
      await registration.update()
      setUpdateWaiting(Boolean(registration.waiting))
      setMessage(registration.waiting||registration.installing?'App update detected. Keep pending work until acknowledged; close all Diwali tabs and reopen online when ready.':'No waiting update detected. Offline reload readiness is listed separately below.')
    }catch{setMessage('Could not check for an app update. Reconnect and try again; saved bills remain on this device.')}
  }
  async function install() {
    if (!prompt || prompting) return
    setPrompting(true)
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      setMessage(choice.outcome === 'accepted' ? 'Installation requested. Waiting for browser confirmation.' : 'You can install later; billing still works in this browser.')
      setPrompt(null)
    } catch { setMessage('Use the browser menu to install or add this page to your Home screen.'); setPrompt(null) }
    finally { setPrompting(false) }
  }
  // Keep listeners mounted during preparation: Chrome may offer installation
  // just after the catalogue activates and the sale screen replaces setup.
  if (!visible) return null
  return <aside className="pos-install" aria-label="App installation">
    <strong>{installed ? 'App installed / standalone mode' : 'Install app on this device'}</strong>
    {!installed && prompt ? <button className="pos-button pos-button--outline" type="button" disabled={prompting} onClick={install}>Install app</button> : null}
    {!installed ? <p>Android Chrome: open the three-dot menu → Install app or Add to Home screen. If unavailable, bookmark this page. Installation is optional; prepare this stall below for offline use.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {updateWaiting?<p role="status">App update waiting. Synchronize pending bills, then close all Diwali tabs and reopen online. This page will not reload automatically.</p>:null}
    <button className="pos-button pos-button--outline" type="button" disabled={!navigator.onLine} onClick={checkUpdate}>Check app update</button>
  </aside>
}
