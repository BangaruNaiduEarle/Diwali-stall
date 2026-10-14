export default function PageHeader({ eyebrow, title, description }) {
  return (
    <header className="mb-8 max-w-2xl md:mb-10">
      {eyebrow ? <p className="editorial-label leading-snug">{eyebrow}</p> : null}
      <h1 className="editorial-title mt-2">{title}</h1>
      {description ? <p className="editorial-lead mt-3 leading-relaxed md:mt-4">{description}</p> : null}
    </header>
  )
}
