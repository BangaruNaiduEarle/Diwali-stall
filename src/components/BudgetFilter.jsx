import { BUDGET_RANGES } from '../data/budgetRanges'

export default function BudgetFilter({ value, onChange, variant = 'dark' }) {
  const isDark = variant === 'dark'

  return (
    <fieldset>
      <legend
        className={`mb-2 text-sm font-semibold ${isDark ? 'text-diwali-cream' : 'text-diwali-navy'}`}
      >
        Budget
      </legend>
      <div className="flex flex-wrap gap-2">
        <FilterChip
          label="All budgets"
          selected={!value || value === 'all'}
          onClick={() => onChange('all')}
          isDark={isDark}
        />
        {BUDGET_RANGES.map(({ id, label }) => (
          <FilterChip
            key={id}
            label={label}
            selected={value === id}
            onClick={() => onChange(id)}
            isDark={isDark}
          />
        ))}
      </div>
    </fieldset>
  )
}

function FilterChip({ label, selected, onClick, isDark }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`focus-ring min-h-10 rounded-full px-3 py-2 text-xs font-medium sm:text-sm ${
        selected
          ? isDark
            ? 'bg-diwali-gold text-diwali-navy'
            : 'border border-diwali-gold/40 bg-diwali-gold/15 text-diwali-navy'
          : isDark
            ? 'border border-diwali-cream/20 bg-white/5 text-diwali-cream hover:bg-white/10'
            : 'border border-diwali-border bg-white text-diwali-navy hover:border-diwali-gold/40'
      }`}
    >
      {label}
    </button>
  )
}
