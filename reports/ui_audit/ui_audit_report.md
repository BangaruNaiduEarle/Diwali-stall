# Diwali Crackers Website — UI/UX Audit (Phase 1)

**Project:** `C:\naidu\Diwali`  
**Audit date:** 2026-10-14  
**Scope:** Read-only review of existing UI. No application files were modified.  
**Runtime:** Production build served via `npm run preview` at `http://127.0.0.1:4173` (Vite 8, React 19).

**Evidence legend**

| Tag | Meaning |
|-----|---------|
| **[Code]** | Confirmed from source |
| **[Visual]** | Observed in running app (browser) |
| **[Suspected]** | Likely issue; needs your manual confirmation |

---

## 1. Executive summary

The site is a **React + Vite + Tailwind CSS v4** catalogue with a coherent **warm festive palette** (maroon, gold, ivory cream). Global tokens live in `src/index.css`; most surfaces use CSS variables consistently.

**Strengths:** Clear estimate-first flow, accessible patterns (focus rings, aria labels, 44px+ controls in many places), responsive grid (2→3→4 columns), sticky mobile estimate bar, category/budget filtering, pagination.

**Top issues affecting trust and polish:**

1. **Product photography backgrounds** (cool pale blue/white in assets) clash with **warm ivory** page and card chrome — most visible on `/crackers`. **[Visual]**
2. **~49 products** have no `images` in data; UI shows empty/loading then **“Image coming soon”** after ID fallback fails — ~30% of catalogue. **[Code] + [Visual]**
3. **Duplicate “162 products”** in catalogue header and grid meta. **[Code] + [Visual]**
4. **Mobile nav “Crackers”** does not stay active on `/crackers/:categorySlug` (only exact `/crackers`). **[Code]**
5. **Footer “Categories”** link targets `/crackers` but highlights only on category sub-routes — confusing label vs behaviour. **[Code]**
6. **Dead discount UI** (`referencePrice` / `discount`) remains in cards though data no longer includes those fields. **[Code]**
7. **Legacy Tailwind names** (`diwali-navy` = maroon) and **two styling dialects** (CSS vars vs `diwali-*` utilities in unused/legacy components). **[Code]**

Recommended direction: **unify warm neutrals** for image wells and cards, **harmonize or mask photo backgrounds** (CSS or asset pipeline — your choice), fix **navigation active states** and **missing-image UX**, then refine catalogue density on mobile.

---

## 2. Current design system and color inventory

### 2.1 Stack and structure

| Layer | Location | Notes |
|-------|----------|--------|
| Framework | `package.json` | React 19, react-router-dom 7, Vite 8 |
| Styling | `src/index.css` | `@import 'tailwindcss'`, `@theme`, `@layer base/utilities` |
| Icons | `lucide-react` | strokeWidth ~1.8 pattern |
| Carousel | `swiper` | Product images only |
| Routes | `src/App.jsx` | `/`, `/crackers`, `/crackers/:categorySlug`, `/estimate`, `/location`, `/faq`, `/404` |
| Shell | `src/components/Layout.jsx` | Header, main, Footer, `MobileStickyEstimateBar` |
| Catalogue | `CatalogueView.jsx`, `ProductFilters.jsx`, `ProductGrid.jsx`, `ProductCard.jsx` | Shared by `Catalogue.jsx` and `Category.jsx` |

**Fonts:** System stack only — `'Segoe UI', system-ui, Roboto, sans-serif` (`--font-sans`). No webfont. **[Code]**

**Reusable UI:** `src/components/ui/Button.jsx` + `buttonVariants.js` (`.ui-btn--*` classes in `index.css`), `PageContainer`, `Breadcrumbs`, `EmptyState`, `SectionHeading`, hero (`FestiveHero`, `HeroContent`).

**Not mounted in current app shell:** `AnnouncementBar.jsx`, `SaleAnnouncement.jsx`, `ComboSection.jsx`, `WhyChooseUs.jsx` (still in repo; alternate `diwali-*` Tailwind tokens). **[Code]**

### 2.2 CSS custom properties (primary palette)

Source: `src/index.css` `:root` and `@theme`.

| Token | Hex / value | Typical use |
|-------|-------------|-------------|
| `--color-ivory` | `#fff9f0` | `body`, layout, image carousel background |
| `--color-white` | `#ffffff` | Cards, inputs, sticky bar |
| `--color-charcoal` | `#25211f` | Body text |
| `--color-muted` | `#756a61` | Secondary text |
| `--color-maroon` / `--color-brand` | `#5a1720` / `#8f1d2c` | Prices, accents, badges |
| `--color-red` | `#a82424` | Category labels, search icon |
| `--color-gold` | `#c9a45c` | Nav underline, focus, footer headings |
| `--color-gold-light` | `#e1c27d` | Hero primary buttons |
| `--color-border` | `#e8ded2` | Card borders, dividers |
| `--color-border-warm` | `#d9cfc3` | Inputs, quantity control |
| `--color-ref-price` | `#9a9088` | Strikethrough (if shown) |
| `--color-maroon-deep` | `#4a121a` | Footer background |

**Semantic Tailwind aliases:** `--color-diwali-navy` maps to **maroon**, not blue (`index.css` `@theme`). **[Code]**

### 2.3 Surfaces by area

| Area | Background | Source |
|------|------------|--------|
| Page | Ivory `#fff9f0` | `body`, `Layout` |
| Product card shell | White + border | `.product-card-surface` |
| Product image well | Ivory (same as page) | `ProductImageCarousel.jsx` `bg-[var(--color-ivory)]` |
| Product photo pixels | **Embedded in WebP/PNG** (often cool grey-blue) | Asset files under `public/images/products/` |
| Header | Ivory 95% + blur | `Header.jsx` |
| Footer | Maroon deep | `Footer.jsx` |
| Hero | Maroon gradient + banner image | `.diwali-hero-*`, `FestiveHero.jsx` |

**Key colour tension:** Page + card + carousel well are **warm cream**, while many product shots use **cool studio backgrounds**, so each tile reads as a “cold rectangle” inside warm UI. **[Visual]** (also implied by asset review on gift-box tiles)

### 2.4 Buttons and interactive states

- Global: `.ui-btn--primary-light` (brand maroon fill), `.ui-btn--secondary-light` (gold border), ghost variants, gold focus outline (`index.css`).
- Hero: separate `.hero-btn--primary/secondary` (gold fill on maroon hero). **[Code]**
- Active nav: gold 2px underline (`.nav-link--active`), maroon text.
- Filter chips: gold border when active (`ProductFilters.jsx`).

---

## 3. Critical functional / UI defects

| ID | Finding | Evidence | Impact |
|----|---------|----------|--------|
| **P0-F1** | Large share of catalogue lacks product images; users see blank/loading then “Image coming soon”. | **[Code]** 49/162 products with empty `images` (Node count on `products.js`). **[Visual]** Snapshot lists “Loading product image” for MEGA STAR, flintstones, etc. on `/crackers`. | Hard to shop; uneven grid; looks unfinished. |
| **P0-F2** | Image loading state has **no visible skeleton/spinner** — empty ivory box until fallback completes. | **[Code]** `ProductImageCarousel.jsx` awaitingFallback branch. **[Visual]** Empty wells before “coming soon”. | Perceived broken layout; layout shift when image appears. |
| **P1-F3** | Mobile drawer **“Crackers”** nav active only when `pathname === '/crackers'`, not on category routes. | **[Code]** `Header.jsx` `MOBILE_NAV` `activeWhen`. | Users on `/crackers/bombs` may think they left the crackers section. |
| **P1-F4** | Footer link label **“Categories”** goes to `/crackers` but `isActive` only when `/crackers/.+`. | **[Code]** `Footer.jsx` lines 62–67. **[Visual]** On `/crackers`, “Crackers” and “Categories” both marked current in a11y tree. | Confusing wayfinding; duplicate “current” semantics on main catalogue. |
| **P2-F5** | `ProductCard` / `ProductDetailSheet` still render **discount strikethrough** when `referencePrice > price`; data no longer supplies those fields. | **[Code]** `ProductCard.jsx` 65–72; products.js has no `referencePrice` after reconciliation. | Dead code today; if fields return later, default `discount ?? 20` could show wrong promos. |

---

## 4. High-priority visual inconsistencies

| ID | Finding | Evidence |
|----|---------|----------|
| **P1-V1** | **Photo background vs site background** mismatch (cool blue-white vs `#fff9f0` / `#ffffff`). | **[Visual]** Catalogue mobile screenshot; **[Code]** carousel ivory + white card vs uncontained photo pixels. |
| **P1-V2** | **Triple-stack neutrals** on cards: white card padding → ivory image well → cool photo. | **[Code]** `product-card-surface` + carousel classes. |
| **P1-V3** | **Red accent overload**: category micro-labels, search icons, header estimate icon, filter icons all `--color-red`. | **[Code]** `ProductCard`, `ProductFilters`, `Header`. | Competes with maroon prices for hierarchy. |
| **P2-V4** | **Typography scale** on catalogue: product names `13–15px` vs prices `15–16px` — price dominates name on dense mobile grid. | **[Code]** `ProductCard.jsx`. **[Visual]** |
| **P2-V5** | **Breadcrumb style** “HOME / CRACKERS” (uppercase editorial) vs sentence-case page title — intentional editorial split but differs from header nav labels (“Home”, “Crackers”). | **[Code]** `Breadcrumbs.jsx`, `Catalogue.jsx`. |
| **P2-V6** | Unused components (`SaleAnnouncement`, `AnnouncementBar`) use **`bg-diwali-cream` / `text-diwali-navy`** naming that reads as a different brand language if re-enabled. | **[Code]** |

---

## 5. Responsive issues by viewport

Audited at **390×844 (mobile)** and **1280×800 (desktop)** via browser emulation on preview build. **[Visual]**

### Mobile (~390px)

| ID | Issue | Evidence |
|----|-------|----------|
| **P1-R1** | Category **chip row** scrolls horizontally; no fade/arrow affordance — last chip clipped (“Flower Pots…”). | **[Visual]** |
| **P1-R2** | **Duplicate product count** (“162 products” under title and again above grid). | **[Code]** `CatalogueView.jsx` 123 + 154–155; **[Visual]** |
| **P2-R3** | Header **estimate** control: icon-only on very small widths; label appears ≥431px — acceptable but tight with long brand name. | **[Code]** `Header.jsx` responsive classes. |
| **P2-R4** | **2-column grid** with tall 4:3 image wells → long scroll; card footer buttons vary height (Add vs qty). | **[Code]** `ProductGrid` `grid-cols-2`, carousel `aspect-[4/3]`. |
| **P2-R5** | Mobile filter sheet applies **budget only** (`mobileBudgetOnly`); category changed via chips only — OK but **“Apply filters”** may imply category too. | **[Code]** `ProductFilters.jsx` 290–293, 377. **[Suspected]** user expectation. |

### Tablet (~768–1023px)

| ID | Issue | Evidence |
|----|-------|----------|
| **P2-R6** | **3-column grid** activates at `md`; filter category links wrap — good. Image nav arrows appear at `md` on carousel. | **[Code]** |
| **P2-R7** | Hero overlay breakpoints tuned in CSS; banner focal point shifts — no defect found without device lab. | **[Suspected]** |

### Desktop (≥1024px)

| ID | Issue | Evidence |
|----|-------|----------|
| **P2-R8** | **4-column grid**; max width `80rem` — comfortable. Dual search fields correctly hidden (mobile vs `md:block`). | **[Code]** |
| **P2-R9** | Desktop **Categories** flyout hover + click — usable; keyboard support present. | **[Code]** `DesktopCategoriesNav` |
| **P2-R10** | Sticky **mobile estimate bar** correctly hidden `lg:hidden`. | **[Code]** `MobileStickyEstimateBar.jsx` |

### Horizontal overflow

- `body { overflow-x: hidden }` **[Code]** — masks overflow rather than fixing root cause; chip scroller uses `max-w-[100vw]`. **[Suspected]** rare edge overflow on very long product names (mitigated by `line-clamp-2`).

---

## 6. Product catalogue and image presentation

### 6.1 Grid and card layout

- Grid: `grid-cols-2` → `md:grid-cols-3` → `lg:grid-cols-4`; gap `12–16px`. **[Code]** `ProductGrid.jsx`
- Card: flex column, equal height via `h-full`; CTA pinned with `mt-auto`. **[Code]** `ProductCard.jsx`
- Image: **4:3 aspect**, `object-contain`, padding `p-2` (card) / more in detail sheet. **[Code]** `ProductImageCarousel.jsx`
- Hover (md+): lift + shadow on card. **[Code]**

### 6.2 Typography and actions

- Category: 10px uppercase red tracking.
- Name: 2-line clamp, semibold charcoal.
- Price: maroon bold; INR via `formatINR`.
- CTA: full-width secondary button; mobile label “Add”, sm+ “Add to estimate”. **[Code]**

### 6.3 Search, filters, sort

- Search: client-side filter (no debounce) — fine for 162 items. **[Code]** `filterProducts.js`
- Category: route change (`/crackers/:slug`) + chips on mobile.
- Budget: URL query `?budget=` on desktop; mobile sheet.
- **No sort** (price/name) — not a defect unless you want it. **[Code]**

### 6.4 Empty states

- No results: `surface-card` with message + clear filters. **[Code]** `ProductGrid.jsx`, `CatalogueView.jsx`

### 6.5 Images — defects vs preferences

| Item | Type | Notes |
|------|------|--------|
| Missing images (~49 SKUs) | **Defect** | Data + fallback pipeline |
| Blue-white photo vs cream UI | **Defect** (brand cohesion) | Asset + presentation |
| Pagination (24/page, 7 pages) | Neutral | Works as designed |
| Carousel dots on multi-image gift boxes | OK | **[Visual]** |
| Shared image same duplicate SKUs (e.g. GC BIG) | **Data/catalogue** issue | Out of UI audit scope for changes |

---

## 7. Accessibility and usability

### Accessibility (positive)

- Focus rings: `.focus-ring` / gold outline on buttons and inputs. **[Code]**
- Many controls ≥44px (`ui-btn--sm` min-height 44px, drawer links 48px). **[Code]**
- Dialogs: product sheet and filter sheet set `aria-modal`, Escape closes, body scroll lock. **[Code]**
- `prefers-reduced-motion` disables hero animations and button transform. **[Code]**

### Accessibility / usability gaps

| ID | Issue | Evidence |
|----|-------|----------|
| **P1-A1** | Product tile uses **nested interactive elements** (div role=button wrapping carousel controls). | **[Code]** `ProductCard.jsx` + carousel nav buttons. **[Suspected]** screen reader / click target quirks. |
| **P2-A2** | **Category label color** (`--color-red` on small 10px text) — contrast OK on white but low visual weight for importance. | **[Code]** |
| **P2-A3** | **“My estimate”** vs **“Add to estimate”** — consistent estimate metaphor; good. WhatsApp is post-estimate — clear on Estimate page. **[Code]** |
| **P2-A4** | Page title pattern includes duplicated site name: “Crackers catalogue \| Crackers catalogue”. | **[Visual]** browser tab; **[Suspected]** from `usePageTitle` + brand suffix. |

### User journey (Home → Estimate)

1. **Home:** Hero CTAs “Explore Crackers”, WhatsApp; category list with counts; budget links; location/FAQ. **[Code]** `Home.jsx`
2. **Browse:** Filters + grid; tap card opens **bottom sheet** detail. **[Visual]**
3. **Add:** Adds to local estimate context; badge on header; **sticky bar** on mobile when count > 0. **[Code]**
4. **Estimate:** Multi-step (items → details → review → WhatsApp). **[Code]** `Estimate.jsx`
5. **Friction points:** Missing images; duplicate product count; category nav highlight on mobile; footer “Categories” labelling.

Functional vs visual: missing images = **functional**; colour mismatch = **visual/cohesion**; duplicate count = **visual clutter**.

---

## 8. Recommended colour palette (recommendations only — not applied)

Goal: **warm, festive, photo-friendly** neutrals that reduce blue-cream clash without re-shooting all assets (optional tier-2: normalize assets).

| Role | Recommended hex | Rationale |
|------|-----------------|-----------|
| Page background | Keep `#fff9f0` or tighten to `#fff7eb` | Already on-brand |
| Card surface | Keep `#ffffff` | Separation from page |
| **Image well (new target)** | `#f5f0e8` or `#f2ebe3` | Slightly darker warm grey-beige to **bridge** cream UI and cool photo edges |
| **Optional inner mat** | `#eae4dc` 1px inset or 8px padding on `#faf6f0` | Unifies varied photo backgrounds |
| Primary text | Keep `#25211f` | Strong contrast on ivory |
| Primary accent (CTA) | Keep `#8f1d2c` | Brand button |
| Price accent | `#5a1720` or unify with brand | Fewer competing reds |
| Secondary accent | Keep `#c9a45c` | Festive highlights |
| Category / label accent | Shift from `#a82424` to `#7a1f27` or muted `#756a61` | Reduce red noise |
| Border | Keep `#e8ded2` / `#d9cfc3` | Coherent with cream |

**Photo strategy (your decision):** CSS-only matting vs batch background normalization vs accept mismatch for MVP.

---

## 9. Prioritized remediation backlog

### P0

| ID | Component / file | Evidence | User impact | Recommended fix | Risk / deps |
|----|------------------|----------|-------------|-----------------|-------------|
| P0-F1 | `products.js` + `ProductImageCarousel.jsx` | 49 empty `images`; missing_images reports | Cannot recognize products | Add images (separate workstream); interim consistent placeholder | Data pipeline |
| P0-F2 | `ProductImageCarousel.jsx` | Empty awaiting state | Looks broken | Skeleton/shimmer + “No image” icon immediately | Low |

### P1

| ID | Component / file | Evidence | User impact | Recommended fix | Risk / deps |
|----|------------------|----------|-------------|-----------------|-------------|
| P1-V1 | `ProductImageCarousel`, `.product-card-surface` | Visual + code | Catalogue feels unprofessional | Warm image well + optional subtle inner border | Visual QA on all categories |
| P1-F3 | `Header.jsx` | activeWhen | Wrong nav state | Active when `pathname.startsWith('/crackers')` | Low |
| P1-F4 | `Footer.jsx` | Categories link logic | Confusing links | Rename to “All crackers” or link to first category hub; fix active rules | Copy decision |
| P1-R2 | `CatalogueView.jsx` | Duplicate count | Clutter | Remove header or grid duplicate | Low |
| P1-A1 | `ProductCard.jsx` | Nested buttons | a11y | Open detail on image click only; carousel controls stopPropagation (partially done) — restructure semantics | Medium |
| P1-R1 | `ProductFilters.jsx` | Chip scroll | Discoverability | Gradient fade or “scroll for more” hint | Low |

### P2

| ID | Component / file | Evidence | User impact | Recommended fix | Risk / deps |
|----|------------------|----------|-------------|-----------------|-------------|
| P2-F5 | `ProductCard`, `ProductDetailSheet` | Dead discount UI | Confusion if data returns | Remove or wire to future `x4`/MSRP policy | Product decision |
| P2-V3 | Multiple | Red accents | Visual noise | Token consolidation | Low |
| P2-V4 | `ProductCard` | Type scale | Scanning names | Bump name to 14px min on mobile | Low |
| P2-R5 | `ProductFilters` | Apply filters copy | Expectation | Rename button or include category in sheet | UX copy |
| P2-A4 | `usePageTitle` | Tab title dup | Minor | Dedupe brand in title template | Low |
| P2-V6 | Legacy components | diwali-navy naming | Maintainer confusion | Document or migrate tokens | Low |

---

## 10. Suggested implementation phases

1. **Phase A — Low risk, high clarity (UI-only)**  
   Fix nav/footer active states; remove duplicate product count; improve image placeholder/skeleton; adjust image-well background token; remove dead discount UI *if* you confirm no strikethrough pricing.

2. **Phase B — Catalogue polish**  
   Typography hierarchy on cards; category label colour; chip scroll affordance; optional sort (if you want it).

3. **Phase C — Asset / data (parallel)**  
   Image backfill for 49 SKUs; optional photo background normalization; duplicate SKU imagery (separate reconciliation).

4. **Phase D — Legacy cleanup**  
   Align or remove unused `SaleAnnouncement` / `AnnouncementBar`; unify `diwali-*` vs `--color-*` usage.

---

## 11. Items requiring your confirmation before implementation

1. **Image well strategy:** CSS warm mat only vs re-process WebP backgrounds vs leave photos as-is.
2. **Pricing display:** Remove strikethrough/discount UI entirely vs show **`x4`** or reference pricing later.
3. **Footer “Categories”:** Rename vs change href vs dropdown.
4. **Sort controls:** Add price/name sorting or keep filter-only.
5. **Mobile filter sheet:** Budget-only behaviour — keep or add category radios back.
6. **Brand title in header/tab:** “Crackers catalogue” vs stall name from `siteConfig`.
7. **Re-enable sale announcement bar** on home/catalogue or keep hidden.

---

## 12. Validation checklist (future fix phase)

- [ ] `/crackers` and `/crackers/:slug` at 390, 768, 1280: no horizontal scroll; grid intact
- [ ] All 162 products: image or intentional placeholder (no indefinite loading)
- [ ] Photo tiles: acceptable contrast on new image well colour (sample 10 SKUs per category)
- [ ] Mobile nav + footer: correct active states on catalogue and category pages
- [ ] Estimate flow: add → sticky bar → `/estimate` → WhatsApp unchanged
- [ ] Keyboard: filters sheet, product sheet, category menu, pagination
- [ ] Focus visible on all interactive elements
- [ ] Lighthouse/a11y spot check (contrast on maroon footer links)
- [ ] `npm run build` passes; no unintended price/data changes
- [ ] Regression: search, budget URL param, pagination, sold-out states

---

## Appendix: Key file reference map

| Concern | Files |
|---------|--------|
| Tokens / global CSS | `src/index.css` |
| Routes | `src/App.jsx` |
| Catalogue logic | `src/components/CatalogueView.jsx`, `src/utils/filterProducts.js` |
| Filters | `src/components/ProductFilters.jsx` |
| Cards / images | `src/components/ProductCard.jsx`, `ProductImageCarousel.jsx`, `src/utils/productImage.js` |
| Header / nav | `src/components/Header.jsx` |
| Footer | `src/components/Footer.jsx` |
| Estimate UX | `src/context/EstimateContext.jsx`, `src/pages/Estimate.jsx`, `MobileStickyEstimateBar.jsx` |
| Home hero | `src/components/hero/FestiveHero.jsx` |
| Data (read-only in audit) | `src/data/products.js`, `src/data/categories.js` |

---

*End of audit report.*
