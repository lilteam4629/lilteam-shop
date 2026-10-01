# Storefront community design handoff

Date: 2026-10-01; updated 2026-10-02

## Scope and result

This is an extension of the main shop storefront only: service hours, shop announcements, and recent purchases. The latest composition uses a compact signal dock: a small service chip with an analog clock, service hours, tagline, status dot, and contact arrow beside an open announcement feed. Recent purchases use the full width below. The desktop dock is about 68 px high. On mobile, the service chip and announcement stack into an upper section about 110 px high, compared with about 194 px in the previous composition. These measurements describe the supplied content; longer shop text or additional announcements can increase height. Both homepage variants select the new partial only when `isMainSite` is true. Customer rental shops retain the previous service strip, announcement markup and recent-order rail, including its previous placement. The community script loads only for the main shop.

The section inherits Kanit and the live shop theme variables, including `--text`, `--card`, and `--gold-text`. The service chip uses a restrained accent tint, thin border, and inset accent edge in light and dark themes. Announcements sit on the page surface with a small megaphone marker. Store name, hours, tagline, announcements, product images, prices, timestamps, and buyer labels come from existing template data. The 44 px contact arrow opens `/contact`; purchase cards open their product route or `/products` when a slug is absent.

## Interaction and accessibility

The service chip reuses the Bangkok analog clock and adds a restrained light sweep and status pulse. Recent purchases preserve continuous horizontal motion at about 55 pixels per second without visible navigation or pause/resume controls, as requested by the owner. Duplicate groups provide a seamless loop and are hidden from assistive technology and keyboard navigation while their visible product links remain clickable by pointer. Hover does not stop automatic motion. Pointer interaction, manual scrolling, and arrow-key scrolling of the focusable rail temporarily pause motion; it resumes after 1.4 seconds of inactivity. The rail stops offscreen and in a hidden tab. Product thumbnails keep their small dimensions and use `object-fit: contain` to show the entire source image without cropping.

Reduced motion removes the service sweep, status pulse, orbit animation, and second hand. The purchase rail continues slowly at about 16 pixels per second, including on desktop; it is not disabled by that preference. Lifecycle handlers remount after storefront navigation and clean up listeners, timers, and observers.

Empty announcements and purchases are omitted by the template. Hidden service hours collapse the desktop grid. The rail measures its card group and duplicates it only as needed to fill the viewport without a gap in the moving sequence.

## Source and wiring

- `src/views/partials/storefront-community.ejs`: shared data-bound markup.
- `public/css/storefront-community-v1.css`: scoped layout, theme roles, responsive rules, and motion preferences.
- `public/js/storefront-community-v1.js`: continuous purchase rail, loop measurement, interaction pauses, and motion speed.
- `public/js/main-service-strip-v1.js`: reused clock and service visibility lifecycle.
- `src/views/shop/home.ejs`: partial included in both homepage variants.
- `src/views/layouts/main.ejs`: Kanit and deferred community script.
- `scripts/build-css-bundles.js`: community stylesheet included in the storefront bundles.

## Evidence and limits

The earlier section screenshots (`desktop.png`, `mobile.png`, `small-mobile.png`, and `dark.png`, under `C:/Users/Administrator/Desktop/web lilteam/.artifact_work/community-redesign/`) record prior compositions and should not be used as evidence of the latest signal dock. The latest reported layout measurements are about 68 px for the desktop dock and 110 px for the mobile upper section, versus 194 px previously. The interaction notes above are grounded in current source review. Static screenshots do not establish continuous motion or interaction behavior. This documentation update ran no tests and changed no implementation.

The current design could not be created in Figma because the available Figma quota was exhausted. Local implementation and screenshots are the handoff evidence; there is no current Figma artifact.

## Existing design documentation

The incumbent `DESIGN.md` describes a Prompt/IBM Plex Mono, fixed paper-and-gold system and a recent-order horizontal rail. The rendered application uses Kanit and tenant theme variables; that font/token drift predates this handoff. The latest update retains continuous recent-order motion with refreshed cards beneath the compact signal dock. `DESIGN.md` and `.impeccable/design.json` are preserved; this report records only the scoped section and does not redefine the whole-site design system.
