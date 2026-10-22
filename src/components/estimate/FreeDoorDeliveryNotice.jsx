/** @param {{ message: string, qualified: boolean, qualifyingTotalInr: number }} props */
export default function FreeDoorDeliveryNotice({ message, qualified, qualifyingTotalInr }) {
  if (qualifyingTotalInr <= 0) return null

  return (
    <p
      className={`mt-3 text-sm leading-snug ${qualified ? 'font-semibold text-[var(--color-maroon)]' : 'text-[var(--color-charcoal)]'}`}
      role="status"
    >
      {message}
    </p>
  )
}
