import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import Button from './ui/Button'
import { CATALOG_CATEGORIES } from '../data/categories'
import { BUDGET_RANGES } from '../data/budgetRanges'

const ICON = { strokeWidth: 1.8 }

/** Visible category chips on catalogue mobile (/crackers routes). */
const CATALOGUE_MOBILE_CHIP_PREVIEW = 6

function SearchField({ search, onSearchChange, id, className = '' }) {
  return (
    <div className={`relative w-full ${className}`}>
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
        className="focus-ring min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-warm)] bg-[var(--color-white)] py-2 pl-10 pr-10 text-sm text-[var(--color-charcoal)] placeholder:text-[var(--color-muted)]/70 md:max-w-xl"
      />
      {search ? (
        <button
          type="button"
          onClick={() => onSearchChange('')}
          className="focus-ring absolute right-1 top-1/2 inline-flex min-h-10 min-w-10 -translate-y-1/2 items-center justify-center text-[var(--color-muted)]"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" {...ICON} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

function MobileSearchWithFilter({ search, onSearchChange, searchId, onOpenFilters, filtersActive }) {
  return (
    <div className="flex w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border-warm)] bg-[var(--color-white)] md:hidden">
      <div className="relative min-w-0 flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search crackers
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--color-red)]"
          {...ICON}
          aria-hidden="true"
        />
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search crackers..."
          autoComplete="off"
          className="min-h-11 w-full border-0 bg-transparent py-2 pl-10 pr-9 text-sm text-[var(--color-charcoal)] placeholder:text-[var(--color-muted)]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-gold)]/70"
        />
        {search ? (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="focus-ring absolute right-0.5 top-1/2 inline-flex min-h-10 min-w-10 -translate-y-1/2 items-center justify-center text-[var(--color-muted)]"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" {...ICON} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpenFilters}
        className="focus-ring relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center border-l border-[var(--color-border-warm)] text-[var(--color-charcoal)]"
        aria-label={filtersActive ? 'Filters, selections active' : 'Filters'}
      >
        <SlidersHorizontal className="h-[18px] w-[18px] text-[var(--color-red)]" {...ICON} aria-hidden="true" />
        {filtersActive ? (
          <span className="absolute right-1.5 top-2 h-2 w-2 rounded-full bg-[var(--color-maroon)]" aria-hidden="true" />
        ) : null}
      </button>
    </div>
  )
}

function CategoryChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-ui ${
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
    <div className="scroll-chips min-w-0 w-full md:hidden">
      <div className="flex w-max min-w-full gap-2 pb-0.5">
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

function MobileCategoryPreviewRow({
  categorySlug,
  onCategoryChange,
  onOpenMoreFilters,
  moreFiltersActive,
  previewCategories,
}) {
  return (
    <div className="scroll-chips min-w-0 w-full md:hidden">
      <div className="flex w-max max-w-full items-center gap-2 pb-0.5">
        {previewCategories.map(({ slug, label }) => (
          <CategoryChip
            key={slug}
            active={categorySlug === slug}
            onClick={() => onCategoryChange?.(slug)}
          >
            {label}
          </CategoryChip>
        ))}
        <button
          type="button"
          onClick={onOpenMoreFilters}
          className={`focus-ring relative shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-ui ${
            moreFiltersActive
              ? 'border-[var(--color-gold)] bg-[var(--color-white)] text-[var(--color-maroon)] shadow-sm'
              : 'border-[var(--color-border)] bg-[var(--color-ivory)] text-[var(--color-muted)] hover:border-[var(--color-gold)]/60 hover:text-[var(--color-charcoal)]'
          }`}
          aria-pressed={moreFiltersActive}
        >
          More filters
          {moreFiltersActive ? (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--color-maroon)]" aria-hidden="true" />
          ) : null}
        </button>
      </div>
    </div>
  )
}

function FilterRadio({ name, value, checked, onChange, children }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2 text-sm text-[var(--color-charcoal)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--color-gold)]/70">
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
  mobileBudgetOnly = false,
  categorySlugs = null,
  showBudget = true,
}) {
  const categories = useMemo(() => {
    if (mobileBudgetOnly) return []
    const list = CATALOG_CATEGORIES
    if (!categorySlugs) return list
    return list.filter((c) => categorySlugs.includes(c.slug))
  }, [mobileBudgetOnly, categorySlugs])

  return (
    <div className="space-y-6">
      {!mobileBudgetOnly && categories.length ? (
        <div>
          <p id={categoryGroupId} className="editorial-label mb-3 block text-[var(--color-charcoal)]">
            Category
          </p>
          <div className="space-y-0.5" role="radiogroup" aria-labelledby={categoryGroupId}>
            {categories.map(({ slug, label }) => (
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
      ) : null}

      {showBudget ? (
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
              All
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
      ) : null}
    </div>
  )
}

function FilterLink({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring shrink-0 pb-0.5 text-sm font-medium transition-ui ${
        active ? 'filter-link-active' : 'text-[var(--color-muted)] hover:text-[var(--color-red)]'
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
  showBudget = true,
}) {
  return (
    <div className={showBudget ? 'space-y-2.5 md:space-y-3' : ''}>
      <div>
        <p className="sr-only">Category</p>
        <div className="scroll-chips lg:overflow-visible">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:flex-wrap">
            {CATALOG_CATEGORIES.map(({ slug, label }) => (
              <FilterLink key={slug} active={categorySlug === slug} onClick={() => onCategoryChange?.(slug)}>
                {label}
              </FilterLink>
            ))}
          </div>
        </div>
      </div>

      {showBudget ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">Budget</p>
          <div className="scroll-chips flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:overflow-visible">
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
      ) : null}
    </div>
  )
}

function FilterBottomSheet({
  uid,
  sheetRef,
  title,
  onClose,
  children,
  onClear,
  clearLabel,
  onApply,
  applyLabel,
}) {
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[48] bg-[var(--color-maroon)]/20 md:hidden"
        aria-label="Close filters"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="filter-sheet safe-bottom fixed inset-x-0 bottom-0 z-[52] flex max-h-[min(85svh,720px)] flex-col rounded-t-xl border border-[var(--color-border)] bg-[var(--color-ivory)] shadow-[var(--shadow-hover)] outline-none md:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-filter-title`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2
            id={`${uid}-filter-title`}
            className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-charcoal)]"
          >
            {title}
          </h2>
          <button
            type="button"
            className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center"
            onClick={onClose}
            aria-label="Close filters"
          >
            <X className="h-5 w-5" {...ICON} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        <div className="shrink-0 space-y-3 border-t border-[var(--color-border)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="ghost" fullWidth onClick={onClear}>
            {clearLabel}
          </Button>
          <Button type="button" variant="primary" fullWidth onClick={onApply}>
            {applyLabel}
          </Button>
        </div>
      </div>
    </>
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
    showDesktopBudget = true,
    /** /crackers routes: mobile chip preview + more-filters sheet; desktop toolbar pairs with aside gift. */
    catalogueRouteLayout = false,
  } = props

  const [mobileOpen, setMobileOpen] = useState(false)
  const [draftCategory, setDraftCategory] = useState(categorySlug)
  const [draftBudget, setDraftBudget] = useState(budgetId)
  const sheetRef = useRef(null)
  const uid = useId()
  const categoryGroupId = `${uid}-category`
  const budgetGroupId = `${uid}-budget`

  const previewCategories = useMemo(
    () => CATALOG_CATEGORIES.slice(0, CATALOGUE_MOBILE_CHIP_PREVIEW),
    [],
  )
  const overflowCategorySlugs = useMemo(
    () => CATALOG_CATEGORIES.slice(CATALOGUE_MOBILE_CHIP_PREVIEW).map((c) => c.slug),
    [],
  )

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

  const budgetFilterActive = Boolean(budgetId && budgetId !== 'all')
  const categoryInOverflow =
    catalogueRouteLayout && overflowCategorySlugs.includes(String(categorySlug ?? ''))
  const moreFiltersActive = catalogueRouteLayout && categoryInOverflow
  const showBudgetFilters = !catalogueRouteLayout

  const applyMobileFilters = () => {
    if (catalogueRouteLayout) {
      onCategoryChange?.(draftCategory)
    } else {
      onBudgetChange?.(draftBudget)
    }
    setMobileOpen(false)
  }

  const clearDraftFilters = () => {
    if (catalogueRouteLayout) {
      setDraftCategory(categorySlug)
    } else {
      setDraftBudget('all')
    }
  }

  return (
    <div
      className={`catalogue-filters min-w-0 space-y-2 ${catalogueRouteLayout ? 'md:space-y-2.5' : 'md:space-y-2'}`}
    >
      {catalogueRouteLayout ? (
        <SearchField
          id="catalogue-search-mobile"
          search={search}
          onSearchChange={onSearchChange}
          className="md:hidden"
        />
      ) : (
        <MobileSearchWithFilter
          search={search}
          onSearchChange={onSearchChange}
          searchId="catalogue-search-mobile"
          onOpenFilters={() => setMobileOpen(true)}
          filtersActive={budgetFilterActive}
        />
      )}

      <SearchField
        id="catalogue-search"
        search={search}
        onSearchChange={onSearchChange}
        className="hidden md:block"
      />

      {catalogueRouteLayout ? (
        <MobileCategoryPreviewRow
          categorySlug={categorySlug}
          onCategoryChange={onCategoryChange}
          onOpenMoreFilters={() => setMobileOpen(true)}
          moreFiltersActive={moreFiltersActive}
          previewCategories={previewCategories}
        />
      ) : (
        <MobileCategoryScroll categorySlug={categorySlug} onCategoryChange={onCategoryChange} />
      )}

      <div className="hidden md:block">
        <CategoryBudgetFiltersDesktop
          categorySlug={categorySlug}
          onCategoryChange={onCategoryChange}
          budgetId={budgetId}
          onBudgetChange={onBudgetChange}
          showBudget={showBudgetFilters && showDesktopBudget}
        />
        {hasActiveFilters && onClearAll ? (
          <button
            type="button"
            className={`focus-ring text-sm font-medium text-[var(--color-brand)] underline-offset-4 hover:underline ${showBudgetFilters && showDesktopBudget ? 'mt-3' : 'mt-2.5'}`}
            onClick={onClearAll}
          >
            Clear all filters
          </button>
        ) : null}
      </div>

      {mobileOpen ? (
        <FilterBottomSheet
          uid={uid}
          sheetRef={sheetRef}
          title={catalogueRouteLayout ? 'More filters' : 'Filters'}
          onClose={() => setMobileOpen(false)}
          onClear={clearDraftFilters}
          clearLabel={catalogueRouteLayout ? 'Reset selections' : 'Clear budget'}
          onApply={applyMobileFilters}
          applyLabel="Apply filters"
        >
          <CategoryBudgetFiltersSheet
            categorySlug={draftCategory}
            onCategoryChange={setDraftCategory}
            budgetId={draftBudget}
            onBudgetChange={setDraftBudget}
            categoryGroupId={categoryGroupId}
            budgetGroupId={budgetGroupId}
            mobileBudgetOnly={!catalogueRouteLayout}
            categorySlugs={catalogueRouteLayout ? overflowCategorySlugs : null}
            showBudget={showBudgetFilters}
          />
        </FilterBottomSheet>
      ) : null}
    </div>
  )
}
