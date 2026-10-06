# Admin workspace verification — 2026-10-07

The current Node.js/Express admin uses one shared sidebar and page shell across the main shop and rental shops. The shared navigation groups the working routes into overview, products and stock, orders and finance, customers, system tools, storefront, and settings. Route-level smoke checks confirm that the 45 discovered admin pages keep this shell and their existing server-backed actions.

## Mobile and desktop checks

- Tested the isolated `NODE_ENV=test` app at a 390 × 844 mobile viewport. The mobile category drawer displayed all seven groups and 22 navigation entries; `documentElement.scrollWidth` matched its client width.
- Opened Orders from the drawer. The URL changed to `/admin/orders`, the active sidebar item matched that route, and the drawer closed.
- Tested the same page at 1440 × 900. The sidebar ended at x=244 and the main content began at x=244; document width matched viewport width, with no sidebar/content overlap.
- Added smoke assertions so every crawled admin route must render the mobile menu trigger and drawer target, and the drawer sidebar must remain visible when the desktop rail is hidden.

## Automated verification

`npm test` passed on the release checkout based on `origin/main` at `5ecdc1dd`. This included security, admin UI consistency and shell rendering, theme, mobile/desktop performance guards, payment and wallet safety, tenant isolation, and smoke crawling 45 admin pages. Import-safety reported 95 checks, 76 JavaScript files, 110 templates, and no customer data access. The test suite uses isolated fixtures; it does not submit a production order, top-up, or prize draw.

No production-only settings were changed as part of this verification.
