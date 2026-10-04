# Diwali Crackers Stall Website — Complete Development Plan

## 1. Project Overview

Build a modern, responsive, festive Diwali crackers catalogue website for a temporary 3-day crackers stall.

The website is NOT a traditional e-commerce application.

### Primary goal

Visitors should be able to:

1. Discover the crackers stall/business.
2. Browse all available crackers.
3. Search and filter products.
4. View product details and prices.
5. Add products with quantities to an **Estimate / Order List**.
6. Enter basic customer details.
7. Review the complete estimate/order.
8. Send the complete order to the business WhatsApp.
9. Find the physical stall location and contact details.

### Important business model

- Stall operates only for 3 days.
- No user registration/login.
- No online payment.
- No delivery management.
- No backend/database is required for Version 1.
- WhatsApp is the final order communication channel.
- Final price and product availability are confirmed through WhatsApp.
- Product data will be maintained locally in a JSON/JS data file.
- Estimate/order data should persist in browser localStorage so a refresh does not immediately lose the user's selection.

---

# 2. Technology Stack

Use a lightweight frontend-only stack.

- React
- Vite
- JavaScript / JSX only
- Tailwind CSS
- Lucide React for icons
- Framer Motion only where animation genuinely improves UX
- Browser localStorage
- WhatsApp click-to-chat URL
- No TypeScript

Do NOT introduce unnecessary technologies.

Do NOT add:

- Express
- Node backend
- MongoDB
- MySQL
- PostgreSQL
- Authentication
- Redux unless there is a demonstrated need
- Payment gateway
- Admin dashboard
- Server-side API

---

# 3. Design Direction

The design should feel:

- Premium
- Festive
- Modern
- Trustworthy
- Local-business friendly
- Easy to use
- Mobile-first
- Professional rather than overly flashy

Do NOT copy the reference websites directly.

Reference websites supplied for inspiration:

- https://www.crackersshope.com/
- https://srigokulamcrackers.com/
- https://kavicrackers.in/
- https://smileythirai.com/firecrackers/

Use these only to understand common crackers catalogue/e-commerce patterns.

The final design must have its own visual identity.

---

# 4. Visual Theme

Suggested palette:

- Deep Navy: #07111F
- Festive Gold: #F4B942
- Warm Orange: #F97316
- Off White: #FFF9F0
- Red Accent: #C62828
- Neutral text colors as appropriate

Use the colors carefully.

Do NOT make the entire website red/yellow.

The overall appearance should be dark-premium + warm festive accents.

Possible visual elements:

- subtle fireworks
- tiny stars
- soft glow
- elegant festive patterns
- product photography
- restrained motion

Avoid:

- excessive particles
- excessive blinking
- large unnecessary animations
- clutter
- overly decorative layouts

---

# 5. Website Structure

The main site should contain:

1. Header
2. Hero
3. 3-Day Announcement
4. Shop by Category
5. Popular Picks
6. Shop by Budget
7. Diwali Combo Packs
8. Full Product Catalogue
9. Estimate / Order List
10. Customer Details
11. Order Review
12. Stall Information
13. Why Buy From Us
14. FAQ
15. WhatsApp CTA
16. Footer

---

# 6. Header

Desktop:

- Logo / brand name
- Home
- Crackers
- Categories
- Location
- My Estimate
- WhatsApp CTA

Example:

HOME | CRACKERS | CATEGORIES | LOCATION | MY ESTIMATE (3) | WHATSAPP

Mobile:

- Logo
- Menu button
- Estimate count
- WhatsApp icon

Keep header sticky.

Do not make it unnecessarily tall.

---

# 7. Hero Section

Hero should immediately communicate the business.

Suggested structure:

DIWALI 2026

LIGHT UP YOUR DIWALI

Special festive prices on crackers

Available for 3 Days Only

[ EXPLORE CRACKERS ]
[ ORDER ON WHATSAPP ]

Also show:

- stall name
- location
- dates
- relevant festive visual

Hero should be visually strong but fast-loading.

Use responsive images.

---

# 8. 3-Day Announcement

Immediately after the hero:

DIWALI SPECIAL
3 DAYS ONLY • LIMITED STOCK • VISIT OUR STALL

The actual dates should come from a configuration value, not be hard-coded throughout the UI.

---

# 9. Shop by Category

Create category cards.

Suggested categories:

- Sparklers
- Flower Pots
- Ground Chakkars
- Rockets
- Crackers
- Fancy Shots
- Colour Items
- Combo Packs

Actual categories should be generated from product data where practical.

Clicking a category should filter the catalogue.

---

# 10. Popular Picks

Show 4–8 selected products.

Product data should support:

```js
featured: true
```

Only featured products should appear here.

Do not duplicate product data manually in multiple components.

---

# 11. Shop by Budget

Create budget filters such as:

- Under ₹500
- ₹500 – ₹1,000
- ₹1,000 – ₹2,000
- ₹2,000 – ₹5,000
- ₹5,000+

The budget filter should work against the actual selling price.

Do not use hard-coded product lists for each budget.

---

# 12. Combo Packs

Support combo products in the data model.

Examples:

- ₹999 Family Combo
- ₹1,999 Family Combo
- ₹2,999 Grand Combo
- ₹4,999 Premium Combo

These are placeholders only. Use the actual business data supplied later.

Combo products should be addable to the estimate like normal products.

---

# 13. Product Data Model

Use a central product data file.

Example:

```js
{
  id: 1,
  name: "10 CM Colour Sparklers",
  category: "Sparklers",
  pack: "10 pcs",
  mrp: 100,
  price: 50,
  image: "/images/products/colour-sparklers.jpg",
  description: "Short product description",
  featured: true,
  stockStatus: "available",
  active: true
}
```

Supported stock states:

- available
- limited
- soldout

The UI should display:

Available
Limited Stock
Sold Out

Sold-out products should not be addable to the estimate.

---

# 14. Full Product Catalogue

The catalogue is the main functional area.

Include:

- Search
- Category filter
- Budget filter
- Product grid
- Sort if genuinely useful
- Product count

Search should support product name and category.

Example:

Search:
"rocket"

Only matching products should appear.

---

# 15. Product Card

Product card should contain:

- Product image
- Product name
- Pack/quantity information
- MRP
- Selling price
- Discount percentage if applicable
- Stock status
- Add button

Example:

PRODUCT IMAGE

Flower Pot Big
5 pcs

MRP ₹400
₹200

[ ADD TO ESTIMATE ]

If limited:

LIMITED STOCK

If sold out:

SOLD OUT

Use accessible buttons.

Do not make the cards unnecessarily tall.

---

# 16. Estimate / Order List

This is one of the most important features.

Use the term:

**My Estimate**

instead of a traditional e-commerce cart.

Reason:
The final order is confirmed through WhatsApp.

Users can:

- add products
- increase quantity
- decrease quantity
- remove products
- see line totals
- see estimated total

Example:

```text
MY ESTIMATE

Colour Sparklers
2 × ₹60 = ₹120

Flower Pot Big
1 × ₹250 = ₹250

Rocket Pack
2 × ₹300 = ₹600

---------------------
Estimated Total: ₹970
```

---

# 17. Estimate State

Create a central estimate state.

Suggested shape:

```js
[
  {
    productId: 1,
    quantity: 2
  },
  {
    productId: 5,
    quantity: 1
  }
]
```

Do not duplicate complete product objects into multiple states unless necessary.

Derive product details from the product catalogue using productId.

---

# 18. localStorage

Persist estimate data in localStorage.

Suggested key:

```text
crackers_estimate
```

Also persist customer details:

```text
crackers_customer_details
```

On page refresh:

- restore estimate
- restore customer details

If localStorage contains invalid data, fail gracefully and reset only the corrupted value.

---

# 19. Estimate Drawer

Desktop:

Use a right-side drawer.

Mobile:

Use a bottom sheet or full-screen estimate page.

The user should always be able to see:

- item count
- estimated total
- view estimate CTA

Example floating/sticky indicator:

```text
3 Items     ₹970
[ VIEW ESTIMATE ]
```

Do not block important screen content.

---

# 20. Customer Details

After the user reviews their estimate, ask for basic details.

Fields:

### Required

- Full Name
- Mobile Number

### Optional

- Area / Locality
- Pickup Date
- Special Note

Do NOT ask for unnecessary information.

Since this is a stall pickup model, a full address is not required unless the business later needs it.

Validation:

- Name required
- Mobile required
- Valid Indian mobile number format
- Pickup date should be valid
- Sanitize/trim input

---

# 21. Customer Details UI

Title:

YOUR DETAILS

Fields:

```text
Full Name *
[________________]

Mobile Number *
[________________]

Area / Locality
[________________]

Pickup Date
[ Select Date ]

Special Note
[________________]
```

CTA:

[ REVIEW ORDER ]

---

# 22. Order Review

Before sending to WhatsApp, show a final review screen.

Display:

### Customer Details

Name
Mobile
Area
Pickup date
Note

### Order Items

Product
Quantity
Unit price
Line total

### Estimated Total

Large and prominent.

Also show:

"Final availability and price will be confirmed on WhatsApp."

Buttons:

[ EDIT DETAILS ]

[ EDIT ITEMS ]

[ SEND ORDER ON WHATSAPP ]

---

# 23. WhatsApp Order Generation

The final WhatsApp message should be generated dynamically.

Do not manually write a fixed message.

Suggested message:

```text
🎆 DIWALI CRACKERS ORDER

Customer Details
----------------
Name: Ravi Kumar
Mobile: 98765XXXXX
Area: Patancheru
Pickup: Diwali Day - Evening

Order Details
----------------
1. Colour Sparklers
   Qty: 2
   Price: ₹120

2. Flower Pot Big
   Qty: 1
   Price: ₹250

3. Rocket Pack
   Qty: 2
   Price: ₹600

----------------
Estimated Total: ₹970
----------------

Please confirm availability and final price.

Thank you.
```

The actual business WhatsApp number must come from configuration.

Example:

```js
const WHATSAPP_NUMBER = "91XXXXXXXXXX";
```

Do not hard-code the WhatsApp number in multiple components.

Use a helper function:

```js
generateWhatsAppMessage({
  customer,
  items,
  total
});
```

Then encode the message safely before opening WhatsApp.

---

# 24. WhatsApp Behaviour

Use WhatsApp click-to-chat.

Desktop/mobile should both work.

Use:

```text
https://wa.me/<NUMBER>?text=<ENCODED_MESSAGE>
```

Do not expose a raw URL in visible UI.

Button text:

SEND ORDER ON WHATSAPP

After opening WhatsApp, the business receives the order.

The website itself does not claim that the order is confirmed.

---

# 25. General WhatsApp CTA

There should also be a general WhatsApp button.

Message:

"Hi, I would like to know more about your Diwali crackers collection."

This is different from the generated estimate order.

---

# 26. Stall Location

Create a dedicated section:

VISIT OUR DIWALI STALL

Show:

- Stall name
- Address
- City/Area
- Dates
- Opening hours
- Contact number
- Google Maps CTA

Buttons:

[ GET DIRECTIONS ]
[ CALL US ]
[ WHATSAPP US ]

Use real business information supplied later.

Do not invent address, dates, timings, or phone numbers.

---

# 27. Why Buy From Us

Keep this short.

Possible cards:

- Festive Special Prices
- Wide Product Collection
- Easy WhatsApp Ordering
- Convenient Local Pickup

Only retain claims that are actually true for the business.

---

# 28. FAQ

Suggested questions:

1. Where is the crackers stall located?
2. What are the stall dates?
3. How can I place an order?
4. Can I calculate my estimated total before ordering?
5. Can I order through WhatsApp?
6. Are all products available throughout the three days?
7. Is the final price confirmed before pickup?

Answers should be short and factual.

---

# 29. Mobile Bottom Navigation

On mobile, use a fixed bottom navigation:

HOME | SHOP | ESTIMATE | WHATSAPP

Estimate should show an item-count badge.

Example:

```text
🧾 Estimate (3)
```

Do not let the bottom navigation cover important content.

Add appropriate bottom padding.

---

# 30. Responsive Requirements

Design mobile-first.

Required breakpoints:

- Mobile
- Tablet
- Desktop
- Large desktop

Product grid suggestion:

Mobile:
2 columns

Tablet:
3 columns

Desktop:
4 columns

Large desktop:
4–5 columns depending on content width.

Do not force excessive columns.

---

# 31. Accessibility

Must include:

- semantic HTML
- proper button elements
- alt text for product images
- keyboard-friendly controls
- visible focus states
- sufficient contrast
- aria labels where necessary
- accessible modal/drawer behaviour
- Escape key support where appropriate

Do not rely only on color to communicate stock status.

---

# 32. Performance

The site should be fast because it will be accessed from mobile devices.

Requirements:

- Optimize product images
- Use appropriate image dimensions
- Lazy-load below-the-fold images
- Avoid unnecessary JS
- Avoid huge animation libraries/components
- Avoid autoplay video unless genuinely required
- Keep initial bundle reasonable

The catalogue should remain responsive even with many products.

---

# 33. SEO

Set proper:

- title
- meta description
- Open Graph title
- Open Graph description
- Open Graph image
- favicon
- canonical URL if a production domain exists

Suggested title pattern:

```text
[Brand Name] | Diwali Crackers 2026 | [Location]
```

Suggested description:

```text
Explore our Diwali crackers collection, check prices, create your estimate and place your order easily through WhatsApp.
```

Actual brand/location should be inserted later.

---

# 34. Suggested Project Structure

```text
src/
├── assets/
│   ├── images/
│   └── icons/
│
├── components/
│   ├── Header.jsx
│   ├── MobileBottomNav.jsx
│   ├── Hero.jsx
│   ├── AnnouncementBar.jsx
│   ├── CategoryCard.jsx
│   ├── CategorySection.jsx
│   ├── PopularProducts.jsx
│   ├── BudgetFilter.jsx
│   ├── ComboSection.jsx
│   ├── ProductCard.jsx
│   ├── ProductGrid.jsx
│   ├── ProductFilters.jsx
│   ├── EstimateDrawer.jsx
│   ├── EstimateItem.jsx
│   ├── CustomerDetailsForm.jsx
│   ├── OrderReview.jsx
│   ├── StallLocation.jsx
│   ├── WhyChooseUs.jsx
│   ├── FAQ.jsx
│   ├── WhatsAppButton.jsx
│   └── Footer.jsx
│
├── data/
│   ├── products.js
│   └── siteConfig.js
│
├── hooks/
│   └── useEstimate.js
│
├── utils/
│   ├── whatsapp.js
│   ├── currency.js
│   └── storage.js
│
├── App.jsx
├── main.jsx
└── index.css
```

---

# 35. Site Configuration

Keep business information in one place.

Example:

```js
export const siteConfig = {
  brandName: "YOUR BRAND",
  whatsappNumber: "91XXXXXXXXXX",
  phone: "+91 XXXXXXXXXX",
  location: "YOUR LOCATION",
  stallDates: "YOUR DATES",
  stallTimings: "YOUR TIMINGS",
  googleMapsUrl: "YOUR MAP URL"
};
```

Do not repeat business information across components.

---

# 36. Product Images

Images should follow:

```text
public/
└── images/
    └── products/
        ├── product-1.webp
        ├── product-2.webp
        └── product-3.webp
```

Product data references the image path.

Use consistent image dimensions/aspect ratio.

If an image is missing, show a clean placeholder using a Lucide icon.

Do not break the layout when an image is unavailable.

---

# 37. Empty States

Handle:

### No products found

```text
No crackers found.

Try another search or category.
```

### Empty estimate

```text
Your estimate is empty.

Explore our crackers and add products to get started.

[ EXPLORE CRACKERS ]
```

---

# 38. Error Handling

Handle:

- invalid product data
- missing images
- invalid localStorage
- invalid customer details
- empty estimate
- invalid WhatsApp configuration

Do not crash the complete website because one product has invalid data.

---

# 39. Business Logic Rules

1. Sold-out products cannot be added.
2. Quantity must be at least 1.
3. Quantity cannot be negative.
4. Removing an item should remove it from the estimate.
5. Estimated total is calculated from selling price × quantity.
6. MRP is informational.
7. Final availability is confirmed through WhatsApp.
8. No order is considered confirmed merely by adding to estimate.
9. No payment is taken through the website.
10. Customer details are used only to prepare the WhatsApp message.
11. Estimate and customer details persist locally.
12. Clear estimate only when the user explicitly chooses to clear it.

---

# 40. Security / Privacy

Do not collect sensitive information.

Do not ask for:

- Aadhaar
- PAN
- bank details
- passwords
- unnecessary address information

Only collect information needed for the stall order.

Add a short privacy note near the customer form if appropriate.

---

# 41. Important UX Principle

The website should make the user journey extremely obvious:

```text
DISCOVER
   ↓
BROWSE
   ↓
ADD TO ESTIMATE
   ↓
ENTER DETAILS
   ↓
REVIEW
   ↓
WHATSAPP
```

Every page/section should support this journey.

Do not create unnecessary navigation paths.

---

# 42. Homepage CTA Strategy

Primary CTA:

EXPLORE CRACKERS

Secondary CTA:

ORDER ON WHATSAPP

Catalogue CTA:

ADD TO ESTIMATE

Estimate CTA:

CONTINUE

Review CTA:

SEND ORDER ON WHATSAPP

---

# 43. Development Phases

## Phase 1 — Project Foundation

- Create React + Vite project
- Configure Tailwind
- Add Lucide React
- Establish typography
- Establish color system
- Create global container
- Create responsive layout

## Phase 2 — Static Homepage

Build:

- Header
- Hero
- Announcement
- Categories
- Popular products
- Budget section
- Combos
- Stall location
- Why choose us
- FAQ
- Footer

## Phase 3 — Product Catalogue

Implement:

- products.js
- ProductCard
- ProductGrid
- Search
- Category filters
- Budget filters
- Stock status

## Phase 4 — Estimate System

Implement:

- add product
- increase quantity
- decrease quantity
- remove
- calculate totals
- estimate drawer
- localStorage persistence
- mobile estimate UI

## Phase 5 — Customer Details

Implement:

- customer form
- validation
- localStorage
- review screen

## Phase 6 — WhatsApp

Implement:

- message generation
- URL encoding
- WhatsApp click-to-chat
- final order CTA
- general WhatsApp CTA

## Phase 7 — Polish

Implement:

- loading states
- empty states
- error handling
- accessibility
- responsive improvements
- subtle animations
- image optimization
- SEO
- Open Graph

## Phase 8 — Testing

Test:

- Mobile Chrome
- Android
- iPhone Safari if available
- Tablet
- Desktop
- Different product counts
- Empty estimate
- Sold-out products
- Search
- Filters
- Quantity changes
- Refresh/localStorage
- WhatsApp generation
- Invalid phone number
- Missing image
- Long product names
- Long category names

---

# 44. Cursor Development Rules

Cursor must NOT attempt to build the entire website in one step.

Implement phase by phase.

Before changing an existing component:

1. Inspect the current project structure.
2. Reuse existing components where appropriate.
3. Avoid duplicate components.
4. Avoid unnecessary dependencies.
5. Keep JSX readable.
6. Use JavaScript only.
7. Keep business data separate from UI.
8. Do not invent product names/prices.
9. Do not invent business details.
10. Do not replace the design system without reason.

When requirements are ambiguous, preserve the existing implementation and ask/flag the ambiguity rather than inventing business rules.

---

# 45. Cursor Prompt — Initial Setup

Use this prompt first:

```text
Read the complete DIWALI_CRACKERS_WEBSITE_PLAN.md file before making any changes.

We are building a frontend-only React + Vite Diwali crackers catalogue and WhatsApp ordering website.

Important:
- JavaScript/JSX only, no TypeScript.
- Use Tailwind CSS.
- Use Lucide React for icons.
- Use Framer Motion only when genuinely useful.
- No backend.
- No database.
- No authentication.
- No payment gateway.
- No unnecessary dependencies.
- Product data must be separated from UI.
- Do not invent business details or product prices.

First inspect the existing project structure.

Then create the project foundation according to the plan:
- global design system
- responsive container
- typography
- color variables/classes
- basic layout
- Header
- Footer
- responsive mobile navigation foundation

Do NOT build every feature yet.

After implementation, summarize:
1. Files created
2. Files modified
3. Dependencies added
4. What remains for Phase 2
```

---

# 46. Cursor Prompt — Product Catalogue

After Phase 1:

```text
Read DIWALI_CRACKERS_WEBSITE_PLAN.md.

Implement Phase 3: Product Catalogue.

Create the central product data structure and build:
- ProductCard
- ProductGrid
- search
- category filtering
- budget filtering
- stock status
- responsive product layout

Use mock placeholder products only if the real product list has not yet been supplied.

Do not invent final business prices.

Keep all product data centralized.

Do not implement WhatsApp ordering yet.

Test:
- search
- filters
- sold-out state
- responsive layout
- long product names
- missing product image
```

---

# 47. Cursor Prompt — Estimate System

```text
Read DIWALI_CRACKERS_WEBSITE_PLAN.md.

Implement Phase 4: My Estimate.

Requirements:
- add product
- increase quantity
- decrease quantity
- remove product
- calculate line totals
- calculate estimated total
- persist estimate to localStorage
- restore after refresh
- desktop right-side drawer
- mobile-friendly bottom sheet/full-screen view
- item count badge
- empty state

Do not add customer details yet.

Keep the estimate state logic reusable and separate from presentation.

Do not duplicate complete product objects unnecessarily.
```

---

# 48. Cursor Prompt — Customer Details + Review

```text
Read DIWALI_CRACKERS_WEBSITE_PLAN.md.

Implement Phase 5.

Add:
- customer details form
- validation
- localStorage persistence
- order review screen

Required:
- full name
- mobile number

Optional:
- area/locality
- pickup date
- special note

Review screen must show:
- customer details
- selected products
- quantities
- line totals
- estimated total
- final availability/price disclaimer

Add edit details and edit items actions.

Do not implement WhatsApp yet.
```

---

# 49. Cursor Prompt — WhatsApp

```text
Read DIWALI_CRACKERS_WEBSITE_PLAN.md.

Implement Phase 6: WhatsApp ordering.

Create:
- siteConfig.js for business configuration
- WhatsApp message generator
- URL encoding
- click-to-chat helper

The generated message must contain:
- customer details
- all selected products
- quantities
- prices
- estimated total
- final availability/price confirmation note

Do not hard-code the business WhatsApp number in multiple components.

Use one configuration value.

Do not claim that the order is confirmed by the website.
```

---

# 50. Cursor Prompt — Final QA

```text
Read DIWALI_CRACKERS_WEBSITE_PLAN.md.

Perform a complete frontend QA pass.

Check:
- mobile responsiveness
- tablet responsiveness
- desktop layout
- header
- hero
- product cards
- search
- filters
- estimate
- quantity controls
- localStorage
- customer form
- validation
- review
- WhatsApp message
- empty states
- sold-out products
- missing images
- long text
- accessibility
- keyboard navigation
- focus states
- performance
- console errors

Do not redesign working sections unnecessarily.

Fix only actual issues and maintain the established design system.
```

---

# 51. Final User Experience

The final experience should feel like:

```text
User sees a beautiful Diwali landing page
            ↓
Clicks Explore Crackers
            ↓
Browses products
            ↓
Adds desired quantities
            ↓
Clicks My Estimate
            ↓
Sees estimated total
            ↓
Enters name + mobile + basic details
            ↓
Reviews complete order
            ↓
Clicks Send Order on WhatsApp
            ↓
WhatsApp opens with the complete order message
            ↓
Business confirms availability/final price
            ↓
Customer visits the stall
```

---

# 52. Future Version — Optional

Only after Version 1 works, consider:

- Admin dashboard
- Backend orders
- Inventory tracking
- Order status
- Customer order history
- Online payment
- Delivery support
- Analytics
- QR campaign tracking

These are NOT part of the initial build.

---

# 53. Final Principle

Keep the first version:

FAST + SIMPLE + FESTIVE + MOBILE-FIRST + WHATSAPP-CENTRIC

The website is a digital catalogue and order-estimation tool, not a full e-commerce platform.

The most important conversion path is:

**Browse → Estimate → Customer Details → Review → WhatsApp**

Everything else should support this journey.
