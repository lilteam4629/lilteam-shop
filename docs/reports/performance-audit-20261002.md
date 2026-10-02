# Website responsiveness audit — 2 October 2026

## Scope and coverage

Shared storefront and admin layouts, rain, gallery, navigation, upload handling, effect lifecycle, and route families. The route inventory lists all declared route handlers for follow-up; inventory is not proof of executing every state.

| Surface | Evidence | Status |
|---|---|---|
| Shared rain | Canvas simulation: at most 25 mobile paints in one second, no paint during active scroll, resume afterward | executed-pass |
| Product gallery | Stalled image releases busy state; no duplicate in-flight requests; scroll yields | executed-pass |
| Shared navigation | Abort/timeout and stylesheet handling inspected; full-screen blur and input blocking removed | inspected and smoke-pass |
| Admin uploads | Signing fetch bounded at 15 seconds; image PUT bounded at 90 seconds; existing error/fallback path retained | inspected; live upload not executed |
| Homepage, catalog, search, help, contact, login, registration, promotions, cart | 36 read-only production browser visits across main/rental sample and desktop/mobile before rollout | executed-pass: no JS errors, 5xx, overflow, or stuck navigation class |
| Admin | Fixture server crawls 45 pages plus inventory, scheduling, theme, media and pricing workflows | executed-pass in isolated test data |
| Other business route families | Full npm test: tenant isolation, security, payments, balance adjustment, promotions, orders, random-box stock, persistence | executed-pass with fixtures |
| Views | All 110 EJS templates compiled | executed-pass |
| Real authenticated sessions/provider/network failure under customer hardware | No authenticated browser session supplied; real payments/uploads not submitted | unverified |

## Changes

- Rain caps painting at 24 FPS mobile/30 FPS desktop and yields during mobile scrolling, preserving canvas resolution and existing intensity settings.
- Gallery and decorative welcome motion yield during scrolling; motion returns after scrolling stops.
- Navigation loading indicator no longer adds full-screen blur or intercepts clicks, allowing a user to select another route while a request is pending. Slip-verification locks remain separate.
- Direct image uploads have network deadlines instead of indefinite pending requests.
- Gallery image requests time out and release their busy state so a broken image does not freeze automatic rotation permanently.
- Updated outdated test assertions to current shared welcome/banner behavior; retained product/stock and banner image priority checks.

## Checks

`npm test` passed after correcting pre-existing assertions referencing the retired hero. `node scripts/test-rain-performance.js`, `node scripts/test-gallery-performance.js`, `node scripts/test-performance-guards.js`, `node scripts/test-page-load-bounds.js`, and `node scripts/smoke-server.js` passed.

Production baseline browser results: 36 visits; zero JS errors, 5xx, overflow, stuck navigation classes, or visits over 3 seconds in the sampled environment. Scroll samples observed 0 long tasks on main desktop/mobile and one ~51–54 ms task on rental desktop/mobile. These are short measurements on the available browser, not guarantees on every device/network.

No claim that every possible bug is absent or all remote pages/customer states were executed. Further device-specific delays require a reproducible route and session.
