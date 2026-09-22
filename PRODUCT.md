# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing Express application with EJS templates, Tailwind utility classes, and a local data store with optional MongoDB integration.

## Users

Primary users are Thai-speaking customers who want to browse and purchase digital football game accounts quickly. A secondary audience is partner or rental-store operators who publish selected Partner/API products in their own storefronts.

## Product Purpose

LilTeam Shop is a digital game-account storefront. It lets customers browse available accounts, review product details, add products to a cart, fund the appropriate wallet, complete a purchase, and follow the correct delivery or contact path. Partner/API products are supplied by the main shop and must remain visibly separate from a rental shop's own balance and checkout flow.

## Positioning

The shop combines a curated, visual account catalog with a connected Partner/API catalog. Partner listings are controlled from the main shop, can be selected per partner storefront, and route payment, delivery, and operational records back to the main shop.

## Operating Context

Customers use the responsive web storefront on desktop and mobile. Staff manage products, stock, Partner/API selections, pricing, orders, wallet top-ups, and payment verification from the admin area. A customer may encounter the same Partner/API product through a rental storefront, so origin, required wallet, and delivery owner must be explicit.

## Capabilities and Constraints

- Preserve the existing product, cart, checkout, wallet, TrueMoney top-up, order, contact, and Partner/API backend behavior while redesigning the interface.
- Keep Thai as the primary customer-facing language.
- Show only available stock where the product listing is intended to be purchasable; sold-out states must remain clear when they are shown in management views.
- Partner/API products use a dedicated main-shop wallet and payment path; rental-shop wallet credit must not pay for them.
- Partner/API purchases are fulfilled or contacted through the main shop and must appear in the main shop's order and operational history.
- Partner storefront operators can select, remove, and price selected products from the admin area.
- Do not invent payment, stock, customer, review, or delivery claims that are not present in the application data.
- This work is a local redesign only. Do not deploy or publish it.

## Brand Commitments

The existing product name is LilTeam Shop. The shop serves football-game account customers and already has product imagery, a logo/wordmark, Thai copy, and Partner/API terminology that should remain recognizable while the visual system is replaced.

## Evidence on Hand

- Existing application routes, views, data, and admin workflows in `src/`.
- Product and Partner/API copy in the existing EJS views and README.
- Product imagery referenced by existing product records and storefront components.
- No approved new visual reference, customer testimonials, or verified marketing metrics were provided; do not fabricate them.

## Product Principles

1. Make the next correct action obvious within seconds.
2. Keep main-shop products and Partner/API products unmistakably distinct.
3. Show real availability and price information from the system.
4. Preserve trust through explicit payment, delivery, and contact ownership.
5. Keep the shopping path fast and usable on mobile as well as desktop.

## Accessibility & Inclusion

The storefront must remain keyboard usable, responsive, and readable in Thai. Preserve visible focus, meaningful labels, sufficient contrast, and clear error/empty/sold-out states.
