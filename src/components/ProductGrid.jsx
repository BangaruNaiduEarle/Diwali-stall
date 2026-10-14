import Button from './ui/Button'
import ProductCard from './ProductCard'

export default function ProductGrid({
  products,
  emptyMessage,
  emptyAction,
  variant = 'light',
}) {
  if (!products.length) {
    const isLight = variant === 'light'
    return (
      <div className="surface-card px-6 py-12 text-center">
        <p className={`text-lg font-semibold ${isLight ? 'text-[var(--color-charcoal)]' : 'text-[var(--color-paper)]'}`}>
          No crackers found
        </p>
        <p className={`mx-auto mt-2 max-w-md text-sm ${isLight ? 'text-[var(--color-muted)]' : 'text-[var(--color-paper)]/75'}`}>
          {emptyMessage ?? 'Try another search or clear your filters.'}
        </p>
        {emptyAction ? <div className="mt-6 flex justify-center">{emptyAction}</div> : null}
      </div>
    )
  }

  return (
    <ul className="grid grid-cols-2 gap-3 gap-y-4 sm:gap-x-3 md:grid-cols-3 md:gap-4 md:gap-y-6 lg:grid-cols-4">
      {products.map((product) => (
        <li key={product.id} className="min-w-0">
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  )
}
