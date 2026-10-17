import HeroContent from './HeroContent'

const HERO_BANNER = '/images/diwali-hero-banner.png'

export default function FestiveHero() {
  return (
    <section
      className="diwali-hero relative isolate overflow-hidden md:min-h-[480px] lg:min-h-[540px]"
      aria-labelledby="hero-heading"
    >
      <div
        className="diwali-hero-banner absolute inset-0 z-0 bg-no-repeat md:bg-cover md:bg-center"
        style={{ backgroundImage: `url(${HERO_BANNER})` }}
        role="img"
        aria-label="Diwali banner with diyas, marigolds, rangoli, lanterns, and crackers"
      />
      <div className="diwali-hero-overlay pointer-events-none absolute inset-0 z-[1]" aria-hidden="true" />
      <div className="diwali-hero-glow pointer-events-none absolute inset-0 z-[2]" aria-hidden="true" />

      <div className="diwali-hero-inner container-page relative z-10 mx-auto flex w-full max-w-[82.5rem] flex-col md:grid md:min-h-[480px] md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:items-center md:gap-10 md:py-12 lg:min-h-[540px] lg:gap-14 lg:py-14">
        <HeroContent />
        <div className="hero-visual-column hidden min-h-[16rem] md:block lg:min-h-[19rem]" aria-hidden="true" />
      </div>
    </section>
  )
}
