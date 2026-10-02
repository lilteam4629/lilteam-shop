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


## Follow-up — 2026-10-03
- Reproduced invisible desktop rain: live SVG stroke was #000000 on a black storefront. It was loaded and animating with no console error. Added separate theme-aware texture colors; black is lightened in dark mode and white darkened in light mode, without an animated CSS filter or changing stored settings.
- Explicitly enabled rain keeps falling more slowly under reduced-motion preference instead of disappearing/static trails.
- Avoid redundant root class mutations on every scroll frame. Skip gallery geometry reads for known fixed-ratio product media frames. Pause hero decoration only when outside the viewport (rain remains active).
- Isolate catalog card layout/paint. An experimental content-visibility approach was rejected by an existing regression protecting native lazy-loaded images and was removed before delivery.
- Candidate browser checks: desktop 1440px and mobile 390px; real wheel scrolling, navigation to /products, two theme colors, search matching the last product, clearing search, reduced-motion animation running, and zero page errors all passed.
- Final comparison with CPU throttled 4x over the same scroll/navigation sequence: desktop layout 715→660ms/style 1334→1313ms; mobile layout 661→612ms/style 4611→4487ms. These are sums over the measured interval, not individual-frame or network latency guarantees. Earlier provisional numbers used a rejected experiment and are superseded.
