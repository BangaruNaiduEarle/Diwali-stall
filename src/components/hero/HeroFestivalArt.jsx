import { Flame, Lamp, PartyPopper, Sparkles, Star } from 'lucide-react'

const STROKE_MAIN = 1.15

function DecoIcon({ Icon, className, size, strokeWidth = 1.5, style }) {
  return (
    <Icon
      className={className}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      style={style}
    />
  )
}

export default function HeroFestivalArt({ variant = 'desktop' }) {
  const isMobile = variant === 'mobile'

  if (isMobile) {
    return (
      <div className="hero-festival-art hero-festival-art--mobile pointer-events-none relative mx-auto h-36 w-full max-w-xs sm:h-44 sm:max-w-sm" aria-hidden="true">
        <div className="hero-glow hero-glow--mobile" />
        <DecoIcon Icon={Star} className="hero-icon hero-icon--bg hero-float-slow absolute left-[8%] top-[12%]" size={28} />
        <DecoIcon Icon={Sparkles} className="hero-icon hero-icon--bg hero-float absolute right-[10%] top-[8%]" size={32} />
        <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
          <div className="hero-float">
            <DecoIcon Icon={Lamp} className="hero-main-lamp hero-main-lamp--mobile" size={130} strokeWidth={STROKE_MAIN} />
          </div>
        </div>
        <DecoIcon Icon={Sparkles} className="hero-icon hero-sparkle hero-float-delay absolute bottom-[18%] left-[18%]" size={36} />
        <DecoIcon Icon={Flame} className="hero-icon hero-float-delay-2 absolute bottom-[12%] right-[20%]" size={40} style={{ color: '#e5a13a', opacity: 0.5 }} />
      </div>
    )
  }

  return (
    <div className="hero-festival-art pointer-events-none relative ml-auto hidden h-[min(420px,52vw)] w-full max-w-lg md:block lg:max-w-xl" aria-hidden="true">
      <div className="hero-glow" />

      <DecoIcon Icon={Star} className="hero-icon hero-icon--bg hero-float-slow absolute left-[6%] top-[8%]" size={36} />
      <DecoIcon Icon={Star} className="hero-icon hero-icon--bg hero-float absolute left-[22%] top-[22%]" size={22} />
      <DecoIcon Icon={Sparkles} className="hero-icon hero-icon--bg hero-float-delay absolute right-[12%] top-[6%]" size={40} />
      <DecoIcon Icon={Sparkles} className="hero-icon hero-icon--bg hero-float-slow absolute right-[28%] top-[18%]" size={26} />

      <div className="absolute left-[48%] top-[46%] z-[2] -translate-x-1/2 -translate-y-1/2">
        <div className="hero-float-slow">
          <DecoIcon Icon={Lamp} className="hero-main-lamp" size={220} strokeWidth={STROKE_MAIN} />
        </div>
      </div>

      <div className="absolute left-[18%] top-[58%] hero-float">
        <DecoIcon Icon={Sparkles} className="hero-icon hero-sparkle" size={48} style={{ color: '#f2c14e', opacity: 0.55 }} />
      </div>
      <div className="absolute right-[8%] top-[52%] hero-float-delay-2">
        <DecoIcon Icon={PartyPopper} className="hero-icon" size={56} style={{ color: '#c9a45c', opacity: 0.35 }} />
      </div>
      <div className="absolute bottom-[14%] right-[22%] hero-float-delay">
        <DecoIcon Icon={Flame} className="hero-icon" size={44} style={{ color: '#e5a13a', opacity: 0.55 }} />
      </div>
      <div className="absolute bottom-[22%] left-[32%] hero-float-slow">
        <DecoIcon Icon={Sparkles} className="hero-icon hero-sparkle" size={32} style={{ color: '#fff4d6', opacity: 0.45 }} />
      </div>
      <div className="absolute bottom-[8%] left-[12%] hero-float">
        <DecoIcon Icon={Star} className="hero-icon hero-icon--bg" size={20} />
      </div>
      <div className="absolute top-[38%] right-[6%] hero-float-delay">
        <DecoIcon Icon={Sparkles} className="hero-icon hero-sparkle" size={28} style={{ color: '#d96b4c', opacity: 0.4 }} />
      </div>
    </div>
  )
}
