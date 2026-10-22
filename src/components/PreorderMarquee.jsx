const PREORDER_MESSAGES = [
  'PRE-ORDER NOW & GET THE BEST DISCOUNTS',
  'FREE DOOR DELIVERY ON ORDERS OF ₹1,000 OR MORE',
  'CHOOSE YOUR DIWALI FAMILY PACK TODAY',
]

const SEPARATOR = '✦'

function MarqueeSequence() {
  return (
    <span className="preorder-marquee__sequence inline-flex shrink-0 items-center whitespace-nowrap">
      {PREORDER_MESSAGES.map((message, index) => (
        <span key={message} className="inline-flex shrink-0 items-center whitespace-nowrap">
          {index > 0 ? (
            <span className="preorder-marquee__sep px-4 md:px-5" aria-hidden="true">
              {SEPARATOR}
            </span>
          ) : null}
          <span className="preorder-marquee__msg">{message}</span>
        </span>
      ))}
    </span>
  )
}

export default function PreorderMarquee() {
  const staticText = PREORDER_MESSAGES.join(` ${SEPARATOR} `)

  return (
    <section className="preorder-marquee" aria-label="Preorder announcements">
      <div className="preorder-marquee__viewport overflow-hidden">
        <div className="preorder-marquee__track flex w-max items-center">
          <div className="preorder-marquee__group flex shrink-0 items-center">
            <MarqueeSequence />
          </div>
          <div className="preorder-marquee__group flex shrink-0 items-center" aria-hidden="true">
            <MarqueeSequence />
          </div>
        </div>
        <p className="preorder-marquee__static truncate px-4">{staticText}</p>
      </div>
    </section>
  )
}
