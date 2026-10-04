import { IndianRupee } from 'lucide-react'
import { BUDGET_RANGES } from '../data/budgetRanges'
import { navigateToCatalogueFilters } from '../utils/catalogueNavigation'
import SectionHeading from './SectionHeading'

const HINTS = {
  'under-500': 'Starter picks',
  '500-1000': 'Family favourites',
  '1000-2500': 'Celebration packs',
  '2500-plus': 'Grand celebrations',
}

export default function BudgetSection() {
  return (
    <section
      className="py-10 sm:py-14"
      aria-labelledby="budget-heading"
    >
      <div className="container-page">
        <SectionHeading
          id="budget-heading"
          eyebrow="Plan your spend"
          title="Crackers by budget"
          description="Choose a price range to filter the catalogue by selling price."
        />

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BUDGET_RANGES.map(({ id, label }) => (
            <li key={id}>
              <a
                href="#crackers"
                onClick={() => navigateToCatalogueFilters({ budgetId: id })}
                className="focus-ring flex min-h-[5.5rem] flex-col justify-center rounded-lg border border-diwali-border/70 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(7,17,31,0.04)] transition-[border-color] hover:border-diwali-gold/40"
              >
                <span className="flex items-center gap-2 text-base font-semibold text-diwali-navy">
                  <IndianRupee
                    className="h-4 w-4 text-diwali-gold"
                    aria-hidden="true"
                  />
                  {label}
                </span>
                <span className="mt-1 text-sm text-diwali-muted">
                  {HINTS[id]}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
