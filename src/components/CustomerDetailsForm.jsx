import { useCustomerDetails } from '../context/CustomerDetailsContext'

const fieldClass =
  'focus-ring min-h-12 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-warm)] bg-[var(--color-white)] px-3 py-2 text-sm text-[var(--color-charcoal)] placeholder:text-[var(--color-muted)]/70'

export default function CustomerDetailsForm({ id = 'customer-details' }) {
  const { details, errors, setField } = useCustomerDetails()

  return (
    <section id={id} className="surface-card p-5 md:p-6" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-base font-semibold text-[var(--color-charcoal)]">
        Your details
      </h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        We use this only to pre-fill your WhatsApp request. Nothing is sent until you tap the button below.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor={`${id}-name`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Name <span className="text-[var(--color-red)]">*</span>
          </label>
          <input
            id={`${id}-name`}
            type="text"
            autoComplete="name"
            value={details.name}
            onChange={(e) => setField('name', e.target.value)}
            className={fieldClass}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${id}-name-error` : undefined}
          />
          {errors.name ? (
            <p id={`${id}-name-error`} className="mt-1 text-xs text-[var(--color-red)]" role="alert">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={`${id}-mobile`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Mobile number <span className="text-[var(--color-red)]">*</span>
          </label>
          <input
            id={`${id}-mobile`}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="10-digit mobile"
            value={details.mobile}
            onChange={(e) => setField('mobile', e.target.value)}
            className={fieldClass}
            aria-invalid={Boolean(errors.mobile)}
            aria-describedby={errors.mobile ? `${id}-mobile-error` : undefined}
          />
          {errors.mobile ? (
            <p id={`${id}-mobile-error`} className="mt-1 text-xs text-[var(--color-red)]" role="alert">
              {errors.mobile}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={`${id}-area`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Area / locality <span className="text-[var(--color-muted)]">(optional)</span>
          </label>
          <input
            id={`${id}-area`}
            type="text"
            value={details.area}
            onChange={(e) => setField('area', e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-pickup`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Preferred pickup date <span className="text-[var(--color-muted)]">(optional)</span>
          </label>
          <input
            id={`${id}-pickup`}
            type="text"
            placeholder="e.g. Day 2 of the stall"
            value={details.pickupDate}
            onChange={(e) => setField('pickupDate', e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-note`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Special note <span className="text-[var(--color-muted)]">(optional)</span>
          </label>
          <textarea
            id={`${id}-note`}
            rows={3}
            value={details.note}
            onChange={(e) => setField('note', e.target.value)}
            className={`${fieldClass} min-h-[5rem] resize-y py-3`}
          />
        </div>
      </div>
    </section>
  )
}
