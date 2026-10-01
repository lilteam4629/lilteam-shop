# Storefront community design handoff

Date: 2026-10-01

## Scope and result

This is an extension of the main shop storefront only: service hours, shop announcements, and recent purchases. The revised composition puts service hours and the announcement in one short information row, then gives recent purchases the full width below. Recent purchases move continuously in a horizontal rail with the revised cards. This removes the tall empty space previously created by stretching the service panel beside both announcements and orders. Both homepage variants select the new partial only when `isMainSite` is true. Customer rental shops retain the previous service strip, announcement markup and recent-order rail, including its previous placement. The community script loads only for the main shop.

The section inherits Kanit and the live shop theme variables, including `--text`, `--card`, and `--gold-text`. The service panel uses a restrained accent tint in light and dark themes. Store name, hours, tagline, announcements, product images, prices, timestamps, and buyer labels come from existing template data. Contact opens `/contact`; purchase cards open their product route or `/products` when a slug is absent.

## Interaction and accessibility

The service desk reuses the Bangkok analog clock and adds a restrained light sweep. Recent purchases move continuously at about 55 pixels per second; duplicate groups provide a seamless loop and are hidden from assistive technology and keyboard navigation while their visible product links remain clickable by pointer. The 44 px pause/resume button has Thai accessible labels and visible keyboard focus. Hover, keyboard focus, and manual scrolling each pause motion. The rail supports touch scrolling and keyboard arrow navigation. Explicit pause state persists for the mounted section. Motion also stops offscreen, in a hidden tab, and when reduced motion is requested. Reduced motion removes the service sweep, orbit animation, second hand, and rail animation. Lifecycle handlers remount after storefront navigation and clean up listeners, timers, and observers.

Empty announcements and purchases are omitted by the template. Hidden service hours collapse the desktop grid. The rail measures its card group and duplicates it only as needed to fill the viewport without a gap in the moving sequence.

## Source and wiring

- `src/views/partials/storefront-community.ejs`: shared data-bound markup.
- `public/css/storefront-community-v1.css`: scoped layout, theme roles, responsive rules, and motion preferences.
- `public/js/storefront-community-v1.js`: purchase pagination and pause behavior.
- `public/js/main-service-strip-v1.js`: reused clock and service visibility lifecycle.
- `src/views/shop/home.ejs`: partial included in both homepage variants.
- `src/views/layouts/main.ejs`: Kanit and deferred community script.
- `scripts/build-css-bundles.js`: community stylesheet included in the storefront bundles.

## Evidence and limits

The supplied section screenshots were visually reviewed: `desktop.png`, `mobile.png`, `small-mobile.png`, and `dark.png`, under `C:/Users/Administrator/Desktop/web lilteam/.artifact_work/community-redesign/`. They show the two-column desktop composition, narrow stacked cards, complete control rows at both mobile widths, and reversed service colors in dark mode. Static images establish layout and theme appearance; they do not establish runtime interaction behavior. The interaction notes above are grounded in source review. This documentation pass ran no tests and changed no implementation.

The current design could not be created in Figma because the available Figma quota was exhausted. Local implementation and screenshots are the handoff evidence; there is no current Figma artifact.

## Existing design documentation

The incumbent `DESIGN.md` describes a Prompt/IBM Plex Mono, fixed paper-and-gold system and a recent-order horizontal rail. The rendered application uses Kanit and tenant theme variables; that font/token drift predates this handoff. The paged card section replaces the rail in this update. `DESIGN.md` and `.impeccable/design.json` are preserved; this report records only the scoped section and does not redefine the whole-site design system.
