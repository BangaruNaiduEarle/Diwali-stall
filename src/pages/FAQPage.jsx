import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { FAQ_ITEMS } from '../data/faqItems'
import PageContainer from '../components/PageContainer'
import { usePageTitle } from '../hooks/usePageTitle'

const ICON = { strokeWidth: 1.8 }

function FaqItem({ item, isOpen, onToggle, headingId, panelId }) {
  return (
    <div className="hairline-b last:border-b-0">
      <h2>
        <button
          type="button"
          id={headingId}
          className={`focus-ring flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left text-[15px] font-semibold transition-ui ${
            isOpen ? 'text-[var(--color-maroon)]' : 'text-[var(--color-charcoal)]'
          }`}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
        >
          {item.question}
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-[var(--color-red)] transition-ui ${isOpen ? 'rotate-180' : ''}`}
            {...ICON}
            aria-hidden="true"
          />
        </button>
      </h2>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        hidden={!isOpen}
        className="border-l-2 border-[var(--color-gold)]/50 pb-5 pl-4 text-sm leading-relaxed text-[var(--color-muted)]"
      >
        {item.answer}
      </div>
    </div>
  )
}

export default function FAQPage() {
  usePageTitle('Frequently asked questions')
  const baseId = useId()
  const [openIndex, setOpenIndex] = useState(0)

  return (
    <PageContainer>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <header className="lg:col-span-4 lg:pt-2">
          <p className="editorial-label-festive">Questions?</p>
          <h1 className="editorial-title mt-2">Everything you need to know before visiting us.</h1>
        </header>

        <div className="lg:col-span-8">
          {FAQ_ITEMS.map((item, index) => (
            <FaqItem
              key={item.question}
              item={item}
              isOpen={openIndex === index}
              onToggle={() => setOpenIndex((c) => (c === index ? -1 : index))}
              headingId={`${baseId}-h-${index}`}
              panelId={`${baseId}-p-${index}`}
            />
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
