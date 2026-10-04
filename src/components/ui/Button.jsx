import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { getButtonClassName } from './buttonVariants'

const ICON_SIZE = { sm: 16, md: 18, lg: 18 }
const ICON_STROKE = 1.8

export default function Button({
  variant = 'primary',
  surface = 'light',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  fullWidth = false,
  to,
  href,
  children,
  className = '',
  type = 'button',
  disabled = false,
  ...props
}) {
  const cls = getButtonClassName({ variant, surface, size, fullWidth, className })
  const iconPx = ICON_SIZE[size] ?? ICON_SIZE.md
  const isDisabled = disabled || loading

  const content = (
    <>
      {loading ? (
        <Loader2 className="ui-btn__icon animate-spin" width={iconPx} height={iconPx} strokeWidth={ICON_STROKE} aria-hidden="true" />
      ) : Icon ? (
        <Icon className="ui-btn__icon shrink-0" width={iconPx} height={iconPx} strokeWidth={ICON_STROKE} aria-hidden="true" />
      ) : null}
      {children ? <span className="ui-btn__label">{children}</span> : null}
      {!loading && IconRight ? (
        <IconRight className="ui-btn__icon shrink-0" width={iconPx} height={iconPx} strokeWidth={ICON_STROKE} aria-hidden="true" />
      ) : null}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={cls} aria-disabled={isDisabled || undefined} {...props}>
        {content}
      </Link>
    )
  }

  if (href) {
    return (
      <a
        href={href}
        className={cls}
        aria-disabled={isDisabled || undefined}
        {...props}
      >
        {content}
      </a>
    )
  }

  return (
    <button type={type} className={cls} disabled={isDisabled} {...props}>
      {content}
    </button>
  )
}
