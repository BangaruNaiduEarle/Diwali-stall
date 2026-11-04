import { useAdminSeasonReadOnly } from '../hooks/useAdminSeasonReadOnly.js'

export default function AdminArchivedSeasonBanner() {
  const { bannerText } = useAdminSeasonReadOnly()
  if (!bannerText) return null
  return (
    <div className="admin-archived-season-banner" role="status">
      {bannerText}
    </div>
  )
}
