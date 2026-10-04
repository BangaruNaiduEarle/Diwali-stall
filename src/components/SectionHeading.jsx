export default function SectionHeading({
  eyebrow,
  title,
  description,
  id,
  variant = 'light',
}) {
  const isDark = variant === 'dark'

  return (
    <header className="mb-6 max-w-2xl sm:mb-8">
      {eyebrow ? (
        <p className={`editorial-label ${isDark ? 'text-[var(--color-gold-soft)]' : ''}`}>{eyebrow}</p>
      ) : null}
      <h2
        id={id}
        className={`editorial-title mt-2 text-xl sm:text-2xl ${isDark ? 'text-[var(--color-paper)]' : ''}`}
      >
        {title}
      </h2>
      {description ? (
        <p className={`editorial-lead mt-3 ${isDark ? 'text-[var(--color-paper)]/70' : ''}`}>
          {description}
        </p>
      ) : null}
    </header>
  )
}
