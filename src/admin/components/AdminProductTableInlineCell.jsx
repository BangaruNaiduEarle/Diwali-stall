import { useEffect, useId, useRef, useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { saveAdminProductInlineField } from '../lib/adminProductInlineSave.js'

/**
 * @param {{
 *   productId: string
 *   field: import('../lib/adminProductInlineSave.js').AdminProductInlineField
 *   editable: boolean
 *   display: import('react').ReactNode
 *   draftSeed: string
 *   isActive: boolean
 *   onActivate: () => void
 *   onDeactivate: () => void
 *   onSaved: (result: Awaited<ReturnType<typeof saveAdminProductInlineField>>, draft: string) => void
 *   inputMode?: 'text' | 'decimal'
 *   maxLength?: number
 *   className?: string
 * }} props
 */
export default function AdminProductTableInlineCell({
  productId,
  field,
  editable,
  display,
  draftSeed,
  isActive,
  onActivate,
  onDeactivate,
  onSaved,
  inputMode = 'text',
  maxLength,
  className = '',
}) {
  const inputId = useId()
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const [draft, setDraft] = useState(draftSeed)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isActive) setDraft(draftSeed)
  }, [draftSeed, isActive])

  useEffect(() => {
    if (isActive) inputRef.current?.focus()
  }, [isActive])

  async function save() {
    if (saving) return
    if (draft.trim() === draftSeed.trim() && field !== 'sellingPriceInr' && field !== 'finalPriceInr') {
      onDeactivate()
      return
    }
    setSaving(true)
    const result = await saveAdminProductInlineField(productId, field, draft)
    setSaving(false)
    if (result.ok) {
      onSaved(result, draft)
      onDeactivate()
    } else {
      onSaved(result, draft)
    }
  }

  function cancel() {
    if (saving) return
    setDraft(draftSeed)
    onDeactivate()
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    }
  }

  if (!editable) {
    return <div className={className}>{display}</div>
  }

  if (isActive) {
    return (
      <div className={`admin-inline-cell admin-inline-cell--editing ${className}`.trim()} onKeyDown={onKeyDown}>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          inputMode={inputMode}
          className="admin-inline-cell__input"
          value={draft}
          disabled={saving}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Edit ${field}`}
        />
        <div className="admin-inline-cell__actions">
          <button
            type="button"
            className="admin-inline-cell__btn admin-inline-cell__btn--save"
            disabled={saving}
            onClick={save}
            aria-label="Save"
          >
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="admin-inline-cell__btn"
            disabled={saving}
            onClick={cancel}
            aria-label="Cancel"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`admin-inline-cell admin-inline-cell--editable ${className}`.trim()}
      onClick={onActivate}
    >
      <span className="admin-inline-cell__value">{display}</span>
      <Pencil size={14} className="admin-inline-cell__hint" aria-hidden="true" />
    </button>
  )
}
