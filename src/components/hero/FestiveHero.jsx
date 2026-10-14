import HeroContent from './HeroContent'

const HERO_BANNER = '/images/diwali-hero-banner.png'

export default function FestiveHero({ whatsAppUrl }) {
  return (
    <section
      className="diwali-hero relative isolate min-h-[500px] overflow-hidden sm:min-h-[540px] md:min-h-[520px] lg:min-h-[560px]"
      aria-labelledby="hero-heading"
    >
      <div
        className="diwali-hero-banner absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${HERO_BANNER})` }}
        role="img"
        aria-label="Diwali banner with diyas, marigolds, rangoli, lanterns, and crackers"
      />
      <div className="diwali-hero-overlay pointer-events-none absolute inset-0 z-[1]" aria-hidden="true" />

      <div className="diwali-hero-inner container-page relative z-10 mx-auto flex min-h-[500px] max-w-[82.5rem] flex-col justify-center py-10 sm:min-h-[540px] sm:py-12 md:min-h-[520px] md:py-14 lg:min-h-[560px] lg:py-16">
        <HeroContent whatsAppUrl={whatsAppUrl} />
      </div>
    </section>
  )
}
