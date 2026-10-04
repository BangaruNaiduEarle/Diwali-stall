import FestiveOverlay from './FestiveOverlay'
import HeroContent from './HeroContent'
import HeroFestivalArt from './HeroFestivalArt'
import HeroParticles from './HeroParticles'

export default function FestiveHero({ whatsAppUrl }) {
  return (
    <section
      className="festive-hero relative isolate min-h-[520px] overflow-hidden md:min-h-[560px] lg:min-h-[580px]"
      aria-label="Diwali celebration hero"
    >
      <div className="festive-hero-bg pointer-events-none absolute inset-0 z-0" aria-hidden="true" />
      <FestiveOverlay />
      <HeroParticles />

      <div className="container-page relative z-10 flex min-h-[520px] flex-col justify-center py-16 md:min-h-[560px] md:py-16 lg:min-h-[580px]">
        <div className="hero-festival-art--mobile-wrap relative mb-6 md:hidden">
          <HeroFestivalArt variant="mobile" />
        </div>

        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,560px)_1fr] lg:gap-10">
          <HeroContent whatsAppUrl={whatsAppUrl} />
          <HeroFestivalArt variant="desktop" />
        </div>
      </div>
    </section>
  )
}
