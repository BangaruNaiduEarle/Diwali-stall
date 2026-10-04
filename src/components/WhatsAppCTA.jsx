import { MessageCircle } from 'lucide-react'
import { hasWhatsApp } from '../data/siteConfig'
import { getWhatsAppEnquiryUrl } from '../utils/whatsapp'

export default function WhatsAppCTA() {
  const enquiryUrl = getWhatsAppEnquiryUrl()
  const whatsappReady = hasWhatsApp() && enquiryUrl

  return (
    <section
      className="py-10 sm:py-14"
      aria-labelledby="whatsapp-cta-heading"
    >
      <div className="container-page">
        <div className="mx-auto max-w-2xl rounded-xl border border-diwali-border/80 bg-white px-6 py-10 text-center shadow-sm sm:px-10">
          <h2
            id="whatsapp-cta-heading"
            className="text-xl font-semibold text-diwali-ink sm:text-2xl"
          >
            Ready to plan your Diwali crackers?
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-diwali-muted sm:text-base">
            Build your estimate and send it to us on WhatsApp when the next
            phase is live. Browse the catalogue to get started.
          </p>

          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
            <a
              href="#crackers"
              className="focus-ring inline-flex min-h-11 items-center justify-center rounded-lg bg-diwali-navy px-8 py-2.5 text-sm font-semibold text-diwali-cream hover:bg-diwali-navy-muted"
            >
              Explore crackers
            </a>

            {whatsappReady ? (
              <a
                href={enquiryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-diwali-border bg-diwali-cream/50 px-8 py-2.5 text-sm font-semibold text-diwali-navy hover:border-diwali-gold/40"
              >
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
                WhatsApp enquiry
              </a>
            ) : null}
          </div>

          <div className="mt-8 border-t border-diwali-border/60 pt-6">
            <button
              type="button"
              disabled
              className="inline-flex min-h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-diwali-border bg-diwali-cream/30 px-6 py-2 text-sm font-medium text-diwali-muted sm:w-auto"
              aria-describedby="whatsapp-order-hint"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Send order on WhatsApp
            </button>
            <p id="whatsapp-order-hint" className="mt-3 text-xs text-diwali-muted">
              Available after you add products to My Estimate and complete review.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
