const SIZE = {
  sm: 'ui-btn--sm',
  md: 'ui-btn--md',
  lg: 'ui-btn--lg',
}

const VARIANT_SURFACE = {
  'primary-light': 'ui-btn--primary-light',
  'primary-dark': 'ui-btn--primary-dark',
  'secondary-light': 'ui-btn--secondary-light',
  'secondary-dark': 'ui-btn--secondary-dark',
  'ghost-light': 'ui-btn--ghost-light',
  'ghost-dark': 'ui-btn--ghost-dark',
}

export function getButtonClassName({
  variant = 'primary',
  surface = 'light',
  size = 'md',
  fullWidth = false,
  className = '',
}) {
  const key = `${variant}-${surface}`
  const variantClass = VARIANT_SURFACE[key] ?? VARIANT_SURFACE['primary-light']
  const parts = ['ui-btn', SIZE[size] ?? SIZE.md, variantClass]
  if (fullWidth) parts.push('ui-btn--full')
  if (className) parts.push(className)
  return parts.join(' ')
}
