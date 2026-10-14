const PARTICLES = [
  { top: '12%', left: '68%', size: 4, color: '#c9a45c', delay: '0s' },
  { top: '22%', left: '82%', size: 3, color: '#fff4d6', delay: '1.2s' },
  { top: '38%', left: '58%', size: 5, color: '#f2c14e', delay: '0.6s' },
  { top: '55%', left: '72%', size: 3, color: '#c9a45c', delay: '2s' },
  { top: '18%', left: '52%', size: 2, color: '#f2f6fc', delay: '1.8s' },
  { top: '70%', left: '48%', size: 4, color: '#e5a13a', delay: '0.3s' },
  { top: '8%', left: '38%', size: 3, color: '#c9a45c', delay: '2.4s' },
  { top: '48%', left: '88%', size: 2, color: '#fff4d6', delay: '1s' },
]

export default function HeroParticles() {
  return (
    <div className="hero-particles pointer-events-none absolute inset-0 z-[1]" aria-hidden="true">
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="hero-particle"
          style={{
            top: p.top,
            left: p.left,
            width: p.size,
            height: p.size,
            background: p.color,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  )
}
