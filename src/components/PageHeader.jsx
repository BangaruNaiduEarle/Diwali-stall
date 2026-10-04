export default function PageHeader({ eyebrow, title, description }) {
  return (
    <header className="mb-10 max-w-2xl">
      {eyebrow ? <p className="editorial-label">{eyebrow}</p> : null}
      <h1 className="editorial-title mt-2">{title}</h1>
      {description ? <p className="editorial-lead mt-4">{description}</p> : null}
    </header>
  )
}
