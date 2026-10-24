import { useLocation } from 'react-router-dom'
import { getWhatsAppEnquiryUrl } from '../utils/whatsapp'
import { useEstimate } from '../context/EstimateContext'

/**
 * Fixed WhatsApp chat FAB — stall number from siteConfig via wa.me helper.
 * @param {{ aboveMobileStickyBar?: boolean }} props
 */
export default function FloatingWhatsAppButton({ aboveMobileStickyBar = false }) {
  const url = getWhatsAppEnquiryUrl()
  const { pathname } = useLocation()
  const { estimateCount } = useEstimate()

  if (!url) return null

  const liftForSticky =
    aboveMobileStickyBar && estimateCount > 0 && !pathname.startsWith('/estimate')

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`floating-whatsapp focus-ring${liftForSticky ? ' floating-whatsapp--above-sticky' : ''}`}
      aria-label="Chat with us on WhatsApp"
    >
      <img
        src="/images/whatsapp-icon.jpg"
        alt=""
        className="floating-whatsapp__icon"
        width={84}
        height={84}
        decoding="async"
        aria-hidden="true"
      />
    </a>
  )
}
