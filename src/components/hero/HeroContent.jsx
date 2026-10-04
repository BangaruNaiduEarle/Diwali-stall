import { ArrowRight, MessageCircle } from 'lucide-react'
import Button from '../ui/Button'

export default function HeroContent({ whatsAppUrl }) {
  return (
    <div className="relative z-10 mx-auto w-full max-w-[360px] text-center md:mx-0 md:max-w-[560px] md:text-left lg:max-w-[560px]">
      <p className="editorial-label text-[var(--color-gold-light)]">Diwali 2026</p>
      <h1 className="hero-display-title mt-3 font-semibold tracking-[-0.03em] text-[var(--color-white)]">
        Celebrate Diwali
        <span className="mt-1 block text-[var(--color-ivory)]">beautifully.</span>
      </h1>
      <p
        className="mx-auto mt-4 max-w-md text-sm leading-relaxed sm:text-base md:mx-0"
        style={{ color: 'rgba(255,249,240,0.85)' }}
      >
        A curated collection of crackers for every celebration.
      </p>
      <div className="mt-8 flex w-full flex-col gap-3 md:mt-9 md:max-w-none md:flex-row md:items-center md:justify-start">
        <Button
          to="/crackers"
          variant="primary"
          surface="dark"
          size="md"
          iconRight={ArrowRight}
          fullWidth
          className="md:!w-auto md:max-w-none"
        >
          Explore crackers
        </Button>
        {whatsAppUrl ? (
          <Button
            href={whatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="secondary"
            surface="dark"
            size="md"
            icon={MessageCircle}
            fullWidth
            className="md:!w-auto md:max-w-none"
          >
            WhatsApp us
          </Button>
        ) : null}
      </div>
    </div>
  )
}
