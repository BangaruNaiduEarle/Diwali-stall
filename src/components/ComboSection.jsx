import { Boxes } from 'lucide-react'
import { products } from '../data/products'
import ProductGrid from './ProductGrid'
import SectionHeading from './SectionHeading'

const COMBO_CATEGORY = 'Combo Packs'
const GIFT_BOX_CATEGORY = 'Gift Boxes'

export function getComboProducts(list) {
  return list.filter(
    (product) =>
      product.active !== false &&
      (product.category === COMBO_CATEGORY ||
        product.category === GIFT_BOX_CATEGORY ||
        product.isCombo === true),
  )
}

export default function ComboSection() {
  const combos = getComboProducts(products)

  return (
    <section
      className="py-10 sm:py-14"
      aria-labelledby="combo-heading"
    >
      <div className="container-page">
        <SectionHeading
          id="combo-heading"
          eyebrow="Value packs"
          title="Combo & family packs"
          description="Gift boxes and combo packs from your catalogue appear here."
        />

        {combos.length > 0 ? (
          <ProductGrid products={combos} variant="light" />
        ) : (
          <div className="rounded-2xl border border-diwali-border bg-diwali-cream/60 px-6 py-12 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-diwali-navy/5 text-diwali-gold">
              <Boxes className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="mt-4 text-base font-medium text-diwali-navy">
              Combos from your catalogue
            </p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-diwali-muted">
              When product data includes combo or family packs (for example
              category &quot;{COMBO_CATEGORY}&quot; or &quot;{GIFT_BOX_CATEGORY}
              &quot;), they will list here automatically.
            </p>
            <a
              href="#crackers"
              className="focus-ring mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border border-diwali-navy/20 bg-white px-6 py-2.5 text-sm font-semibold text-diwali-navy hover:border-diwali-gold/50"
            >
              View full catalogue
            </a>
          </div>
        )}
      </div>
    </section>
  )
}
