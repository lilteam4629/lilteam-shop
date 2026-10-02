# Continuous rain and browsing performance — 2026-10-02

## Repairs
- Replace the full viewport canvas/JavaScript repaint loop with two repeating SVG texture layers, animated by CSS transforms. No scroll or navigation handler pauses/hides rain.
- Preserve installed/enabled flags, validated tenant color, three density settings, and reduced motion preference.
- Skip screenshot view transitions on rain-enabled pages. Restore route scroll position instantly.
- Gallery measurements run after the new page has painted, read all geometry before any style writes, and cancel queued work during unloading.
- Defer automatic YouTube startup until 1.5 seconds without scroll/pointer activity and no active navigation. Explicit play still starts immediately; existing playback continues.

## Evidence
- Focused rain rendering, gallery timeout/batching, music startup/lifecycle and music widget regressions passed.
- Browser checks substitute the candidate code into real public storefront responses without changing shop data. Main and rental shops, 1440px and 390px: rain transforms changed throughout scrolling; animation running/visible throughout; one container/two layers after navigation; no page errors.
- DevTools trace identified repeated layout work inside gallery initialization and YouTube embed script startup. After gallery batching is deferred until after paint, the final sampled desktop trace has no timeline event over 40ms in the measured scroll/navigation window.
- Long Task observer still recorded some main-shop startup work (about 90–125ms) outside that final timeline sample. Network transfer and third-party player startup are not proven zero-cost. Browser viewport tests are not physical handset GPU measurements.

## Scope
Shared public layout and gallery implementation; no changes to tenant data, balances, checkout, admin permissions, or rain settings.
