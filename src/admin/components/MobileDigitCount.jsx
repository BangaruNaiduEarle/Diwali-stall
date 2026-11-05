export default function MobileDigitCount({ value, id }) {
  if (!value) return null
  const count = value.replace(/\D/g, '').length
  const complete = count === 10
  return (
    <span id={id} className={`admin-hint${complete ? ' admin-hint--success' : ''}`} aria-live="polite" aria-atomic="true">
      {count} of 10 digits entered{complete ? ' · Valid' : ''}
    </span>
  )
}
