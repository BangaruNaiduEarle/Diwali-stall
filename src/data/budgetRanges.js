/** Budget filter ranges — shared by homepage cards and catalogue filters */
export const BUDGET_RANGES = [
  { id: 'under-500', label: 'Under ₹500' },
  { id: '500-1000', label: '₹500 – ₹1,000' },
  { id: '1000-2500', label: '₹1,000 – ₹2,500' },
  { id: '2500-plus', label: '₹2,500+' },
]

export function productMatchesBudget(price, budgetId) {
  if (!budgetId || budgetId === 'all') return true
  const p = Number(price)
  switch (budgetId) {
    case 'under-500':
      return p < 500
    case '500-1000':
      return p >= 500 && p < 1000
    case '1000-2500':
      return p >= 1000 && p < 2500
    case '2500-plus':
      return p >= 2500
    default:
      return true
  }
}
