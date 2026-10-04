import { MessageCircle } from 'lucide-react'
import { getWhatsAppDisplayNumber } from '../data/siteConfig'
import { getWhatsAppEnquiryUrl } from '../utils/whatsapp'
import Button from './ui/Button'

/**
 * Centralized WhatsApp CTA — uses siteConfig + wa.me helper only.
 */
export default function WhatsAppButton({
  variant = 'secondary',
  surface = 'light',
  size = 'md',
  label = 'WhatsApp us',
  showHint = false,
  className = '',
  fullWidth = false,
}) {
  const url = getWhatsAppEnquiryUrl()
  const display = getWhatsAppDisplayNumber()
  if (!url) return null

  return (
    <div className={className}>
      <Button
        variant={variant}
        surface={surface}
        size={size}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        icon={MessageCircle}
        fullWidth={fullWidth}
      >
        {label}
      </Button>
      {showHint && display ? (
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Chat with us on WhatsApp · {display}
        </p>
      ) : null}
    </div>
  )
}
