import AdminWorkspaceShell from './AdminWorkspaceShell.jsx'
import { AdminStallSettingsProvider } from '../context/AdminStallSettingsContext.jsx'

export default function AdminLayout() {
  return <AdminStallSettingsProvider><AdminWorkspaceShell /></AdminStallSettingsProvider>
}
