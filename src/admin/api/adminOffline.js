import { apiRequest } from './client.js'
const unwrap = result => result.ok ? { ...result.data, ok: true } : result
export const registerOfflineDevice = async device => unwrap(await apiRequest('/api/admin/offline/devices', { method: 'POST', body: JSON.stringify({ deviceId: device.deviceId, deviceToken: device.deviceToken }) }))
export const fetchOfflineCatalogue = async () => unwrap(await apiRequest('/api/admin/offline/catalogue'))
export const fetchOfflineRequest = async id => unwrap(await apiRequest('/api/admin/offline/requests/' + encodeURIComponent(id)))
export const sendOfflineOperation = async operation => unwrap(await apiRequest('/api/admin/offline/sync', { method: 'POST', body: JSON.stringify(operation) }))
export const prepareOfflineHandover = async device => unwrap(await apiRequest('/api/admin/offline/handover/prepare', { method:'POST',body:JSON.stringify(device) }))
