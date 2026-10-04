import { products } from '../data/products'
import ProductGrid from './ProductGrid'
import SectionHeading from './SectionHeading'

const MAX_FEATURED = 8

export function getFeaturedProducts(list = products) {
  return list.filter(
    (product) => product.featured && product.active !== false,
  )
}

export default function PopularProducts() {
  const featured = getFeaturedProducts().slice(0, MAX_FEATURED)

  if (featured.length === 0) {
    return null
  }

  return (
    <section
      id="popular"
      className="scroll-mt-28 py-10 sm:py-14"
      aria-labelledby="popular-heading"
    >
      <div className="container-page">
        <SectionHeading
          id="popular-heading"
          eyebrow="Highlights"
          title="Popular picks"
          description="Featured crackers from the catalogue."
        />
        <ProductGrid products={featured} variant="light" />
      </div>
    </section>
  )
}
