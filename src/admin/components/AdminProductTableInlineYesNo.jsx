import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { saveAdminProductInlineField } from '../lib/adminProductInlineSave.js'

/**
 * @param {{
 *   productId: string
 *   field: 'allowLooseSale'
 *   value: boolean
 *   onSaved: (result: Awaited<ReturnType<typeof saveAdminProductInlineField>>, draft: string) => void
 *   disabled?: boolean
 *   className?: string
 * }} props
 */
export default function AdminProductTableInlineYesNo({
  productId,
  field,
  value,
  onSaved,
  disabled = false,
  className = '',
}) {
  const [saving, setSaving] = useState(false)

  async function toggle() {
    if (saving || disabled) return
    const next = !value
    setSaving(true)
    const result = await saveAdminProductInlineField(productId, field, next ? '1' : '0')
    setSaving(false)
    onSaved(result, next ? '1' : '0')
  }

  return (
    <button
      type="button"
      className={`admin-inline-cell admin-inline-cell--editable admin-inline-yesno ${className}`.trim()}
      onClick={toggle}
      disabled={saving || disabled}
      aria-pressed={value}
      aria-label={value ? 'Allow loose sale: Yes. Click to set No.' : 'Allow loose sale: No. Click to set Yes.'}
    >
      {saving ? (
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      ) : (
        <span className="admin-inline-cell__value">{value ? 'Yes' : 'No'}</span>
      )}
    </button>
  )
}
