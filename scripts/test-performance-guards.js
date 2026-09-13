const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const hero = read('src/views/partials/locker-hero.ejs');
const heroCss = read('public/css/locker-hero-v1.css');
const motionCss = read('public/css/scroll-motion-v1.css');
const motionJs = read('public/js/scroll-motion-v1.js');
const layout = read('src/views/layouts/main.ejs');

assert.match(hero, /locker-hero-v1\.css/, 'large hero styles must be a cacheable asset');
assert.doesNotMatch(hero, /<style>/, 'large hero CSS must not be repeated in every home response');
assert.ok(heroCss.length > 1000, 'extracted hero stylesheet must contain the complete design');
assert.match(motionCss, /scroll-reveal-visible\{opacity:1!important;transform:none!important;transition:/, 'product cards need an important transition that overrides home safety styles');
assert.match(motionCss, /scroll-reveal-complete[^}]*transform:none!important/, 'finished reveals must release compositor transforms');
assert.match(motionJs, /scroll-reveal-complete/, 'cards must mark completed reveals');
assert.match(motionJs, /transitionend/, 'cards must leave their transition layer after revealing');
assert.match(motionCss, /scroll-reveal-admin\{transform:translate3d\(0,24px,0\) scale\(\.96\);transition-duration:\.38s/, 'mobile admin reveal must match the rental console');
assert.match(motionCss, /:not\(\.scroll-reveal-admin\)/, 'mobile performance overrides must not flatten the admin bounce');
assert.match(layout, /coarse&&document\.documentElement\.classList\.contains\('mobile-is-scrolling'\)/,
  'full-screen rain rendering must yield while a touch device scrolls');

console.log('Performance guards passed: cacheable hero CSS, finite card reveal layers, touch-scroll rain yielding');
