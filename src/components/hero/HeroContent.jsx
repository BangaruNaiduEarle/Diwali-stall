import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Grid3x3, Tag } from 'lucide-react'

const ICON = { strokeWidth: 1.8 }

const HERO_BENEFITS = [
  { icon: Grid3x3, title: 'Wide Range', text: 'All your favourites' },
  { icon: BadgeCheck, title: 'Best Quality', text: 'Trusted brands' },
  { icon: Tag, title: 'Great Prices', text: 'Value for every celebration' },
]

export default function HeroContent() {
  return (
    <div className="hero-content w-full text-left md:max-w-xl lg:max-w-[34rem]">
      <div className="hero-mobile-body">
        <div className="hero-mobile-copy">
          <p className="hero-eyebrow text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ivory)]/92 md:text-xs md:tracking-[0.2em]">
            Diwali 2026
          </p>
          <h1
            id="hero-heading"
            className="hero-display-title mt-1.5 font-semibold tracking-[-0.03em] text-[var(--color-white)] md:mt-3"
          >
            Celebrate Diwali
            <span className="hero-display-accent mt-0.5 block text-[var(--color-gold-light)] md:mt-1">with quality crackers.</span>
          </h1>
          <p className="hero-lead mt-2 max-w-[18rem] text-[var(--color-ivory)]/88 md:mt-4 md:max-w-md">
            Browse our catalogue, pick family packs, and build your estimate in minutes.
          </p>
        </div>

        <div className="hero-cta-group mt-3 flex w-full min-w-0 md:mt-8">
          <Link to="/crackers" className="hero-btn hero-btn--primary focus-ring">
            <span className="hero-btn__label">Shop Crackers</span>
            <ArrowRight className="hero-btn__icon h-4 w-4 shrink-0 md:h-[18px] md:w-[18px]" {...ICON} aria-hidden="true" />
          </Link>
          <Link to="/packs" className="hero-btn hero-btn--secondary focus-ring">
            <span className="hero-btn__label">View Packs</span>
          </Link>
        </div>

        <p className="hero-trust mt-4 hidden text-sm leading-snug text-[var(--color-ivory)]/80 md:block md:max-w-sm">
          Trusted brands, clear prices, and a simple estimate you can share on WhatsApp when you are ready.
        </p>
      </div>

      <div className="hero-benefits-rail">
        <ul className="hero-benefits grid grid-cols-3 gap-2 md:mt-8 md:gap-4 lg:mt-10">
          {HERO_BENEFITS.map(({ icon: BenefitIcon, title, text }) => (
            <li key={title} className="hero-benefit-item min-w-0">
              <BenefitIcon className="hero-benefit-icon text-[var(--color-gold-light)]" {...ICON} aria-hidden="true" />
              <p className="hero-benefit-title mt-1 font-semibold leading-snug text-[var(--color-white)] md:mt-1.5 md:text-xs">
                {title}
              </p>
              <p className="hero-benefit-text mt-0.5 leading-snug text-[var(--color-ivory)]/78 md:text-[11px]">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
