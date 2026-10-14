import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Grid3x3, MessageCircle, Tag } from 'lucide-react'

const ICON = { strokeWidth: 1.8 }

const HERO_BENEFITS = [
  { icon: Grid3x3, title: 'Wide Range', text: 'All your favourites' },
  { icon: BadgeCheck, title: 'Best Quality', text: 'Trusted brands' },
  { icon: Tag, title: 'Great Prices', text: 'Value for every celebration' },
]

export default function HeroContent({ whatsAppUrl }) {
  return (
    <div className="w-full max-w-[580px] text-left">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-ivory)]/90 sm:text-xs">
        🪔 Diwali 2026
      </p>
      <h1
        id="hero-heading"
        className="hero-display-title mt-3 font-semibold tracking-[-0.03em] text-[var(--color-white)]"
      >
        Celebrate Diwali
        <span className="mt-1 block text-[var(--color-gold-light)]">beautifully.</span>
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--color-ivory)]/88 sm:text-base">
        A curated collection of crackers for every celebration.
      </p>

      <div className="mt-7 flex w-full flex-col gap-3 min-[400px]:flex-row min-[400px]:flex-wrap sm:mt-8 sm:items-center">
        <Link to="/crackers" className="hero-btn hero-btn--primary focus-ring">
          <span>Explore Crackers</span>
          <ArrowRight className="h-[18px] w-[18px] shrink-0" {...ICON} aria-hidden="true" />
        </Link>
        {whatsAppUrl ? (
          <a
            href={whatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hero-btn hero-btn--secondary focus-ring"
          >
            <MessageCircle className="h-[18px] w-[18px] shrink-0" {...ICON} aria-hidden="true" />
            <span>WhatsApp Us</span>
          </a>
        ) : null}
      </div>

      <ul className="mt-8 grid max-w-xl grid-cols-3 gap-2 sm:mt-9 sm:gap-4">
        {HERO_BENEFITS.map(({ icon: BenefitIcon, title, text }) => (
          <li key={title} className="min-w-0">
            <BenefitIcon className="h-[18px] w-[18px] text-[var(--color-gold-light)]" {...ICON} aria-hidden="true" />
            <p className="mt-1.5 text-[11px] font-semibold leading-snug text-[var(--color-white)] sm:text-xs">{title}</p>
            <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-ivory)]/75 sm:text-[11px]">{text}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
