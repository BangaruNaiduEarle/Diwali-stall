import { ChevronLeft, ChevronRight } from 'lucide-react'
import Button from './ui/Button'

function buildPageList(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages = new Set([1, totalPages, currentPage])
  if (currentPage > 1) pages.add(currentPage - 1)
  if (currentPage < totalPages) pages.add(currentPage + 1)

  const sorted = [...pages].sort((a, b) => a - b)
  const result = []

  for (let i = 0; i < sorted.length; i++) {
    const page = sorted[i]
    const prev = sorted[i - 1]
    if (i > 0 && page - prev > 1) result.push('ellipsis')
    result.push(page)
  }

  return result
}

export default function CataloguePagination({
  currentPage,
  totalPages,
  onPageChange,
}) {
  if (totalPages <= 1) return null

  const pages = buildPageList(currentPage, totalPages)

  return (
    <nav className="mt-10 hairline-t pt-6 md:mt-12 md:pt-8" aria-label="Catalogue pagination">
      <div className="flex items-center justify-between gap-2 sm:justify-center sm:gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ui-btn--pagination !min-h-11"
          icon={ChevronLeft}
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <span className="hidden sm:inline">Previous</span>
          <span className="sr-only sm:hidden">Previous</span>
        </Button>

        <p className="text-center text-sm font-medium tabular-nums text-[var(--color-charcoal)] sm:hidden">
          {currentPage} / {totalPages}
        </p>

        <ul className="hidden max-w-full flex-wrap items-center justify-center sm:flex">
          {pages.map((item, index) =>
            item === 'ellipsis' ? (
              <li key={`e-${index}`} className="px-2 text-sm text-[var(--color-muted)]" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={item}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`ui-btn--pagination !min-h-11 min-w-11 ${item === currentPage ? 'pagination-active !shadow-none' : ''}`}
                  aria-current={item === currentPage ? 'page' : undefined}
                  onClick={() => onPageChange(item)}
                >
                  {item}
                </Button>
              </li>
            ),
          )}
        </ul>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ui-btn--pagination !min-h-11"
          iconRight={ChevronRight}
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <span className="hidden sm:inline">Next</span>
          <span className="sr-only sm:hidden">Next</span>
        </Button>
      </div>
    </nav>
  )
}
