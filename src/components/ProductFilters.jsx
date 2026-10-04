import { useEffect, useId, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import Button from './ui/Button'
import { CATALOG_CATEGORIES } from '../data/categories'
import { BUDGET_RANGES } from '../data/budgetRanges'

const ICON = { strokeWidth: 1.8 }

function SearchField({ search, onSearchChange, id }) {
  return (
    <div className="relative w-full max-w-xl">
      <label htmlFor={id} className="sr-only">
        Search crackers
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--color-red)]"
        {...ICON}
        aria-hidden="true"
      />
      <input
        id={id}
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search crackers..."
        autoComplete="off"
        className="focus-ring catalogue-search-input min-h-12 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-warm)] bg-[var(--color-white)] py-2 pl-10 pr-11 text-sm text-[var(--color-charcoal)] placeholder:text-[var(--color-muted)]/70 md:border-0 md:border-b md:bg-transparent md:pl-8 md:pr-8 md:rounded-none"
      />
      {search ? (
        <button
          type="button"
          onClick={() => onSearchChange('')}
          className="focus-ring absolute right-1 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center text-[var(--color-muted)] md:right-0"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" {...ICON} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

function CategoryChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring shrink-0 rounded-full border px-3.5 py-2 text-xs font-semibold transition-ui ${
        active
          ? 'border-[var(--color-gold)] bg-[var(--color-white)] text-[var(--color-maroon)] shadow-sm'
          : 'border-[var(--color-border)] bg-[var(--color-ivory)] text-[var(--color-muted)] hover:border-[var(--color-gold)]/60 hover:text-[var(--color-charcoal)]'
      }`}
    >
      {children}
    </button>
  )
}

function MobileCategoryScroll({ categorySlug, onCategoryChange }) {
  return (
    <div className="scroll-chips -mx-1 px-1 md:hidden">
      <div className="flex gap-2 pb-1">
        {CATALOG_CATEGORIES.map(({ slug, label }) => (
          <CategoryChip
            key={slug}
            active={categorySlug === slug}
            onClick={() => onCategoryChange?.(slug)}
          >
            {label}
          </CategoryChip>
        ))}
      </div>
    </div>
  )
}

function FilterRadio({ name, value, checked, onChange, children }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2 text-sm text-[var(--color-charcoal)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--color-gold)]/70">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-[var(--color-brand)]"
      />
      {children}
    </label>
  )
}

function CategoryBudgetFiltersSheet({
  categorySlug,
  onCategoryChange,
  budgetId,
  onBudgetChange,
  categoryGroupId,
  budgetGroupId,
}) {
  return (
    <div className="space-y-6">
      <div>
        <p id={categoryGroupId} className="editorial-label mb-3 block text-[var(--color-charcoal)]">
          Category
        </p>
        <div className="space-y-0.5" role="radiogroup" aria-labelledby={categoryGroupId}>
          {CATALOG_CATEGORIES.map(({ slug, label }) => (
            <FilterRadio
              key={slug}
              name="filter-category"
              value={slug}
              checked={categorySlug === slug}
              onChange={() => onCategoryChange?.(slug)}
            >
              {label}
            </FilterRadio>
          ))}
        </div>
      </div>

      <div>
        <p id={budgetGroupId} className="editorial-label mb-3 block text-[var(--color-charcoal)]">
          Budget
        </p>
        <div className="space-y-0.5" role="radiogroup" aria-labelledby={budgetGroupId}>
          <FilterRadio
            name="filter-budget"
            value="all"
            checked={!budgetId || budgetId === 'all'}
            onChange={() => onBudgetChange('all')}
          >
            All budgets
          </FilterRadio>
          {BUDGET_RANGES.map(({ id, label }) => (
            <FilterRadio
              key={id}
              name="filter-budget"
              value={id}
              checked={budgetId === id}
              onChange={() => onBudgetChange(id)}
            >
              {label}
            </FilterRadio>
          ))}
        </div>
      </div>
    </div>
  )
}

function FilterLink({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring transition-ui shrink-0 pb-0.5 text-sm font-medium ${
        active
          ? 'filter-link-active'
          : 'text-[var(--color-muted)] hover:text-[var(--color-red)]'
      }`}
    >
      {children}
    </button>
  )
}

function CategoryBudgetFiltersDesktop({
  categorySlug,
  onCategoryChange,
  budgetId,
  onBudgetChange,
}) {
  return (
    <div className="space-y-5">
      <div className="block">
        <p className="sr-only">Category</p>
        <div className="scroll-chips lg:overflow-visible">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:flex-wrap">
            {CATALOG_CATEGORIES.map(({ slug, label }) => (
              <FilterLink
                key={slug}
                active={categorySlug === slug}
                onClick={() => onCategoryChange?.(slug)}
              >
                {label}
              </FilterLink>
            ))}
          </div>
        </div>
      </div>

      <div className="block">
        <p className="editorial-label mb-2 block">Budget</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <FilterLink active={!budgetId || budgetId === 'all'} onClick={() => onBudgetChange('all')}>
            All
          </FilterLink>
          {BUDGET_RANGES.map(({ id, label }) => (
            <FilterLink key={id} active={budgetId === id} onClick={() => onBudgetChange(id)}>
              {label}
            </FilterLink>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ProductFilters(props) {
  const {
    categorySlug,
    onCategoryChange,
    budgetId,
    onBudgetChange,
    onClearAll,
    hasActiveFilters,
    search,
    onSearchChange,
  } = props

  const [mobileOpen, setMobileOpen] = useState(false)
  const [draftCategory, setDraftCategory] = useState(categorySlug)
  const [draftBudget, setDraftBudget] = useState(budgetId)
  const sheetRef = useRef(null)
  const uid = useId()
  const categoryGroupId = `${uid}-category`
  const budgetGroupId = `${uid}-budget`

  useEffect(() => {
    if (!mobileOpen) return
    setDraftCategory(categorySlug)
    setDraftBudget(budgetId)
  }, [mobileOpen, categorySlug, budgetId])

  useEffect(() => {
    if (!mobileOpen) return
    document.body.style.overflow = 'hidden'
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    sheetRef.current?.focus()
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [mobileOpen])

  const applyMobileFilters = () => {
    onCategoryChange?.(draftCategory)
    onBudgetChange?.(draftBudget)
    setMobileOpen(false)
  }

  const clearDraftFilters = () => {
    setDraftCategory('all')
    setDraftBudget('all')
  }

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between md:block">
        <SearchField id="catalogue-search" search={search} onSearchChange={onSearchChange} />
        <button
          type="button"
          className="focus-ring flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-warm)] bg-[var(--color-white)] text-sm font-medium text-[var(--color-charcoal)] sm:w-auto sm:min-w-[8.5rem] md:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4 text-[var(--color-red)]" {...ICON} aria-hidden="true" />
          Filters
        </button>
      </div>

      <MobileCategoryScroll categorySlug={categorySlug} onCategoryChange={onCategoryChange} />

      <div className="hidden md:block">
        <CategoryBudgetFiltersDesktop
          categorySlug={categorySlug}
          onCategoryChange={onCategoryChange}
          budgetId={budgetId}
          onBudgetChange={onBudgetChange}
        />
        {hasActiveFilters && onClearAll ? (
          <button
            type="button"
            className="focus-ring mt-4 text-sm font-medium text-[var(--color-brand)] underline-offset-4 hover:underline"
            onClick={onClearAll}
          >
            Clear all filters
          </button>
        ) : null}
      </div>

      {mobileOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-[var(--color-maroon)]/20 md:hidden"
            aria-label="Close filters"
            onClick={() => setMobileOpen(false)}
          />
          <div
            ref={sheetRef}
            tabIndex={-1}
            className="filter-sheet safe-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[85svh] flex-col rounded-t-xl border border-[var(--color-border)] bg-[var(--color-ivory)] shadow-[var(--shadow-hover)] outline-none md:hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${uid}-filter-title`}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <h2
                id={`${uid}-filter-title`}
                className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-charcoal)]"
              >
                Filters
              </h2>
              <button
                type="button"
                className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center"
                onClick={() => setMobileOpen(false)}
                aria-label="Close filters"
              >
                <X className="h-5 w-5" {...ICON} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <CategoryBudgetFiltersSheet
                categorySlug={draftCategory}
                onCategoryChange={setDraftCategory}
                budgetId={draftBudget}
                onBudgetChange={setDraftBudget}
                categoryGroupId={categoryGroupId}
                budgetGroupId={budgetGroupId}
              />
            </div>
            <div className="shrink-0 space-y-3 border-t border-[var(--color-border)] p-4">
              <Button type="button" variant="ghost" fullWidth onClick={clearDraftFilters}>
                Clear all
              </Button>
              <Button type="button" variant="primary" fullWidth onClick={applyMobileFilters}>
                Apply filters
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
