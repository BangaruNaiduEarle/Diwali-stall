export default function PackContentsTable({ items }) {
  if (!items?.length) return null

  return (
    <>
      <div className="mt-6 hidden overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] md:block">
        <table className="pack-contents-table w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-ivory)]/60 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
              <th className="px-4 py-3 font-semibold">Item</th>
              <th className="px-4 py-3 text-right font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, index) => (
              <tr key={`${row.itemName}-${index}`} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2.5 text-[var(--color-charcoal)]">{row.itemName}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{row.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-6 space-y-2 md:hidden">
        {items.map((row, index) => (
          <li
            key={`${row.itemName}-${index}`}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-white)] px-3 py-2.5 text-sm"
          >
            <p className="font-semibold text-[var(--color-charcoal)]">{row.itemName}</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Qty{' '}
              <span className="tabular-nums font-medium text-[var(--color-charcoal)]">{row.quantity}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}
