const ICON_DEFAULT = { strokeWidth: 1.8 }

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center sm:py-20">
      {Icon ? (
        <Icon
          className="mx-auto h-16 w-16 text-[var(--color-gold)]"
          {...ICON_DEFAULT}
          aria-hidden="true"
        />
      ) : null}
      {title ? (
        <h2 className="mt-6 text-xl font-semibold tracking-tight text-[var(--color-charcoal)]">{title}</h2>
      ) : null}
      {description ? (
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[var(--color-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-8">{action}</div> : null}
    </div>
  )
}
