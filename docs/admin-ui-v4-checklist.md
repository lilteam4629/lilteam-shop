# Admin UI V4 coverage checklist

## Included menus

- [x] Dashboard (`/admin`)
- [x] Products (`/admin/products`)
  - [x] New product (`/admin/products/new`)
  - [x] Edit product (`/admin/products/:id/edit`)
  - [x] Bulk import (`/admin/products/bulk-import`)
  - [x] Stock detail and entry (`/admin/products/:id/stock`)
  - [x] Delete confirmation modal
- [x] Scheduled products (`/admin/scheduled-products`)
- [x] Filter tags (`/admin/filter-tags`)
  - [x] Create drawer, inline rename, product assignment drawer, drag assignment
- [x] Storefront categories (`/admin/home-sections`)
  - [x] Create drawer, edit panel, full-image product picker, ordering and deletion
- [x] Orders (`/admin/orders`)
  - [x] Order detail and status form (`/admin/orders/:id`)
- [x] Top-ups and slip review (`/admin/topups`)
  - [x] Search/filter, pending/history states and payment setting forms
- [x] Coupons (`/admin/coupons`)
  - [x] Create, toggle and delete states
- [x] Members (`/admin/users`)
  - [x] Search/filter, create, wallet amount and suspension forms
- [x] Minigame (`/admin/minigame`)
  - [x] Settings, prize forms, images, stock, history and delivery states
- [x] Appearance and announcements (`/admin/appearance`, `/admin/theme`, `/admin/announcements`)
- [x] Store settings (`/admin/settings`)
  - [x] Store, music and visual-effect forms

## Protected exclusion

- [x] Automatic slip verification (`/admin/easyslip-usage`, `/admin/slip-verification`, redirected API provider routes)
- [x] Its view files and provider logic were not changed.
- [x] Admin Design System CSS is conditionally excluded for its active page identifiers.

## Verification

- [x] Sidebar/menu inventory compared with admin GET routes.
- [x] 64 form actions inventoried and matched against the existing route families.
- [x] EJS templates compile.
- [x] First-party JavaScript syntax checks.
- [x] CSS delimiter checks.
- [x] Final diff excludes protected slip views and logic.
- [ ] Browser UI automation unavailable in this session; production HTTP health and deployed assets are checked after deployment.
- [ ] Project has no TypeScript, lint or build scripts.
- [ ] `npm test` is a placeholder that exits with `Error: no test specified`.
