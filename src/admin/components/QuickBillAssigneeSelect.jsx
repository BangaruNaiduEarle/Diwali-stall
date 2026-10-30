import { Loader2 } from 'lucide-react'
import { quickBillAssigneeLabel } from '../lib/quickBillAssignees.js'

/**
 * @param {{
 *   id?: string,
 *   value: string,
 *   onChange: (assigneeUserId: string) => void,
 *   users: import('../lib/quickBillAssignees.js').QuickBillAssignee[],
 *   loading?: boolean,
 *   disabled?: boolean,
 *   hint?: string | null,
 * }} props
 */
export default function QuickBillAssigneeSelect({
  id = 'quick-bill-assignee',
  value,
  onChange,
  users,
  loading = false,
  disabled = false,
  hint = null,
}) {
  return (
    <label className="admin-field admin-quick-bill__assign-field" htmlFor={id}>
      <span className="admin-label">Assign to</span>
      <select
        id={id}
        className="admin-input admin-quick-bill__assign-select"
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {quickBillAssigneeLabel(user)}
          </option>
        ))}
      </select>
      {loading ? (
        <span className="admin-hint">
          <Loader2 size={14} className="inline animate-spin" aria-hidden="true" /> Loading owners…
        </span>
      ) : null}
      {hint ? <span className="admin-hint">{hint}</span> : null}
    </label>
  )
}
