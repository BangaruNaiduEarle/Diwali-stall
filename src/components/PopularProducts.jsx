import CatalogueProductsGate from './catalogue/CatalogueProductsGate'
import { useCatalogueProducts } from '../context/CatalogueProductsContext'
import ProductGrid from './ProductGrid'
import SectionHeading from './SectionHeading'

const MAX_FEATURED = 8

export function getFeaturedProducts(list) {
  return (list ?? []).filter(
    (product) => product.featured && product.active !== false,
  )
}

export default function PopularProducts() {
  const { products, loading, error, refresh } = useCatalogueProducts()
  const featured = getFeaturedProducts(products).slice(0, MAX_FEATURED)

  if (!loading && !error && featured.length === 0) {
    return null
  }

  return (
    <section
      id="popular"
      className="scroll-mt-28 py-10 sm:py-14"
      aria-labelledby="popular-heading"
    >
      <CatalogueProductsGate loading={loading} error={error} onRetry={refresh} compact>
      <div className="container-page">
        <SectionHeading
          id="popular-heading"
          eyebrow="Highlights"
          title="Popular picks"
          description="Featured crackers from the catalogue."
        />
        {!loading && !error ? <ProductGrid products={featured} variant="light" /> : null}
      </div>
      </CatalogueProductsGate>
    </section>
  )
}
