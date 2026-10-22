import { ClipboardList, MapPin, MessageCircle, Store } from 'lucide-react'
import SectionHeading from './SectionHeading'

const BENEFITS = [
  {
    icon: Store,
    title: 'Easy browsing',
    text: 'See categories and prices in one place before you visit the stall.',
  },
  {
    icon: ClipboardList,
    title: 'Build your estimate',
    text: 'Add quantities and see an estimated total before you message us.',
  },
  {
    icon: MessageCircle,
    title: 'Simple WhatsApp ordering',
    text: 'Send your list on WhatsApp when you are ready—no payment on this site.',
  },
  {
    icon: MapPin,
    title: 'Pickup or free delivery',
    text: 'Collect at our stall, or unlock free door delivery on qualifying orders of ₹1,000+ (coverage applies).',
  },
]

export default function WhyChooseUs() {
  return (
    <section
      className="py-10 sm:py-14"
      aria-labelledby="why-heading"
    >
      <div className="container-page">
        <SectionHeading
          id="why-heading"
          eyebrow="Why use this site"
          title="Plan your visit with confidence"
          description="A straightforward path from browsing to WhatsApp—built for our temporary stall."
        />

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ icon: Icon, title, text }) => (
            <li
              key={title}
              className="rounded-lg border border-diwali-border/70 bg-white p-5 shadow-[0_1px_2px_rgba(7,17,31,0.04)]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-diwali-gold/25 bg-diwali-gold/10 text-diwali-gold-dark">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-diwali-navy">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-diwali-muted">
                {text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
