import {
  Bomb,
  CircleDot,
  Gift,
  Grid3x3,
  Rocket,
  Sparkles,
  Star,
  Sun,
  Wind,
  Zap,
} from 'lucide-react'
import { CATALOG_CATEGORIES } from '../data/categories'
import { navigateToCatalogueFilters } from '../utils/catalogueNavigation'
import SectionHeading from './SectionHeading'

const ICONS = {
  all: Grid3x3,
  'gift-boxes': Gift,
  sparklers: Sparkles,
  'flower-pots-fountains': Sun,
  'chakkars-wheels': CircleDot,
  bombs: Bomb,
  bijili: Zap,
  'rockets-shots': Rocket,
  'fancy-multi-shots': Star,
  novelty: Wind,
  others: Grid3x3,
}

export default function CategorySection() {
  return (
    <section
      id="categories"
      className="scroll-mt-28 py-10 sm:py-14"
      aria-labelledby="categories-heading"
    >
      <div className="container-page">
        <SectionHeading
          id="categories-heading"
          eyebrow="Browse"
          title="Shop by category"
          description="Choose a category to open the catalogue with that filter applied."
        />

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {CATALOG_CATEGORIES.map(({ slug, label }) => {
            const Icon = ICONS[slug] || Grid3x3
            return (
              <li key={slug}>
                <a
                  href="#crackers"
                  onClick={() =>
                    navigateToCatalogueFilters({ categorySlug: slug })
                  }
                  className="focus-ring group flex min-h-[7.5rem] flex-col justify-between rounded-lg border border-diwali-border/70 bg-white p-4 shadow-[0_1px_2px_rgba(7,17,31,0.04)] transition-[border-color] hover:border-diwali-gold/40 sm:min-h-[8.5rem] sm:p-5"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-diwali-navy/5 text-diwali-navy transition-colors group-hover:bg-diwali-gold/15 group-hover:text-diwali-gold-dark">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="mt-3 text-sm font-semibold leading-snug text-diwali-navy">
                    {label}
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
