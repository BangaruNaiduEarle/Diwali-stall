import { getStallDatesList } from '../data/siteConfig'
import { useCustomerDetails } from '../context/CustomerDetailsContext'

const fieldClass =
  'focus-ring min-h-12 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-warm)] bg-[var(--color-white)] px-3 py-2 text-sm text-[var(--color-charcoal)] placeholder:text-[var(--color-muted)]/70'

const fieldErrorClass =
  'border-[var(--color-red)] focus:border-[var(--color-red)]'

export default function CustomerDetailsForm({
  id = 'customer-details',
  showIntro = true,
  introEyebrow = 'Your details',
  introTitle = 'Almost there',
  introText = 'Tell us where we can reach you.',
}) {
  const { details, errors, setField, markFieldTouched } = useCustomerDetails()
  const stallDates = getStallDatesList()

  return (
    <section
      id={id}
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] p-5 sm:p-6"
      aria-labelledby={`${id}-heading`}
    >
      {showIntro ? (
        <header className="mb-6 max-w-xl">
          <p className="editorial-label-festive text-[var(--color-maroon)]">{introEyebrow}</p>
          <h2 id={`${id}-heading`} className="editorial-title mt-2 text-xl sm:text-2xl">
            {introTitle}
          </h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">{introText}</p>
        </header>
      ) : (
        <h2 id={`${id}-heading`} className="sr-only">
          Customer details
        </h2>
      )}

      <div className="grid gap-4 md:grid-cols-2 md:gap-x-5">
        <div className="md:col-span-1">
          <label htmlFor={`${id}-name`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Name <span className="text-[var(--color-red)]">*</span>
          </label>
          <input
            id={`${id}-name`}
            type="text"
            autoComplete="name"
            placeholder="Enter your name"
            value={details.name}
            onChange={(e) => setField('name', e.target.value)}
            onBlur={() => markFieldTouched('name')}
            className={`${fieldClass} ${errors.name ? fieldErrorClass : ''}`}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${id}-name-error` : `${id}-name-hint`}
          />
          {errors.name ? (
            <p id={`${id}-name-error`} className="mt-1.5 text-xs font-medium text-[var(--color-red)]" role="alert">
              {errors.name}
            </p>
          ) : (
            <p id={`${id}-name-hint`} className="mt-1.5 text-xs text-[var(--color-muted)]">
              So we know who the estimate is for.
            </p>
          )}
        </div>

        <div className="md:col-span-1">
          <label htmlFor={`${id}-mobile`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Mobile number <span className="text-[var(--color-red)]">*</span>
          </label>
          <div className="flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border-warm)] bg-[var(--color-white)] focus-within:ring-2 focus-within:ring-[var(--color-gold)]/40">
            <span className="flex shrink-0 items-center border-r border-[var(--color-border-warm)] bg-[var(--color-ivory)] px-3 text-sm text-[var(--color-muted)]">
              +91
            </span>
            <input
              id={`${id}-mobile`}
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="Enter 10-digit mobile number"
              value={details.mobile}
              onChange={(e) => setField('mobile', e.target.value)}
              onBlur={() => markFieldTouched('mobile')}
              className={`focus-ring min-h-12 w-full border-0 bg-transparent px-3 py-2 text-sm text-[var(--color-charcoal)] placeholder:text-[var(--color-muted)]/70 ${errors.mobile ? 'aria-invalid' : ''}`}
              aria-invalid={Boolean(errors.mobile)}
              aria-describedby={errors.mobile ? `${id}-mobile-error` : `${id}-mobile-hint`}
            />
          </div>
          {errors.mobile ? (
            <p id={`${id}-mobile-error`} className="mt-1.5 text-xs font-medium text-[var(--color-red)]" role="alert">
              {errors.mobile}
            </p>
          ) : (
            <p id={`${id}-mobile-hint`} className="mt-1.5 text-xs text-[var(--color-muted)]">
              We&apos;ll use this number if we need to contact you about your request.
            </p>
          )}
        </div>

        <div className="md:col-span-1">
          <label htmlFor={`${id}-area`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Area / Locality{' '}
            <span className="font-normal text-[var(--color-muted)]">(optional)</span>
          </label>
          <input
            id={`${id}-area`}
            type="text"
            placeholder="e.g. MVP Colony, Gajuwaka, Madhurawada"
            value={details.area}
            onChange={(e) => setField('area', e.target.value)}
            onBlur={() => markFieldTouched('area')}
            className={fieldClass}
            aria-describedby={`${id}-area-hint`}
          />
          <p id={`${id}-area-hint`} className="mt-1.5 text-xs text-[var(--color-muted)]">
            Optional — our team can collect delivery details later if needed.
          </p>
        </div>

        <div className="md:col-span-2">
          <p className="mb-3 text-sm font-semibold text-[var(--color-maroon)]">Door delivery location</p>
          <p className="mb-3 text-xs leading-relaxed text-[var(--color-muted)]">
            Optional — share a delivery address or Google Maps link if you already know where you&apos;d like delivery.
          </p>
        </div>

        <div className="md:col-span-2">
          <label htmlFor={`${id}-delivery-address`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Delivery address <span className="font-normal text-[var(--color-muted)]">(optional)</span>
          </label>
          <textarea
            id={`${id}-delivery-address`}
            rows={2}
            placeholder="House / flat, street, colony"
            value={details.deliveryAddress}
            onChange={(e) => setField('deliveryAddress', e.target.value)}
            onBlur={() => markFieldTouched('deliveryAddress')}
            className={`${fieldClass} min-h-[4.5rem] resize-y py-3 ${errors.deliveryAddress ? fieldErrorClass : ''}`}
            aria-invalid={Boolean(errors.deliveryAddress)}
          />
          {errors.deliveryAddress ? (
            <p className="mt-1.5 text-xs font-medium text-[var(--color-red)]" role="alert">
              {errors.deliveryAddress}
            </p>
          ) : null}
        </div>

        <div className="md:col-span-1">
          <label htmlFor={`${id}-landmark`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Landmark <span className="font-normal text-[var(--color-muted)]">(optional)</span>
          </label>
          <input
            id={`${id}-landmark`}
            type="text"
            placeholder="Near temple, school, etc."
            value={details.deliveryLandmark}
            onChange={(e) => setField('deliveryLandmark', e.target.value)}
            onBlur={() => markFieldTouched('deliveryLandmark')}
            className={`${fieldClass} ${errors.deliveryLandmark ? fieldErrorClass : ''}`}
          />
          {errors.deliveryLandmark ? (
            <p className="mt-1.5 text-xs font-medium text-[var(--color-red)]" role="alert">
              {errors.deliveryLandmark}
            </p>
          ) : null}
        </div>

        <div className="md:col-span-1">
          <label htmlFor={`${id}-maps`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Google Maps link <span className="font-normal text-[var(--color-muted)]">(optional)</span>
          </label>
          <input
            id={`${id}-maps`}
            type="url"
            inputMode="url"
            placeholder="https://maps.google.com/..."
            value={details.deliveryMapsUrl}
            onChange={(e) => setField('deliveryMapsUrl', e.target.value)}
            onBlur={() => markFieldTouched('deliveryMapsUrl')}
            className={`${fieldClass} ${errors.deliveryMapsUrl ? fieldErrorClass : ''}`}
          />
          {errors.deliveryMapsUrl ? (
            <p className="mt-1.5 text-xs font-medium text-[var(--color-red)]" role="alert">
              {errors.deliveryMapsUrl}
            </p>
          ) : null}
        </div>

        <div className="md:col-span-1">
          <label htmlFor={`${id}-pickup`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Preferred pickup date{' '}
            <span className="font-normal text-[var(--color-muted)]">(optional)</span>
          </label>
          {stallDates.length > 0 ? (
            <select
              id={`${id}-pickup`}
              value={details.pickupDate}
              onChange={(e) => setField('pickupDate', e.target.value)}
              onBlur={() => markFieldTouched('pickupDate')}
              className={`${fieldClass} ${errors.pickupDate ? fieldErrorClass : ''}`}
              aria-invalid={Boolean(errors.pickupDate)}
              aria-describedby={errors.pickupDate ? `${id}-pickup-error` : `${id}-pickup-hint`}
            >
              <option value="">Select date</option>
              {stallDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${id}-pickup`}
              type="text"
              placeholder="Select date"
              value={details.pickupDate}
              onChange={(e) => setField('pickupDate', e.target.value)}
              onBlur={() => markFieldTouched('pickupDate')}
              className={fieldClass}
            />
          )}
          {errors.pickupDate ? (
            <p id={`${id}-pickup-error`} className="mt-1.5 text-xs font-medium text-[var(--color-red)]" role="alert">
              {errors.pickupDate}
            </p>
          ) : (
            <p id={`${id}-pickup-hint`} className="mt-1.5 text-xs text-[var(--color-muted)]">
              Optional — choose the day you&apos;d like to visit the stall.
            </p>
          )}
        </div>

        <div className="md:col-span-2">
          <label htmlFor={`${id}-note`} className="mb-1.5 block text-sm font-medium text-[var(--color-charcoal)]">
            Anything you&apos;d like us to know?{' '}
            <span className="font-normal text-[var(--color-muted)]">(optional)</span>
          </label>
          <textarea
            id={`${id}-note`}
            rows={3}
            placeholder="e.g. Please keep these items ready if available."
            value={details.note}
            onChange={(e) => setField('note', e.target.value)}
            onBlur={() => markFieldTouched('note')}
            className={`${fieldClass} min-h-[5.5rem] resize-y py-3`}
            aria-describedby={`${id}-note-hint`}
          />
          <p id={`${id}-note-hint`} className="mt-1.5 text-xs text-[var(--color-muted)]">
            Optional
          </p>
        </div>
      </div>
    </section>
  )
}
