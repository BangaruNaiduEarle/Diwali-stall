import { SETTINGS_PROFILE_FIELDS, SETTINGS_SEASON_FIELDS } from '../api/adminStallSettings.js'

export function settingsForm(settings) {
  return Object.fromEntries(['profile','season'].map(section => [section,Object.fromEntries(
    (section === 'profile' ? SETTINGS_PROFILE_FIELDS : SETTINGS_SEASON_FIELDS).map(key => [key,Array.isArray(settings[section][key]) ? settings[section][key].join('\n') : settings[section][key]]))]))
}
export function settingsPatch(settings, form) {
  const body = {}
  for (const section of ['profile','season']) {
    const changes = {}
    for (const key of section === 'profile' ? SETTINGS_PROFILE_FIELDS : SETTINGS_SEASON_FIELDS) {
      const value = ['locationDetailLines','stallDates'].includes(key) ? form[section][key].split('\n').map(line => line.trim()).filter(Boolean) : form[section][key].trim()
      if (JSON.stringify(value) !== JSON.stringify(settings[section][key])) changes[key] = value
    }
    if (Object.keys(changes).length) {body[section] = changes;body[section === 'profile' ? 'expectedProfileRevision' : 'expectedSeasonRevision'] = settings.revisions[section]}
  }
  return Object.keys(body).length ? body : null
}
export function stallWhatsAppUrl(settings) {
  let digits = settings?.profile.whatsappNumber.replace(/\D/g,'') ?? ''
  if (!digits) return null
  if (digits.length === 10) digits = '91' + digits
  return `https://wa.me/${digits}?text=${encodeURIComponent('Hi, I would like to know more about your Diwali crackers collection.')}`
}

/** Memory only: one current scope, no cross-stall cache or offline writes. */
export function createStallSettingsStore({load,save}) {
  let generation = 0, scope = null
  let state = {key:null,status:'idle',settings:null,error:null,blocked:false,conflict:false,notice:null}
  const listeners = new Set()
  const publish = changes => {state = {...state,...changes};listeners.forEach(listener => listener())}
  const stale = () => ({ok:false,status:409,error:'stale_context',message:'The active stall changed.'})
  const safe = async callback => {try{return await callback()}catch{return {ok:false,status:0,error:'network_error',message:'Settings could not be reached. Reload before retrying.'}}}
  async function reload() {
    const current = ++generation
    if (!scope?.enabled) return
    publish({status:'loading',settings:null,error:null,blocked:false,conflict:false,notice:null})
    const result = await safe(load)
    if (current !== generation) return stale()
    publish(result.ok ? {status:'ready',settings:result.settings} : {status:'error',error:result,settings:null})
    return result
  }
  return {
    subscribe(listener) {listeners.add(listener);return () => listeners.delete(listener)},
    getSnapshot: () => state,
    setContext(next) {
      generation++;scope = next
      publish({key:next.key,status:next.enabled?'loading':next.legacy?'legacy':'idle',settings:null,error:null,blocked:false,conflict:false,notice:null})
      return reload()
    },
    invalidate() {generation++;scope = null;publish({key:null,status:'idle',settings:null,error:null,blocked:false,conflict:false,notice:null})},
    reload,
    async save(body) {
      if (!scope?.enabled || state.status !== 'ready' || state.blocked || !state.settings?.permissions.canUpdate) return {ok:false,status:403,error:'forbidden',message:'Settings are read-only. Reload current permissions.'}
      const current = ++generation
      publish({status:'saving',error:null,conflict:false,notice:null})
      const result = await safe(() => save(body))
      if (current !== generation) return stale()
      if (result.ok) publish({status:'ready',settings:result.settings,error:null,blocked:false,conflict:false,notice:'Settings saved.'})
      else publish({status:'ready',error:result,conflict:result.status === 409,blocked:[0,401,403,409,428,503].includes(result.status)})
      return result
    },
  }
}
