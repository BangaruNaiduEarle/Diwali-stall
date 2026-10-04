import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import SectionHeading from './SectionHeading'

const FAQ_ITEMS = [
  {
    question: 'How do I create an estimate?',
    answer:
      'Browse the catalogue, choose products, and add them to My Estimate with your quantities. You will see line totals and an estimated total before sending anything on WhatsApp.',
  },
  {
    question: 'Is the estimate a confirmed order?',
    answer:
      'No. The estimate is only a draft on your device. Your order is not confirmed until the business replies on WhatsApp and agrees on availability and final price.',
  },
  {
    question: 'How do I place my order?',
    answer:
      'After you build your estimate, enter your name and mobile number, review the summary, and tap Send order on WhatsApp. That opens WhatsApp with a pre-filled message for the stall to confirm.',
  },
  {
    question: 'Can I change quantities?',
    answer:
      'Yes. In My Estimate you can increase or decrease quantities, remove items, or clear the list and start again before you send the WhatsApp message.',
  },
  {
    question: 'How will I know the final price?',
    answer:
      'The website shows estimated totals from listed prices. Final price and availability are confirmed by the stall on WhatsApp before pickup.',
  },
  {
    question: 'Where do I collect my order?',
    answer:
      'Pickup is at our Diwali stall. The address and timings on this page come from our configuration—check the stall location section or ask us on WhatsApp if you need directions.',
  },
]

function FaqItem({ item, isOpen, onToggle, headingId, panelId }) {
  return (
    <div className="border-b border-diwali-border last:border-b-0">
      <h3>
        <button
          type="button"
          id={headingId}
          className="focus-ring flex min-h-12 w-full items-center justify-between gap-4 py-4 text-left text-base font-semibold text-diwali-navy"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
        >
          {item.question}
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-diwali-gold transition-transform ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        hidden={!isOpen}
        className="pb-4 text-sm leading-relaxed text-diwali-muted"
      >
        {item.answer}
      </div>
    </div>
  )
}

export default function FAQ() {
  const baseId = useId()
  const [openIndex, setOpenIndex] = useState(0)

  return (
    <section
      id="faq"
      className="scroll-mt-28 py-10 sm:py-14"
      aria-labelledby="faq-heading"
    >
      <div className="container-page">
        <SectionHeading
          id="faq-heading"
          eyebrow="Help"
          title="Frequently asked questions"
          description="How browsing, estimates, and WhatsApp fit together."
        />

        <div className="rounded-2xl border border-diwali-border bg-white px-5 shadow-sm sm:px-8">
          {FAQ_ITEMS.map((item, index) => (
            <FaqItem
              key={item.question}
              item={item}
              isOpen={openIndex === index}
              onToggle={() =>
                setOpenIndex((current) => (current === index ? -1 : index))
              }
              headingId={`${baseId}-heading-${index}`}
              panelId={`${baseId}-panel-${index}`}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
