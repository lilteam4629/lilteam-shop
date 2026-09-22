---
name: LilTeam Shop Verified Drop
description: A light editorial storefront and admin console that makes real stock, correct wallet ownership, and the next action obvious.
colors:
  paper: "#f5f5f2"
  surface: "#ffffff"
  ink: "#171717"
  muted: "#6b6b68"
  line: "#deded8"
  accent: "#c58a24"
  accent-deep: "#8c5e12"
  accent-soft: "#f4ead5"
typography:
  display:
    fontFamily: "Prompt, sans-serif"
    fontSize: "clamp(42px, 6.5vw, 86px)"
    fontWeight: 800
    lineHeight: 1.03
    letterSpacing: "-0.06em"
  headline:
    fontFamily: "Prompt, sans-serif"
    fontSize: "clamp(26px, 3.3vw, 42px)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.05em"
  body:
    fontFamily: "Prompt, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  sm: "10px"
  md: "14px"
  lg: "18px"
  xl: "26px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "76px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    rounded: "999px"
    padding: "0 20px"
    height: "50px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "999px"
    padding: "0 20px"
    height: "50px"
  hero-panel:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    rounded: "26px"
    padding: "24px"
  product-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "16px"
    padding: "0"
---

# Design System: LilTeam Shop Verified Drop

## Overview

**Creative North Star: “Verified Drop”**

LilTeam Shop now reads like a well-made storefront receipt: paper-white surfaces, dark ink, one warm accent, and generous spacing around the information that determines a purchase. The homepage leads with the visitor’s decision, then shows live inventory, wallet ownership, and the next action without decorative noise. The admin area uses the same paper-and-ink grammar so operating the shop feels like the same product.

The reference supplied by the user is a light, high-contrast game-account shop with a large editorial hero, proof strip, benefit steps, product cards, process explanation, FAQ, and a compact footer. That composition is the benchmark for hierarchy and density; product facts, prices, routes, and API rules remain LilTeam’s real data and behavior. Reference: https://kiddyxstore.com/

## Colors

Paper (`#f5f5f2`) carries page ground; white (`#ffffff`) carries cards and controls; near-black (`#171717`) is the primary ink and action; gray (`#6b6b68`) is supporting copy; warm gold (`#c58a24`) is reserved for prices, Partner/API ownership, and important status; deep gold (`#8c5e12`) is used for readable accent text. The accent-soft wash (`#f4ead5`) provides a quiet background for API guidance and selected states.

**One warm accent rule.** Gold names a monetary or ownership decision. It does not decorate every border or headline.

## Typography

Prompt is the display and body face because it keeps Thai forms open at large sizes and compact labels readable. IBM Plex Mono is limited to metadata and short numeric readouts. Display headlines are large and relaxed; product titles stay compact; body copy uses 1.7 line height.

## Layout

The storefront container is capped at 1240px with 20px desktop and 12px mobile gutters. The first viewport is a two-column decision hero that collapses to one column under 1000px. Product grids use four columns at wide desktop, three at compact desktop, and two on mobile. Horizontal rails are used only for recent orders and other naturally scrollable rows. Sections use a 76px desktop rhythm and 55px mobile rhythm.

The admin keeps its navigation and routes but uses white work surfaces, thin gray rules, readable form fields, and the same gold ownership cues. Dense tables remain horizontally scrollable instead of shrinking into unreadable text.

## Components

- **Hero:** one direct headline, two clear actions, real store proof, and a dark stock panel fed by current products.
- **Partner/API banner:** a gold API marker, explicit main-shop funding rule, and separate “เติมเงินสินค้า API” / “ติดต่อร้านหลัก” actions.
- **Product card:** real product image, price, availability, Partner badge when applicable, and existing product route/checkout behavior.
- **Benefit/process tiles:** numbered, flat white cards with short operational copy.
- **FAQ:** native `details` disclosure for keyboard access and low cognitive load.
- **Admin work surface:** light panels, visible borders, large touch targets, and no motion on financial alerts.

## Accessibility and responsive rules

Visible focus rings remain mandatory. Body copy and form text must not rely on accent color alone. Buttons and navigation controls keep at least 44px touch targets. Status text is paired with words, not color alone. Mobile layouts collapse rather than compress, and content rails scroll horizontally where needed.

## Do / don’t

Do keep Partner/API products visually separate from the rental wallet and repeat the ownership rule near the action. Do use current stock, prices, and order data. Do keep the main action obvious in one glance. Do preserve every existing route and form behavior.

Don’t copy the reference site’s claims, assets, or exact content. Don’t invent metrics, guarantees, or payment outcomes. Don’t hide sold-out states in operational views. Don’t turn the whole interface into a dark neon dashboard again.
