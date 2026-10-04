export default function PageContainer({ children, className = '' }) {
  return (
    <div className={`container-page py-8 sm:py-10 md:py-12 lg:py-14 ${className}`}>{children}</div>
  )
}
