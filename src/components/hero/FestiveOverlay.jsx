export default function FestiveOverlay() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 90% 70% at 50% 45%, transparent 35%, rgba(74,18,26,0.55) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-[1] opacity-[0.035]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[45%]"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 85% 70% at center bottom, rgba(217,119,6,0.18), transparent 55%)',
        }}
      />
    </>
  )
}
