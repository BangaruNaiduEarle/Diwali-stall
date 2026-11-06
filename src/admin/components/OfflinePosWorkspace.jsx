import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Clock3, CreditCard, FileText, Layers3, Loader2, Minus, Package, Plus, RefreshCw, Search, Settings2, ShieldCheck, ShoppingBag, ShoppingCart, Trash2, UserRound, Wifi, WifiOff, X } from 'lucide-react'
import AdminSeasonSelector from './AdminSeasonSelector.jsx'
import OfflineStorageStatus from './OfflineStorageStatus.jsx'
import OfflineInstall from './OfflineInstall.jsx'
import OfflineAuthorization from './OfflineAuthorization.jsx'
import OfflineHandover from './OfflineHandover.jsx'
import OfflineFinancialSummary from './OfflineFinancialSummary.jsx'
import MobileDigitCount from './MobileDigitCount.jsx'
import FamilyPackSnapshotPreview from './FamilyPackSnapshotPreview.jsx'
import { customerErrors, posLine, posSummary } from '../offline/posPresentation.js'
import { addOfflineProduct, changeOfflineUnit, offlineProductAvailable, validateOfflineItems } from '../offline/offlineCart.js'
import { productMatchesQuickBillSearch } from '../../lib/quickBillProductSearch.js'
import { formatPaymentPaise, PAYMENT_METHOD_OPTIONS } from '../lib/payments.js'
import { rupeesToPaise } from '../lib/billAdjustment.js'
import { offlineScopeKey } from '../offline/storage.js'
import { finalPricePreview } from '../offline/finalPricePreview.js'
import '../../styles/offline-pos.css'

const money = value => value === null || value === undefined ? '—' : formatPaymentPaise(value)
const categoryLabel = slug => String(slug).replace(/[-_]/g, ' ')
const actionLabels = { CREATE: 'Create bill', EDIT: 'Item changes', AGREEMENT: 'Agreed amount', CLOSE: 'Finalization', PAYMENT: 'Payment / hold', HANDOVER: 'QR handover' }

function Action({ icon: Icon, children, variant = '', className = '', ...props }) {
  return <button type="button" className={`pos-button ${variant ? `pos-button--${variant}` : ''} ${className}`} {...props}>{Icon ? <Icon size={18} aria-hidden="true" /> : null}{children}</button>
}
function Status({ icon: Icon = Clock3, tone = '', children }) {
  return <span className={`pos-status ${tone ? `pos-status--${tone}` : ''}`}><Icon size={14} aria-hidden="true" />{children}</span>
}
function Empty({ icon: Icon = ShoppingBag, title, children }) {
  return <div className="pos-empty"><span className="pos-empty__icon"><Icon size={30} /></span><h2>{title}</h2><p>{children}</p></div>
}
function ProductPhoto({ blob, name, id }) {
  const [source, setSource] = useState('')
  useEffect(() => {
    if (!(blob instanceof Blob)) { setSource(''); return }
    const url = URL.createObjectURL(blob)
    setSource(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return <div className="pos-product__image">{source ? <img src={source} alt={name} onError={() => setSource('')} /> : <Package size={30} strokeWidth={1.4} />}<span>{id}</span></div>
}

export default function OfflinePosWorkspace(props) {
  const { session, profile, profileAllowed, catalogue, productImages, familyPacks, packIssues, drafts, operations, editor, online, ready, busy, saving,
    storageDb, storageRevision, shellReady, syncProgress, saveCount, canPrepare, privileged, canFinalize, grantViewAllowed, writable, error, notice, localConflict, deviceConflicts, review,
    hasWorkflow, itemsLocked, closureAcknowledged, requestId, setRequestId, payment, actions } = props
  const [tab, setTab] = useState('sale'), [search, setSearch] = useState(''), [filter, setFilter] = useState('all')
  const [customerOpen, setCustomerOpen] = useState(true)
  const [qrOpen,setQrOpen] = useState(false), [scanRequest,setScanRequest] = useState(0)
  const [scanScope,setScanScope]=useState(null)
  const [cartOpen, setCartOpen] = useState(false), [confirmation, setConfirmation] = useState(false), [validation, setValidation] = useState({})
  const [billFilter, setBillFilter] = useState('all'), [productFeedback, setProductFeedback] = useState(''), [acting, setActing] = useState(false)
  const dialogRef = useRef(null), errorRef = useRef(null), reviewRef = useRef(null), actionLock = useRef(false)
  // Autosave is asynchronous. Disabling a focused input after each keystroke
  // loses focus/selection and turns normal typing into one-character edits.
  const editingLocked = busy || acting || !writable || Boolean(localConflict) || session.seasonSwitching
  const locked = editingLocked || saving
  const rows = useMemo(() => editor ? posSummary(editor, catalogue, operations) : null, [editor, catalogue, operations])
  const finalPrices = useMemo(()=>new Map(grantViewAllowed ? profile.authorization.finalPrices.map(row=>[row.productId,row.finalPricePaise]):[]),[grantViewAllowed,profile])
  const finalPriceTotal=grantViewAllowed&&editor?finalPricePreview(editor.body.items,catalogue,profile.authorization.finalPrices).total:null
  const pending = operations.filter(row => ['pending','syncing'].includes(row.state)).length
  const failures = operations.filter(row => ['failed','conflict'].includes(row.state)).length
  const retainedCaptures=operations.filter(row=>row.state==='discarded'&&row.payload.kind==='PAYMENT'&&row.payload.body.entryType==='PAYMENT'&&row.attempts===0&&!row.recoveredBy)
  const attentionCount=failures+retainedCaptures.length
  const categories = [...new Set(catalogue.map(product => product.category_slug).filter(Boolean))]
  const visibleProducts = catalogue.filter(product => (filter === 'all' || product.category_slug === filter) &&
    (productMatchesQuickBillSearch(search, product.name, product.company, product.id) ||
      Boolean(search.trim()) && String(product.pack ?? '').toLowerCase().includes(search.toLowerCase().trim())))
  const visiblePacks = (filter === 'all' || filter === 'packs') ? familyPacks.filter(pack => `${pack.name} ${pack.variant.label}`.toLowerCase().includes(search.toLowerCase().trim())) : []
  const closed = Boolean(editor?.localClosure) || editor?.serverSnapshot?.request.status === 'closed'
  const count = editor?.body.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) ?? 0
  const errorMessage = error || Object.values(validation)[0]
  const preparedName = session.status === 'authenticated' ? session.location?.name : profile?.label

  useEffect(() => { setValidation({}); setCartOpen(false); setConfirmation(false); setCustomerOpen(true) }, [editor?.draftId])
  useEffect(() => {
    if (errorMessage) { errorRef.current?.focus(); errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
  }, [errorMessage])
  useEffect(() => {
    if (confirmation && !dialogRef.current?.open) dialogRef.current?.showModal()
    if (!confirmation && dialogRef.current?.open) dialogRef.current.close()
  }, [confirmation])
  useEffect(() => { if (!productFeedback) return; const timer = setTimeout(() => setProductFeedback(''), 2400); return () => clearTimeout(timer) }, [productFeedback])

  function goReview() {
    const errors = customerErrors(editor.body.customer)
    try { validateOfflineItems(editor.body.items, catalogue) } catch (reason) { errors.items = reason.message }
    setValidation(errors)
    if (errors.name || errors.mobile) setCustomerOpen(true)
    if (!Object.keys(errors).length) { setCartOpen(false); reviewRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return true }
    return false
  }
  async function submit(kind) {
    if (locked || actionLock.current) return false
    if (['CREATE','EDIT'].includes(kind)) {
      const errors = customerErrors(editor.body.customer)
      try { validateOfflineItems(editor.body.items, catalogue) } catch (reason) { errors.items = reason.message }
      setValidation(errors)
      if (Object.keys(errors).length) return false
    }
    actionLock.current = true; setActing(true)
    try { return Boolean(await actions.queue(kind)) } finally { actionLock.current = false; setActing(false) }
  }
  function newBill() { if (busy || saving || acting || !writable) return; actions.newDraft(); setTab('sale'); setSearch(''); setFilter('all'); setValidation({}) }
  function openDraft(draft) { if (busy || saving) return; actions.choose(draft); setTab('sale') }
  function addProduct(product, unitType = 'box') {
    if (editingLocked || itemsLocked && !review) return
    try {
      actions.patchBody({ items: addOfflineProduct(editor.body.items, product, unitType, crypto.randomUUID()) })
      setValidation({}); setProductFeedback(`${product.name} (${unitType}) added to cart`)
    } catch (reason) { setValidation({ items: reason.message }) }
  }
  function addPack(pack) {
    if (editingLocked || itemsLocked && !review) return
    const items = editor.body.items, found = items.find(item => item.familyPackId === pack.familyPackId)
    if (!found && items.length >= 50) { setValidation({ items: 'Maximum 50 bill lines.' }); return }
    if (found?.quantity >= 99) { setValidation({ items: 'Maximum quantity is 99.' }); return }
    actions.patchBody({ items: found ? items.map(item => item === found ? { ...item, quantity: Number(item.quantity) + 1 } : item) : [...items, {
      lineId: crypto.randomUUID(), familyPackId: pack.familyPackId, quantity: 1, unitType: 'box', familyPackSnapshot: structuredClone(pack),
    }] })
    setProductFeedback(`${pack.name} added to cart`)
  }
  function itemPatch(index, changes) {
    if (editingLocked || itemsLocked && !review) return
    try {
      const items = changes.unitType ? changeOfflineUnit(editor.body.items, index, changes.unitType, catalogue) :
        editor.body.items.map((item, i) => i === index ? { ...item, ...changes } : item)
      actions.patchBody({ items }); setValidation({})
    } catch (reason) { setValidation({ items: reason.message }) }
  }
  const cart = editor ? <>
    {!editor.body.items.length ? <Empty icon={ShoppingCart} title="Your cart is empty">Add products from the catalogue to start this bill.</Empty> : <ul className="pos-cart-lines">{editor.body.items.map((item, index) => {
      const line = posLine(item, editor.sellingCatalogue??catalogue), lineLocked = editingLocked || itemsLocked && !review
      return <li key={item.lineId ?? `${item.productId}:${index}`} className="pos-cart-line">
        <div className="pos-cart-line__top"><div><strong>{line.name}</strong><span>{line.pack || (item.familyPackId ? 'Family Pack' : 'Product')} · {money(line.unitPrice)} / {item.unitType === 'piece' ? 'piece' : 'pack'}</span></div>
          <Action icon={Trash2} variant="icon" aria-label={`Remove ${line.name}`} disabled={lineLocked} onClick={() => actions.patchBody({ items: editor.body.items.filter((_, i) => i !== index) })} /></div>
        <div className="pos-cart-line__bottom"><div className="pos-quantity"><Action icon={Minus} aria-label={`Decrease ${line.name}`} disabled={lineLocked || item.quantity <= 1} onClick={() => itemPatch(index, { quantity: item.quantity - 1 })} />
          <input aria-label={`Quantity for ${line.name}`} type="number" inputMode="numeric" min="1" max="99" value={item.quantity} disabled={lineLocked} onChange={event => itemPatch(index, { quantity: event.target.value === '' ? '' : Number(event.target.value) })} />
          <Action icon={Plus} aria-label={`Increase ${line.name}`} disabled={lineLocked || item.quantity >= 99} onClick={() => itemPatch(index, { quantity: Number(item.quantity) + 1 })} /></div><strong>{money(line.total)}</strong></div>
        {!item.familyPackId ? <><label className="pos-unit">Unit<select aria-label={`Unit for ${line.name}`} value={item.unitType ?? 'box'} disabled={lineLocked} onChange={event => itemPatch(index, { unitType: event.target.value })}><option value="box">Box / pack</option><option value="piece" disabled={!offlineProductAvailable(line.product, 'piece')}>Loose piece</option></select></label><p>{line.boxQuantity} boxes + {line.looseQuantity} loose pieces{line.totalPieces !== null ? ` · ${line.totalPieces} total pieces` : ''}</p></> : <details className="pos-disclosure"><summary>View captured pack composition</summary><FamilyPackSnapshotPreview pack={item.familyPackSnapshot} quantity={item.quantity} /></details>}
        {grantViewAllowed && !item.familyPackId ? <p className="pos-final-price">Final Price snapshot / box: {money(finalPrices.get(item.productId))}</p>:null}
        {privileged && hasWorkflow && !item.familyPackId ? <label className="pos-field pos-field--compact">Selling price override (₹)<input inputMode="decimal" placeholder="Use catalogue price" value={item.priceInr ?? ''} disabled={lineLocked} onChange={event => itemPatch(index, { priceInr: event.target.value })} /></label> : null}
      </li>
    })}</ul>}
    <div className="pos-totals"><div><span>Item subtotal</span><strong>{money(rows.subtotal)}</strong></div>
      {privileged && hasWorkflow && !closed ? <label className="pos-field">Discount for next adjustment (₹)<input inputMode="decimal" value={editor.discountInr ?? ''} disabled={editingLocked} placeholder="0.00" onChange={event => actions.patch({ discountInr: event.target.value })} /></label> : null}
      <div className="pos-totals__total"><span>{rows.amount !== null ? 'Saved agreed amount' : 'Catalogue total'}</span><strong>{money(rows.amount ?? rows.subtotal)}</strong></div>
      <p>Local actions are provisional until acknowledged by the server.</p></div>
  </> : null

  return <main className="offline-pos">
    <header className="pos-header"><div className="pos-brand"><span className="pos-brand__mark"><ShoppingBag size={24} /></span><div><span className="pos-eyebrow">DIWALI · POINT OF SALE</span><h1>{preparedName || 'Billing workspace'}</h1><p>{profileAllowed ? `${profile.scope.seasonId} · ${profile.email}` : 'Select a stall and prepare this device'}</p></div></div>
      <div className="pos-header__status">{privileged && profileAllowed ? <Action variant="outline" disabled={busy||saving||!writable||session.seasonSwitching} onClick={()=>{setTab('workspace');setQrOpen(true);setScanScope(offlineScopeKey(profile.scope));setScanRequest(value=>value+1)}}>Scan bill QR</Action>:null}<Status icon={online ? Wifi : WifiOff} tone={online ? 'success' : 'warning'}>{online ? 'Online' : 'Offline'}</Status>
        <Action icon={attentionCount ? CircleAlert : RefreshCw} variant="soft" onClick={() => { setTab('bills'); setBillFilter('pending') }}>{attentionCount ? `${attentionCount} need attention` : `${pending} pending`}</Action></div></header>
    <nav className="pos-tabs" aria-label="Billing workspace"><button type="button" aria-current={tab === 'sale' ? 'page' : undefined} onClick={() => setTab('sale')}><ShoppingBag size={18} />New sale</button>
      <button type="button" aria-current={tab === 'bills' ? 'page' : undefined} onClick={() => setTab('bills')}><FileText size={18} />Bills & sync{pending ? <span className="pos-count">{pending}</span> : null}</button>
      <button type="button" aria-current={tab === 'workspace' ? 'page' : undefined} onClick={() => setTab('workspace')}><Settings2 size={18} />Workspace</button></nav>
    <div className="pos-content">
      {errorMessage ? <div className="pos-alert pos-alert--error" role="alert" tabIndex={-1} ref={errorRef}><CircleAlert size={20} /><div><strong>Something needs your attention</strong><p>{errorMessage}</p></div></div> : null}
      {notice ? <div className="pos-alert pos-alert--success" role="status"><CheckCircle2 size={20} /><p>{notice}</p></div> : null}
      {productFeedback ? <div className="pos-toast" role="status"><Check size={18} />{productFeedback}</div> : null}
      {!ready ? <div className="pos-loading" role="status"><Loader2 className="pos-spin" />Opening your saved workspace…</div> : null}
      <OfflineInstall visible={tab === 'workspace' || ready && !profileAllowed} />
      {profileAllowed && online && pending > 0 && !busy ? <div className="pos-reconnect" role="status">{pending} saved actions waiting. Open Bills &amp; sync to synchronize.</div> : null}
      {profileAllowed&&tab==='bills'&&retainedCaptures.length?<div className="pos-alert" role="status">{retainedCaptures.length} retained payment captures need review. Open the finalized replacement bill, then return here and use Review retained payment capture. Do not collect the money again.</div>:null}
      {session.seasonSwitching ? <div className="pos-alert" role="status">Confirming selected stall…</div> : null}
      {ready && !profileAllowed ? <section className="pos-panel pos-setup"><h2>Set up this stall once</h2><p>Choose your authorized stall, then save its catalogue on this device. Reuse it for every customer; QR handover is optional.</p>
        {online && session.status === 'authenticated' ? <fieldset disabled={busy || saving} className="pos-selectors"><AdminSeasonSelector /></fieldset> : <p>Sign in online to choose an authorized stall.</p>}
        <Action icon={busy ? Loader2 : ShieldCheck} disabled={!canPrepare} onClick={actions.prepare}>Prepare / refresh selected stall for offline use</Action>
        <Link className="pos-link-button" to="/admin/login">Sign in</Link>
        {session.error ? <p role="alert">{session.error}</p> : null}
        {online && session.status !== 'authenticated' ? <Action variant="outline" onClick={session.retry}>Retry session verification</Action> : null}</section> : null}

      {profileAllowed && tab === 'sale' ? <>
        {!editor ? <section className="pos-welcome pos-panel"><span className="pos-welcome__icon"><ShoppingCart size={38} /></span><span className="pos-eyebrow">A FRESH START</span><h2>Let’s make your next sale.</h2><p>Your stall catalogue is ready. Start a bill or pick up where you left off.</p><Action icon={Plus} disabled={busy || saving || acting || !writable} onClick={newBill}>Start new bill</Action><Action variant="outline" icon={FileText} onClick={() => setTab('bills')}>Open saved bills</Action>
          <div className="pos-welcome__facts"><span><ShieldCheck size={16} />Saved on this device</span><span><Package size={16} />{catalogue.length} products · {familyPacks.length} packs</span></div></section> : <>
          <div className="pos-sale-heading"><div><span className="pos-eyebrow">{editor.serverSnapshot?.request.publicReference || 'LOCAL BILL'}</span><h2>{editor.body.customer.name || 'New customer'}</h2></div><Status icon={saving ? Loader2 : Check} tone={error?.startsWith('Draft was not saved:') ? 'danger' : saving ? '' : 'success'}>{saving ? 'Saving…' : error?.startsWith('Draft was not saved:') ? 'Save failed' : 'Saved on device'}</Status><Action variant="outline" icon={Plus} disabled={locked || Boolean(review)} onClick={newBill}>New bill</Action></div>
          {localConflict ? <section className="pos-panel pos-conflict"><h2>Two tabs changed this bill</h2><p>Both versions are saved. Choose the fields you want, then queue the reviewed action separately.</p><div className="pos-compare"><details open><summary>Your attempted version</summary><pre>{JSON.stringify(localConflict.attemptedDraft, null, 2)}</pre></details><details><summary>Current device version</summary><pre>{JSON.stringify(localConflict.currentDraft, null, 2)}</pre></details></div><Action variant="outline" disabled={busy} onClick={() => actions.resolveLocal(false)}>Keep current device version</Action><Action disabled={busy} onClick={() => actions.resolveLocal(true)}>Use my reviewed fields; queue changes separately</Action></section> : null}
          {review ? <section className="pos-panel pos-conflict"><h2>Review the conflicting action</h2><p>Compare both versions before replacing {actionLabels[review.payload.kind]}. Earlier operations remain in history.</p><div className="pos-compare"><details><summary>Preserved local operation</summary><pre>{JSON.stringify(review.payload, null, 2)}</pre></details><details><summary>Competing server version</summary><pre>{JSON.stringify(review.serverSnapshot, null, 2)}</pre></details><details><summary>Current catalogue</summary><pre>{JSON.stringify(review.serverCatalogue, null, 2)}</pre></details></div><Action disabled={locked} onClick={() => submit(review.payload.kind)}>Queue reviewed {actionLabels[review.payload.kind]}</Action></section> : null}
          <div className="pos-sale-layout"><div className="pos-sale-main">
            {!closed || review ? <>
              <section className="pos-panel pos-customer"><div className="pos-section-heading"><span className="pos-section-icon"><UserRound size={20} /></span><div><h2>Customer details</h2><p>Who are we billing today?</p></div></div>
                {hasWorkflow || !customerOpen ? <div className="pos-customer-summary"><div><strong>{editor.body.customer.name}</strong><span>{editor.body.customer.mobile}</span></div>{!hasWorkflow ? <Action variant="outline" onClick={() => setCustomerOpen(true)}>Edit customer</Action> : null}</div> : <><div className="pos-field-grid"><label className="pos-field">Customer name<input autoComplete="name" aria-invalid={Boolean(validation.name)} value={editor.body.customer.name} disabled={editingLocked} placeholder="Enter customer name" maxLength={80} onChange={event => { setValidation({}); actions.patchBody({ customer: { ...editor.body.customer, name: event.target.value } }) }} />{validation.name ? <span className="pos-field-error">{validation.name}</span> : null}</label>
                  <label className="pos-field">Mobile number<input type="tel" inputMode="numeric" autoComplete="tel" aria-invalid={Boolean(validation.mobile)} aria-describedby={editor.body.customer.mobile ? 'offline-bill-mobile-count' : undefined} value={editor.body.customer.mobile} disabled={editingLocked} placeholder="10-digit mobile number" maxLength={16} onChange={event => { setValidation({}); actions.patchBody({ customer: { ...editor.body.customer, mobile: event.target.value } }) }} /><MobileDigitCount value={editor.body.customer.mobile} id="offline-bill-mobile-count" />{validation.mobile ? <span className="pos-field-error">{validation.mobile}</span> : null}</label></div><Action className="pos-customer-continue" variant="outline" icon={ArrowRight} disabled={locked} onClick={() => { const errors = customerErrors(editor.body.customer); setValidation(errors); if (!Object.keys(errors).length) { setCustomerOpen(false); requestAnimationFrame(() => document.querySelector('.pos-search input')?.focus()); } }}>Continue to products</Action></>}
              </section>
              <section className="pos-catalogue" aria-label="Product catalogue"><div className="pos-section-heading"><div><h2>Products &amp; Family Packs</h2><p>{catalogue.length} saved products · last prepared prices</p></div></div>
                <label className="pos-search"><span className="pos-sr-only">Search products</span><Search size={20} /><input type="search" aria-label="Search products" placeholder="Search products, packs or product ID" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={18} /></button> : null}</label>
                <label className="pos-field pos-category-select">Category<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All products</option>{categories.map(slug => <option key={slug} value={slug}>{categoryLabel(slug)}</option>)}{familyPacks.length ? <option value="packs">Family Packs</option> : null}</select></label><div className="pos-filters pos-filters--catalogue" aria-label="Catalogue categories">{[['all','All products'], ...categories.map(slug => [slug, categoryLabel(slug)]), ...(familyPacks.length ? [['packs','Family Packs']] : [])].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
                {!catalogue.length && !familyPacks.length ? <div className="pos-panel"><Empty icon={Package} title="No saved products yet">Add products to this stall online, then refresh its offline preparation.</Empty><Action variant="outline" disabled={!canPrepare} onClick={actions.prepare}>Refresh catalogue</Action></div> : null}
                <div className="pos-results" tabIndex={0} aria-label="Product results">
                {filter !== 'packs' ? <div className="pos-product-grid">{visibleProducts.map(product => {
                  const available = offlineProductAvailable(product), looseAvailable = offlineProductAvailable(product, 'piece')
                  return <article className="pos-product" key={product.id}><ProductPhoto blob={productImages[product.id]} name={product.name} id={product.id} /><div className="pos-product__body"><span className="pos-product__category">{categoryLabel(product.category_slug)}</span><h3>{product.name}</h3><p>{product.pack || 'Box / pack'}</p>{grantViewAllowed ? <span className='pos-final-price'>Final Price / box: {money(finalPrices.get(product.id))}</span> : null}<div className="pos-product__footer"><strong>{money(product.selling_price_paise)}</strong><Action icon={Plus} variant="soft" disabled={editingLocked || itemsLocked && !review || !available} onClick={() => addProduct(product)} aria-label={`Add ${product.name}`}>{available ? 'Add' : 'Unavailable'}</Action></div>{looseAvailable ? <div className="pos-product__footer"><strong>{money(Math.floor(product.selling_price_paise / product.pieces_per_pack))} / piece</strong><Action icon={Plus} variant="soft" disabled={editingLocked || itemsLocked && !review} onClick={() => addProduct(product, 'piece')} aria-label={`Add ${product.name} loose piece`}>Add piece</Action></div> : null}</div></article>
                })}</div> : null}
                {visiblePacks.length ? <><div className="pos-section-heading pos-pack-heading"><Layers3 size={21} /><h2>Family Packs</h2></div><div className="pos-product-grid">{visiblePacks.map(pack => <article key={pack.familyPackId} className="pos-product pos-product--pack"><div className="pos-product__image"><Layers3 size={32} strokeWidth={1.4} /><span>FAMILY PACK</span></div><div className="pos-product__body"><h3>{pack.name}</h3><p>{pack.variant.label} · {pack.components.length} components</p><details className="pos-disclosure"><summary>View composition</summary><ul>{pack.components.map(component => <li key={component.componentId}>{component.quantity} × {component.productName}</li>)}</ul></details><div className="pos-product__footer"><strong>{money(pack.sellingUnitPaise)}</strong><Action icon={Plus} variant="soft" disabled={editingLocked || itemsLocked && !review} onClick={() => addPack(pack)} aria-label={`Add ${pack.name}`}>Add pack</Action></div></div></article>)}</div></> : null}
                {(catalogue.length || familyPacks.length) && !visiblePacks.length && (filter === 'packs' || !visibleProducts.length) ? <Empty icon={Search} title="No matching products">Try another name or category.</Empty> : null}
                {packIssues.length ? <details className="pos-panel pos-disclosure"><summary>{packIssues.length} Family Packs need online attention</summary>{packIssues.map(issue => <p key={issue.familyPackId}>{issue.familyPackId}: {issue.message}</p>)}</details> : null}
                </div>
              </section>
            </> : null}
            <section ref={reviewRef} className="pos-panel pos-review"><h2>Review &amp; save</h2><details className="pos-disclosure"><summary>{editor.body.items.length} lines · {money(rows.subtotal)} · Review bill items</summary><ul className="pos-order-summary">{editor.body.items.map((item, i) => <li key={item.lineId ?? i}><div><strong>{rows.lines[i].name}</strong><span>{item.quantity} × {money(rows.lines[i].unitPrice)} · {item.unitType === 'piece' ? 'piece' : 'pack'}</span></div><strong>{money(rows.lines[i].total)}</strong></li>)}</ul></details>
              <div className="pos-totals"><div><span>Item subtotal</span><strong>{money(rows.subtotal)}</strong></div></div>
              {grantViewAllowed?<p>Selected items Final Price sum: {money(finalPriceTotal)}{finalPriceTotal===null?' · Unavailable where a captured Final Price is missing.':''}</p>:null}
              {canFinalize ? <label className="pos-field pos-agreed">Customer-agreed amount (₹)<div className="pos-money-input"><span>₹</span><input inputMode="decimal" placeholder="0.00" value={editor.agreedInr ?? ''} disabled={editingLocked || closed && !review} onChange={event => actions.patch({ agreedInr: event.target.value })} /></div><small>Save the agreed amount before finalization.{!privileged?' Admin finalization uses your signed Owner grant; payments require Owner / Super Admin.':''}</small></label> : <p>Save requests and item changes here. Admin finalization requires a valid cached Owner grant in Workspace; payments require Owner / Super Admin.</p>}
              {!review && !closed ? <div className="pos-actions"><Action icon={ShoppingBag} disabled={locked} onClick={() => submit(hasWorkflow ? 'EDIT' : 'CREATE')}>{hasWorkflow ? 'Save item changes' : 'Save bill'}</Action>
                {canFinalize && hasWorkflow ? <><Action variant="outline" disabled={locked} onClick={() => submit('AGREEMENT')}>Save agreed amount</Action><Action icon={CheckCircle2} disabled={locked} onClick={() => setConfirmation(true)}>Finalize bill</Action></> : null}</div> : null}
              {privileged ? <details className="pos-disclosure pos-financial"><summary>Owner financial estimate</summary><OfflineFinancialSummary profile={profile} draft={editor} catalogue={catalogue} /></details> : null}
              <p className="pos-footnote">Saved bills and changes stay on this device until the server acknowledges them. Finalization and payment are separate actions.</p>
              {!privileged && hasWorkflow ? <Action icon={Plus} disabled={locked} onClick={newBill}>Start next bill</Action> : null}
              {closed && !privileged ? <div role="status"><Status tone={rows.confirmed?'success':'warning'}>{rows.confirmed?'Server acknowledged':'Provisional · saved locally'}</Status><p>{rows.confirmed?'Bill finalized':'Finalization saved on device'}</p><p>{editor.serverSnapshot?.request.publicReference || 'Bill reference available after synchronization'}</p><p>Payments must be recorded by an Owner or Super Admin.</p></div>:null}
            </section>
            {closed && privileged ? <>
              <section className="pos-panel pos-completion"><span className={`pos-completion__icon ${rows.confirmed && closureAcknowledged ? 'is-confirmed' : ''}`}><CheckCircle2 size={32} /></span><Status tone={rows.failed ? 'danger' : rows.confirmed ? 'success' : 'warning'}>{rows.failed ? 'Action needs attention' : rows.confirmed ? 'Server acknowledged' : 'Provisional · saved locally'}</Status><h2>{closed ? rows.confirmed ? 'Bill finalized' : 'Finalization saved on device' : 'Ready to collect payment?'}</h2><p>{closed ? 'Record only money actually received from the customer.' : 'Finalize the saved bill before recording a payment.'}</p>
                <p className="pos-bill-reference">{editor.serverSnapshot?.request.publicReference || 'Bill reference available after synchronization'}</p>
                <div className="pos-balance-grid"><div><span>Saved agreed amount</span><strong>{money(rows.amount)}</strong></div><div><span>Received</span><strong>{money(rows.received)}</strong></div><div><span>Outstanding</span><strong>{money(rows.outstanding)}</strong></div></div><Status tone={rows.paymentStatus === 'Paid' ? 'success' : 'warning'}>{rows.paymentStatus}</Status>
                <p className="pos-footnote">{rows.confirmed ? 'Balances match the last acknowledged server snapshot.' : 'Local estimate includes queued payments. The server rechecks balances and permissions.'}</p></section>
              <section className="pos-panel pos-payment"><div className="pos-section-heading"><span className="pos-section-icon"><CreditCard size={20} /></span><div><h2>Collect payment</h2><p>Record money actually received. Partial payments supported.</p></div></div><fieldset disabled={editingLocked || !closed}>
                <label className="pos-field">Ledger action<select disabled={Boolean(payment.recovery)} value={payment.action} onChange={event => payment.setAction(event.target.value)}><option value="PAYMENT">Payment received</option><option value="HOLD">Place payment hold</option><option value="RELEASE_HOLD">Release payment hold</option></select></label>
                {payment.action === 'PAYMENT' ? <><div className="pos-methods" role="group" aria-label="Payment method">{PAYMENT_METHOD_OPTIONS.map(method => <button type="button" key={method} disabled={Boolean(payment.recovery)} aria-pressed={payment.method === method} onClick={() => payment.setMethod(method)}>{method === 'CASH' ? 'Cash' : method === 'CARD' ? 'Card' : method === 'BANK' ? 'Bank' : method === 'OTHER' ? 'Other' : 'UPI'}</button>)}</div>
                  <label className="pos-field">Received amount (₹)<input readOnly={Boolean(payment.recovery)} inputMode="decimal" placeholder="0.00" value={payment.amount} onChange={event => payment.setAmount(event.target.value)} /></label>
                  {payment.method !== 'CASH' ? <label className="pos-field">Transaction reference {['UPI','CARD','BANK'].includes(payment.method) ? '(required)' : '(optional)'}<input readOnly={Boolean(payment.recovery)} value={payment.reference} onChange={event => payment.setReference(event.target.value)} /></label> : null}</> : null}
                <label className="pos-field">{payment.action === 'PAYMENT' ? 'Payment details (optional)' : 'Hold / release details'}<textarea rows={2} maxLength={500} value={payment.details} onChange={event => payment.setDetails(event.target.value)} /></label>
                <Action icon={Check} className="pos-button--full" onClick={() => submit('PAYMENT')} disabled={locked || !closed}>{payment.recovery ? 'Save recovered payment' : payment.action === 'PAYMENT' ? 'Save payment' : payment.action === 'HOLD' ? 'Save payment hold' : 'Save hold release'}</Action></fieldset>
                <p className="pos-footnote">This records a payment; it does not initiate a bank or UPI transaction.</p></section>
              <Action icon={Plus} className="pos-next-bill" disabled={busy || saving || acting || !writable} onClick={newBill}>Start next bill</Action>
            </> : null}
          </div><aside className={`pos-cart ${cartOpen ? 'pos-cart--open' : ''}`} aria-label="Shopping cart"><div className="pos-cart__heading"><div><h2>Your cart <span>{count}</span></h2><p>{editor.body.customer.name || 'New customer'}</p></div><Action icon={ChevronDown} className="pos-cart__close" variant="icon" aria-label="Close cart" onClick={() => setCartOpen(false)} /></div>{cart}<Action className="pos-cart__review" icon={ArrowRight} disabled={locked || !editor.body.items.length} onClick={goReview}>Review bill</Action></aside></div>
          <footer className="pos-bottom-bar"><button type="button" className="pos-bottom-bar__cart" aria-expanded={cartOpen} onClick={() => setCartOpen(!cartOpen)}><ShoppingCart size={22} /><span><small>{count} items · {cartOpen ? 'Hide cart' : 'View cart'}</small><strong>{money(rows.amount ?? rows.subtotal)}</strong></span>{cartOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button><Action icon={ArrowRight} disabled={locked || !editor.body.items.length || Boolean(review)} onClick={() => closed ? rows.outstanding === 0 ? newBill() : document.querySelector('.pos-payment')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) : !hasWorkflow ? goReview() && submit('CREATE') : goReview()}>{closed ? rows.outstanding === 0 ? 'Next bill' : 'Collect payment' : !hasWorkflow ? 'Save bill' : 'Review bill'}</Action></footer>
        </>}
      </> : null}

      {profileAllowed && tab === 'bills' ? <section className="pos-bills"><div className="pos-page-heading"><div><h2>Bills & synchronization</h2><p>{pending} pending actions · {failures} need attention · {operations.filter(row => row.state === 'synced').length} acknowledged</p></div><Action icon={busy ? Loader2 : RefreshCw} disabled={busy || saving || !online || session.seasonSwitching} onClick={actions.sync}>{syncProgress?.running ? 'Synchronizing…' : 'Synchronize'}</Action></div>
        {syncProgress ? <p role="status">{syncProgress.running ? 'Synchronizing saved actions' : 'Last synchronization'} · {syncProgress.acknowledged} acknowledged actions in this workspace. Check each bill below.</p> : null}
        <div className="pos-filters">{[['all','All saved bills'],['pending','Pending & attention']].map(([value, label]) => <button type="button" key={value} aria-pressed={billFilter === value} onClick={() => setBillFilter(value)}>{label}</button>)}</div>
        {!drafts.length ? <section className="pos-panel"><Empty icon={FileText} title="Your first bill starts here">Saved drafts and acknowledgements will appear here.</Empty><Action icon={Plus} disabled={busy || saving || acting || !writable} onClick={newBill}>Start a bill</Action></section> : <div className="pos-bill-grid">{drafts.filter(draft => billFilter === 'all' || retainedCaptures.some(row=>row.payload.requestId&&row.payload.requestId===draft.requestId) || operations.some(row => row.draftId === draft.draftId && ['pending','syncing','failed','conflict'].includes(row.state))).map(draft => {
          const summary = posSummary(draft, catalogue, operations)
          return <article className="pos-panel pos-saved-bill" key={draft.draftId}><Status tone={summary.failed ? 'danger' : summary.pending ? 'warning' : summary.rows.length ? 'success' : ''}>{summary.failed ? 'Needs attention' : summary.pending ? `${summary.pending} pending` : summary.rows.length ? 'Acknowledged' : 'Draft only'}</Status><h3>{draft.body.customer?.name || 'Unnamed draft'}</h3><p>{draft.serverSnapshot?.request.publicReference || (draft.requestId ? `Request ${draft.requestId}` : 'Saved on this device')}</p><strong>{money(summary.amount ?? summary.subtotal)}</strong><p>{summary.confirmed ? 'Server balance' : 'Local estimate'} · {summary.paymentStatus} · Outstanding {money(summary.outstanding)}</p><p>{draft.body.items.length} lines · {new Date(draft.savedAt).toLocaleString()}</p><Action variant="outline" icon={ArrowRight} disabled={busy || saving} onClick={() => openDraft(draft)}>Open bill</Action></article>
        })}</div>}
        {deviceConflicts.map(version => <article className="pos-panel pos-conflict" key={version.key}><h3>A competing device draft is saved</h3><p>{version.savedAt}</p><Action disabled={busy} onClick={() => { actions.openDeviceConflict(version); setTab('sale') }}>Review device conflict</Action></article>)}
        <h2 className="pos-section-title">Activity & acknowledgements</h2><p className="pos-muted">Retries keep the same operation ID. Failed chains stay saved until you explicitly resolve them.</p>
        <ol className="pos-activity">{operations.map(row => <li className="pos-panel" key={row.payload.operationId}><div className="pos-section-heading"><h3>{actionLabels[row.payload.kind]}</h3><Status tone={row.state === 'synced' ? 'success' : ['failed','conflict'].includes(row.state) ? 'danger' : 'warning'}>{row.state}</Status></div><p>{new Date(row.payload.occurredAt).toLocaleString()} · {row.attempts} attempts</p>
          {row.acknowledgement ? <p className="pos-receipt"><CheckCircle2 size={16} />Server acknowledged · revision {row.acknowledgement.revision}<span>Request {row.acknowledgement.requestId}</span></p> : null}
          {row.acknowledgement?.delegation ? <p>Owner-authorized Admin action · grant {row.acknowledgement.delegation.grantId} · issuing Owner {row.acknowledgement.delegation.ownerUserId}</p>:null}
          {row.payload.resolutionOf?<p>Reviewed replacement for action {row.payload.resolutionOf}{row.acknowledgement?.resolutionOf?' · server acknowledged link':''}</p>:null}
          {row.lastError ? <div className="pos-alert pos-alert--error" role="status">{row.lastError.message}</div> : null}
          {row.payload.kind==='PAYMENT'&&row.payload.body.entryType==='PAYMENT'?<p>Captured {money(row.payload.body.amountPaise)} · {row.payload.body.paymentMethod}{row.payload.body.reference?` · ${row.payload.body.reference}`:''}{row.recoveredBy?` · recovered as ${row.recoveredBy}`:''}</p>:null}
          {privileged&&writable&&row.state==='discarded'&&row.payload.kind==='PAYMENT'&&row.payload.body.entryType==='PAYMENT'&&row.attempts===0&&!row.recoveredBy&&row.payload.requestId?<Action variant="outline" disabled={busy||saving||session.seasonSwitching} onClick={async()=>{if(await actions.reviewRetainedPayment(row))setTab('sale')}}>Review retained payment capture</Action>:null}
          <details className="pos-disclosure"><summary>Operation details</summary><p>ID: {row.payload.operationId}</p>{row.payload.parentOperationId ? <p>Depends on {row.payload.parentOperationId}</p> : null}{row.acknowledgement ? <p>Received {row.acknowledgement.receivedAt}</p> : null}</details>
          {row.state === 'failed' ? <Action variant="outline" disabled={busy} onClick={() => actions.retry(row)}>Retry unchanged operation after fixing access / validation</Action> : null}
          {row.state === 'conflict' || row.state === 'failed' && ([400,428].includes(row.lastError?.status) || row.lastError?.code === 'offline_grant_denied') ? <div className="pos-actions"><Action disabled={busy} onClick={async () => { await actions.reviewConflict(row); if (row.payload.kind !== 'HANDOVER') setTab('sale') }}>Review local and server versions</Action><Action variant="outline" disabled={busy || !online} onClick={() => actions.reviewConflict(row, true)}>{row.payload.kind === 'CREATE' ? 'Archive failed creation' : 'Keep server version'} and cancel pending descendants, including payment captures</Action></div> : null}
          {row.payload.kind === 'HANDOVER' && ['failed','conflict'].includes(row.state) ? <details className="pos-disclosure"><summary>Compare preserved handover and server version</summary><pre>{JSON.stringify({ handover: row.payload.body.transfer, server: row.serverSnapshot }, null, 2)}</pre><p>The receiving device cannot rebase a signed source revision. Obtain a refreshed transfer or explicitly keep the server version.</p></details> : null}
        </li>)}</ol></section> : null}

      {tab === 'workspace' ? <div className="pos-workspace-grid"><section className="pos-panel"><div className="pos-section-heading"><Settings2 size={22} /><h2>Stall & device</h2></div><p>Saved work is isolated by business, stall, season, user and device.</p>{online && session.status === 'authenticated' ? <fieldset className="pos-selectors" disabled={busy || saving}><AdminSeasonSelector /></fieldset> : null}
        <Action icon={RefreshCw} disabled={!canPrepare} onClick={actions.prepare}>{profileAllowed ? 'Update saved catalogue' : 'Prepare / refresh selected stall for offline use'}</Action>{session.error ? <div className="pos-alert pos-alert--error"><p>{session.error}</p><Action variant="outline" disabled={!online} onClick={session.retry}>Retry session verification</Action></div> : null}
        <ul className="pos-readiness" aria-label="Offline readiness"><li>Catalogue: {profileAllowed ? `prepared · ${catalogue.length} products · ${familyPacks.length} Family Packs` : 'not prepared for selected stall'}</li><li>Offline page reload: {shellReady === null ? 'checking…' : shellReady ? 'ready' : 'not confirmed — keep this page open'}</li><li>Pending work: {saving ? 'saving — wait before closing' : `${pending} queued actions saved on this device`}{failures ? ` · ${failures} need attention` : ''}</li></ul>
        {profileAllowed && shellReady && writable ? <p role="status">Offline billing ready.</p> : profileAllowed && !writable ? <p role="status">Saved workspace is read-only. Reconnect to verify access.</p>:null}
        <p className="pos-footnote">{profileAllowed ? `Prepared ${new Date(profile.confirmedAt).toLocaleString()} · ${profile.role}` : 'Prepare an authorized stall online.'}</p><Link className="pos-link-button" to="/admin/context"><ArrowLeft size={16} />Online workspace / sign in</Link><Link className="pos-link-button" to="/admin/login">Sign in again</Link></section>
        <section className="pos-panel"><OfflineStorageStatus revision={`${storageRevision}:${saveCount}:${operations.length}`} /></section>
        {profileAllowed ? <div className="pos-panel pos-authorization"><OfflineAuthorization key={offlineScopeKey(profile.scope)} storage={storageDb} profile={profile} online={online} authenticated={session.status==='authenticated'} disabled={busy||saving||!writable||session.seasonSwitching} onPrepared={actions.reload} /></div>:null}
        {profileAllowed ? <><section className="pos-panel"><h2>Save an existing request</h2><p>Download it online before editing offline. A fresh revision stays separate from earlier local work.</p><label className="pos-field">Request ID to save for offline work<input value={requestId} onChange={event => setRequestId(event.target.value)} /></label><div className="pos-actions"><Action disabled={busy || !online || !requestId.trim()} onClick={() => actions.download()}>Save request snapshot</Action><Action variant="outline" disabled={busy || !online || !requestId.trim()} onClick={() => actions.download(true)}>Save fresh revision as separate draft</Action></div></section>
          <details className="pos-panel pos-qr" open={qrOpen} onToggle={event=>setQrOpen(event.currentTarget.open)}><summary>Optional QR handover</summary><OfflineHandover key={offlineScopeKey(profile.scope)} scanRequest={scanScope===offlineScopeKey(profile.scope)?scanRequest:0} onScanHandled={()=>setScanScope(null)} storage={storageDb} profile={profile} draft={editor} catalogue={catalogue} familyPacks={familyPacks} operations={operations} canAccept={privileged && writable} canPrepare={online && session.status === 'authenticated'} disabled={busy || saving || !writable || Boolean(localConflict) || session.seasonSwitching} onPrepared={actions.reload} onAccepted={async draft => { await actions.acceptHandover(draft); setTab('sale') }} /></details></> : null}
      </div> : null}
    </div>
    <dialog className="pos-dialog" ref={dialogRef} onCancel={() => setConfirmation(false)} aria-labelledby="finalize-title"><div className="pos-dialog__body"><span className="pos-completion__icon"><ShieldCheck size={30} /></span><h2 id="finalize-title">Finalize this bill?</h2><p>{editor?.body.customer.name} · {editor?.body.customer.mobile}</p><div className="pos-dialog__amount">{money(rows?.amount)}</div><p>Finalization locks the items. Payments are recorded separately. {online ? 'The saved action will synchronize with the server.' : 'You are offline. This stays provisional until synchronization.'}</p>{!rows?.itemsSaved ? <p className="pos-field-error">Save item changes before finalizing. The server must receive the items shown in this bill.</p> : null}{rupeesToPaise(editor?.agreedInr, true) !== rows?.amount ? <p className="pos-field-error">The amount field differs from the saved agreement. Save the agreed amount before finalizing.</p> : null}<div className="pos-actions"><Action variant="outline" disabled={busy || acting} onClick={() => setConfirmation(false)}>Keep editing</Action><Action icon={CheckCircle2} disabled={locked || !rows?.itemsSaved || !rows?.amount || rupeesToPaise(editor?.agreedInr, true) !== rows?.amount} onClick={async () => { if (await submit('CLOSE')) { setConfirmation(false); requestAnimationFrame(() => document.querySelector('.pos-payment')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })) } }}>Confirm finalization</Action></div></div></dialog>
  </main>
}
