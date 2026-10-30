import { Minus, Plus } from 'lucide-react'
import { formatINR } from '../../utils/currency.js'
import { paiseToInrHelper } from '../lib/moneyDisplay.js'
import AdminProductNameWithCompany from './AdminProductNameWithCompany.jsx'
import { resolveQuotationLineUnitType, quotationLineDisplayProductName } from '../lib/adminCustomerRequestQuotationDisplay.js'

/** @param {unknown} paise */
function formatPaiseOrDash(paise) {
  const p = Number(paise)
  if (!Number.isInteger(p) || p < 0) return '—'
  return formatINR(paiseToInrHelper(p))
}

/**
 * Read-only compact billing line (saved request / quotation).
 *
 * @param {{
 *   productName: string,
 *   company?: unknown,
 *   quantity: unknown,
 *   unitType?: unknown,
 *   sellingUnitPaise: unknown,
 *   sellingLinePaise: unknown,
 *   finalUnitPaise?: unknown,
 *   finalLinePaise?: unknown,
 *   finalUsesSellingFallback?: boolean,
 *   showInternalFinal?: boolean,
 * }} props
 */
export default function AdminCustomerRequestQuotationLineCard({
  productName,
  company,
  quantity,
  unitType,
  sellingUnitPaise,
  sellingLinePaise,
  finalUnitPaise,
  finalLinePaise,
  finalUsesSellingFallback,
  showInternalFinal,
}) {
  const name = quotationLineDisplayProductName(productName)
  const resolvedUnit = resolveQuotationLineUnitType(unitType, productName)
  const qty = Number(quantity)
  const qtyDisplay = Number.isInteger(qty) && qty > 0 ? qty : '—'
  const isLoose = resolvedUnit === 'piece'

  const showSellingUnit = Number.isInteger(Number(sellingUnitPaise)) && Number(sellingUnitPaise) > 0
  const showSellingLine = Number.isInteger(Number(sellingLinePaise)) && Number(sellingLinePaise) >= 0
  const showFinal =
    showInternalFinal &&
    Number.isInteger(Number(finalUnitPaise)) &&
    Number(finalUnitPaise) > 0

  return (
    <article
      className={`admin-request-detail__bill-line admin-request-detail__bill-line--compact${showFinal ? ' admin-request-detail__bill-line--dual' : ''}`}
    >
      <div className="admin-request-detail__bill-line-top">
        <h4 className="admin-request-detail__bill-line-name">
          <AdminProductNameWithCompany
            name={name}
            company={company}
            className="admin-product-name-with-company--inline-sm"
          />
        </h4>
        <div className="admin-request-detail__bill-line-controls">
          <div className="admin-request-detail__bill-unit-pills" role="group" aria-label="Unit on this bill">
            <span
              className={
                isLoose
                  ? 'admin-request-detail__bill-unit-pill'
                  : 'admin-request-detail__bill-unit-pill admin-request-detail__bill-unit-pill--active'
              }
            >
              Box
            </span>
            <span
              className={
                isLoose
                  ? 'admin-request-detail__bill-unit-pill admin-request-detail__bill-unit-pill--active'
                  : 'admin-request-detail__bill-unit-pill'
              }
            >
              Loose pc
            </span>
          </div>
          <div
            className="admin-request-detail__bill-qty"
            role="group"
            aria-label={`Quantity: ${qtyDisplay} ${isLoose ? 'loose pieces' : 'boxes'}`}
          >
            <button type="button" className="admin-request-detail__bill-qty-btn" disabled tabIndex={-1} aria-hidden="true">
              <Minus size={20} strokeWidth={2.5} aria-hidden="true" />
            </button>
            <span className="admin-request-detail__bill-qty-value tabular-nums">{qtyDisplay}</span>
            <button type="button" className="admin-request-detail__bill-qty-btn" disabled tabIndex={-1} aria-hidden="true">
              <Plus size={20} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="admin-request-detail__bill-price-grid">
        <div className="admin-request-detail__bill-price-col">
          <span className="admin-request-detail__bill-price-col-title">Selling</span>
          <dl className="admin-request-detail__bill-price-mini">
            <div className="admin-request-detail__bill-price-mini-row">
              <dt>Unit</dt>
              <dd className="tabular-nums">{showSellingUnit ? formatPaiseOrDash(sellingUnitPaise) : '—'}</dd>
            </div>
            <div className="admin-request-detail__bill-price-mini-row admin-request-detail__bill-price-mini-row--line">
              <dt>Line</dt>
              <dd className="admin-request-detail__bill-price-line-amount tabular-nums">
                {showSellingLine ? formatPaiseOrDash(sellingLinePaise) : '—'}
              </dd>
            </div>
          </dl>
        </div>
        {showFinal ? (
          <div className="admin-request-detail__bill-price-col admin-request-detail__bill-price-col--final">
            <span className="admin-request-detail__bill-price-col-title">
              Final (Internal)
              {finalUsesSellingFallback ? (
                <span className="admin-request-detail__final-fallback-hint"> · Selling</span>
              ) : null}
            </span>
            <dl className="admin-request-detail__bill-price-mini">
              <div className="admin-request-detail__bill-price-mini-row">
                <dt>Unit</dt>
                <dd className="tabular-nums">{formatPaiseOrDash(finalUnitPaise)}</dd>
              </div>
              <div className="admin-request-detail__bill-price-mini-row admin-request-detail__bill-price-mini-row--line">
                <dt>Line</dt>
                <dd className="admin-request-detail__bill-price-line-amount tabular-nums">
                  {formatPaiseOrDash(finalLinePaise)}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
    </article>
  )
}
