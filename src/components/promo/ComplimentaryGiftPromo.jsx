export const GIFT_PROMO_PRIMARY = '🎁 A Complimentary Gift With Every Order!'
export const GIFT_PROMO_SUPPORT = 'Celebrate Diwali with a little extra joy.'

function MarqueeItem() {
  return (
    <span className="gift-promo-marquee__item inline-flex shrink-0 items-center whitespace-nowrap px-6 text-[13px] font-semibold tracking-wide text-[var(--color-gold-light)] md:px-8 md:text-sm">
      {GIFT_PROMO_PRIMARY}
      <span className="mx-3 opacity-50" aria-hidden="true">
        •
      </span>
      <span className="font-medium text-[var(--color-gold-light)]/90">{GIFT_PROMO_SUPPORT}</span>
    </span>
  )
}

/**
 * @param {'marquee' | 'strip' | 'inline' | 'aside'} variant
 */
export default function ComplimentaryGiftPromo({ variant = 'strip', className = '' }) {
  if (variant === 'marquee') {
    return (
      <section
        className={`gift-promo-marquee hairline-b border-[var(--color-gold)]/25 bg-[var(--color-maroon-deep)] ${className}`.trim()}
        aria-label="Complimentary gift offer"
      >
        <div className="gift-promo-marquee__viewport overflow-hidden py-2 md:py-2.5">
          <div className="gift-promo-marquee__track flex w-max">
            <div className="gift-promo-marquee__group flex shrink-0">
              <MarqueeItem />
            </div>
            <div className="gift-promo-marquee__group flex shrink-0" aria-hidden="true">
              <MarqueeItem />
            </div>
          </div>
          <p className="gift-promo-marquee__static px-4 py-0.5 text-center text-[13px] font-semibold leading-snug text-[var(--color-gold-light)] md:text-sm">
            {GIFT_PROMO_PRIMARY}{' '}
            <span className="font-medium text-[var(--color-gold-light)]/90">{GIFT_PROMO_SUPPORT}</span>
          </p>
        </div>
      </section>
    )
  }

  if (variant === 'aside') {
    return (
      <aside
        className={`gift-promo-aside min-w-0 rounded-[var(--radius-md)] border border-[var(--color-gold)]/35 bg-gradient-to-br from-[var(--color-maroon-deep)] to-[#4a1219] text-[var(--color-gold-light)] shadow-sm ${className}`.trim()}
        aria-label="Complimentary gift offer"
      >
        <p className="gift-promo-aside__heading text-sm font-semibold leading-snug md:text-[15px] md:leading-snug">
          {GIFT_PROMO_PRIMARY}
        </p>
        <p className="gift-promo-aside__support text-[13px] font-medium leading-snug text-[var(--color-gold-light)]/88 md:text-sm md:leading-relaxed">
          {GIFT_PROMO_SUPPORT}
        </p>
      </aside>
    )
  }

  if (variant === 'inline') {
    return (
      <aside
        className={`gift-promo-inline rounded-[var(--radius-md)] border border-[var(--color-gold)]/35 bg-gradient-to-br from-[var(--color-maroon-deep)] to-[#4a1219] px-3 py-3 text-[13px] leading-snug text-[var(--color-gold-light)] shadow-sm md:px-3.5 md:py-3.5 md:text-sm ${className}`.trim()}
        aria-label="Complimentary gift offer"
      >
        <p className="font-semibold leading-snug">{GIFT_PROMO_PRIMARY}</p>
        <p className="mt-1 text-[12px] font-medium leading-snug text-[var(--color-gold-light)]/88 md:text-[13px]">
          {GIFT_PROMO_SUPPORT}
        </p>
      </aside>
    )
  }

  return (
    <section
      className={`gift-promo-strip gift-promo-strip--enter hairline-b border-[var(--color-gold)]/25 bg-gradient-to-r from-[var(--color-maroon-deep)] via-[#5a1720] to-[var(--color-maroon-deep)] ${className}`.trim()}
      aria-label="Complimentary gift offer"
    >
      <div className="container-page py-2.5 md:py-3">
        <p className="text-center text-[13px] font-semibold leading-snug text-[var(--color-gold-light)] md:text-sm">
          {GIFT_PROMO_PRIMARY}
        </p>
        <p className="mt-0.5 text-center text-[11px] font-medium leading-snug text-[var(--color-gold-light)]/88 md:text-xs">
          {GIFT_PROMO_SUPPORT}
        </p>
      </div>
    </section>
  )
}
