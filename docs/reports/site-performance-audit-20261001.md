# Site performance and reliability audit — 2026-10-01

## Scope and confirmed changes
Shared application serving main site and tenants. Baseline: e4778408b0d2. No production customer mutations performed.

- Hover/focus prefetch previously had no request cap and included authenticated routes. Now public routes only, no query variants, 250 ms intent delay, cancellation on exit and maximum three prefetches per document. Existing save-data/slow-connection protection retained.
- A superseded soft navigation could finish waiting for route styles and swap old content. Recheck request identity/abort after style loading and remove abandoned styles.
- Order list previously summarized/rendered every order. Page size 20 now bounds expensive summaries and DOM output; all orders remain accessible through pagination. Existing user ownership filter preserved.
- Product listing consolidates three CSS requests into one, preserving source order. Main service strip CSS moves into existing shared pre-bundles. SVG icons receive intrinsic dimensions.
- Slip administration replaces nested CSS @import with a head-extracted stylesheet link.
- CSS bundle check normalizes CRLF before comparing, preventing Windows-only false stale reports.

## Verification
- Full npm test: executed-pass, exit 0. Smoke server crawled 45 admin pages, storefront assets, ordinary bulk pricing/import, scheduled publishing, model access rejection and 404.
- npm run build:css: executed-pass. git diff --check: executed-pass.
- test-page-load-bounds: executed-pass; denied private prefetch, intent cancellation, cap, middle/last page clamping with 45 synthetic orders.
- test-order-history-summary: executed-pass; grouping, snapshots, delivery summary and credential privacy.
- Browser: localhost products/help/contact navigation, no loading class after completion; no body stylesheet links; mobile viewport 390 × 844 no horizontal document overflow (382/382 measured); theme control and synthetic order summary inspected. Screenshot orders-qa.jpg is fixture data.
- Several baseline assertions described obsolete behavior (removed SlipCheck save, pre-bundle references, one ticker clone, old polling deadline, theme names in inline CSS). Updated assertions to current authorized behavior. Admin stylesheet budget 11 includes the existing responsive layer; no assertions or test suites disabled.

## Coverage ledger
Literal route inventory: performance-audit-20261001/routes.json (213 definitions). Dynamic parameter routes are listed as patterns; coverage below does not imply every data/parameter combination was executed.

| Family/subsystem | Shared dependencies and states | Evidence/result | Remaining boundary |
| --- | --- | --- | --- |
| shop/public | home, listing, game detail, recommended categories, previews, help/contact, themes, assets | inspected + executed-pass: storefront, category, contrast, model, smoke and browser checks | Every live tenant/content combination not manually opened |
| auth | login/register/logout, sessions, password validation | inspected + executed-pass: security/import/smoke fixture login | Live customer session expiry not simulated |
| account | orders/details, profile, topup/status/slips, ownership | inspected + executed-pass: page bounds, summary privacy, import, payment receiver and recovery checks | No live money transfer or new real slip submitted |
| cart | normal stock, wallet/order integrity | inspected + executed-pass: transaction/security fixtures and existing smoke | No live purchase |
| promotions | coupons, claims, referrals, tenant visibility | inspected + executed-pass: promotions and tenant feature fixtures | External real referral campaign not exercised |
| admin | all declared admin route families, lists/details/forms/filters/themes, stock/catalog/finance/settings | inspected + executed-pass: 45 HTTP pages, UI/theme/render/import/stock tests | Unlinked routes/rare forms inspected and fixture-covered where tests exist, not all POST payloads executed |
| internal-api | authentication/config/media/slip endpoints | inspected + executed-pass: security/receiver/transaction boundaries | R2 upload and external client protocol not end-to-end exercised |
| license | activation/gating | inspected; local tests gate off | Live license activation unverified |
| custom-systems-admin | rain module action/installation boundary | inspected + executed-pass: undeployed module isolation smoke | External module installation not performed |
| minigame/random-box | route and shared dependencies | inspected; pre-existing regression suite executed-pass, logic unchanged | No live prize/payment interaction performed |
| tenant resolution/catalog | AsyncLocalStorage ownership, tenant data, main catalog routing | inspected + executed-pass: tenant/catalog/partner tests | Every individual production tenant not separately crawled |
| storage | safe-save, revisions, codecs, rollback/atomic local transactions | inspected + executed-pass: existing storage suites | Production MongoDB load profile/CPU not accessible via repository tests |
| integrations | Slip providers, TrueMoney, music, Discord, media | inspected + executed-pass: mocks, timeout/recovery/provider-safety/music tests | Real upstream quota/authentication/outages and Discord delivery unverified |
| runtime/operations | compression/cache/security/build/deploy | inspected + executed-pass: build/start/health checks | Production load benchmark and server resource telemetry not measured |

## Deployment
Deployment verification will be recorded after pushing the shared release. The first live HTTP measurement had one DNS failure; later health succeeded, so this is not evidence of persistent DNS misconfiguration. No numerical speed-up claim is made without comparable production measurements.
