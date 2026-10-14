import { Check } from 'lucide-react'

const STEPS = [
  { id: 'estimate', label: 'Estimate' },
  { id: 'details', label: 'Details' },
  { id: 'review', label: 'Review' },
]

const ICON = { strokeWidth: 2.2 }

export default function EstimateProgress({ currentStep }) {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep)
  const stepNumber = currentIndex + 1

  return (
    <nav className="mt-4 border-t border-[var(--color-border)] pt-4" aria-label="Estimate progress">
      <p className="text-xs font-medium text-[var(--color-muted)] lg:hidden">
        Step {stepNumber} of {STEPS.length} — {STEPS[currentIndex]?.label}
      </p>

      <ol className="mt-2 hidden items-center gap-1 lg:mt-0 lg:flex">
        {STEPS.map((step, index) => {
          const done = index < currentIndex
          const active = index === currentIndex
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
              <span
                className={`inline-flex shrink-0 items-center gap-2 text-xs font-semibold ${
                  active ? 'text-[var(--color-maroon)]' : done ? 'text-[var(--color-charcoal)]' : 'text-[var(--color-muted)]'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${
                    done
                      ? 'border-[var(--color-gold)] bg-[var(--color-gold)]/15'
                      : active
                        ? 'border-[var(--color-red)]'
                        : 'border-[var(--color-border)]'
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" {...ICON} aria-hidden="true" /> : index + 1}
                </span>
                <span className="uppercase tracking-[0.08em]">{step.label}</span>
              </span>
              {index < STEPS.length - 1 ? (
                <span className={`h-px min-w-4 flex-1 ${done ? 'bg-[var(--color-gold)]/50' : 'bg-[var(--color-border)]'}`} />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
