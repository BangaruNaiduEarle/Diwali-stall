import {
  getLocationHeroLine,
  getStallDatesSummary,
  hasLocation,
  hasStallDates,
  siteConfig,
} from './siteConfig'

function stallDatesAnswer() {
  return hasStallDates()
    ? `Our stall runs ${getStallDatesSummary()}. See the Location page for address and timings.`
    : 'Stall dates will be posted on the Location page when confirmed. You can also message us on WhatsApp.'
}

function stallTimingsAnswer() {
  const timings = siteConfig.stallTimings?.trim()
  return timings
    ? `Stall timings: ${timings}. Pickup is at our Diwali stall unless we agree otherwise on WhatsApp.`
    : 'Timings will be posted on the Location page when confirmed.'
}

function locationAnswer() {
  return hasLocation()
    ? `Pickup is at our Diwali stall: ${getLocationHeroLine()}. Open the Location page for maps and directions.`
    : 'Pickup is at our Diwali stall. The address is on the Location page when available, or message us on WhatsApp for directions.'
}

export const FAQ_ITEMS = [
  {
    question: 'How do I browse crackers on my phone?',
    answer:
      'Open Crackers in the menu, search by name, or tap Filters to choose a category and budget. Products appear in a grid — tap a card for details, then Add to estimate.',
  },
  {
    question: 'How do I create an estimate?',
    answer:
      'Browse the catalogue, tap Add to estimate on any available product, and adjust quantities on the card or on the My Estimate page. Your list is saved on this device.',
  },
  {
    question: 'Is the estimate a confirmed order?',
    answer:
      'No. The estimate is a draft on your device only. Nothing is confirmed until the stall replies on WhatsApp and agrees on availability and final price.',
  },
  {
    question: 'How do I send my estimate on WhatsApp?',
    answer:
      'On My Estimate, enter your name and mobile number, review the summary, then tap Send request on WhatsApp. That opens WhatsApp with a pre-filled message — you still send it from your phone.',
  },
  {
    question: 'What happens after I send the WhatsApp message?',
    answer:
      'The stall reviews your list, confirms what is in stock, and agrees on the final price on WhatsApp. There is no online payment on this website.',
  },
  {
    question: 'Can I change quantities or remove items?',
    answer:
      'Yes. On My Estimate you can increase or decrease quantities, remove lines, or clear the whole list before sending WhatsApp.',
  },
  {
    question: 'How will I know the final price?',
    answer:
      'Listed prices on this site are estimates. Final price and availability are confirmed by the stall on WhatsApp before pickup.',
  },
  {
    question: 'When is the stall open?',
    answer: stallDatesAnswer(),
  },
  {
    question: 'What are the stall timings?',
    answer: stallTimingsAnswer(),
  },
  {
    question: 'Where do I collect my order?',
    answer: locationAnswer(),
  },
  {
    question: 'How do I contact the stall?',
    answer:
      'Use Message us on WhatsApp from the website, Location page, or footer. We can help with product questions and directions.',
  },
]
