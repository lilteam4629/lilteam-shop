const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const hero = read('src/views/partials/locker-hero.ejs');
const heroCss = read('public/css/locker-hero-v1.css');
const motionCss = read('public/css/scroll-motion-v1.css');
const motionJs = read('public/js/scroll-motion-v1.js');
const layout = read('src/views/layouts/main.ejs');
const adminLayout = read('src/views/layouts/admin.ejs');
const adminMotionCss = read('public/css/admin-page-motion-v4.css');
const adminMotionJs = read('public/js/admin-page-motion-v4.js');

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
assert.match(adminLayout, /admin-page-motion-v4\.css/, 'admin must use the smooth page-surface motion stylesheet');
assert.match(adminLayout, /admin-page-motion-v4\.js/, 'admin must use the smooth page-surface motion controller');
assert.doesNotMatch(adminLayout, /backdrop-filter: blur\(4px\)/, 'admin navigation must not blur the full viewport');
assert.match(adminLayout, /navigationShowTimer = setTimeout/, 'fast admin navigation must not flash a blocking overlay');
assert.doesNotMatch(adminLayout, /closest\('a\[href\]'\)[\s\S]{0,500}markNavigating\(\)/, 'ordinary admin links must navigate directly like rent-app');
assert.match(adminLayout, /<main class="admin-page-surface admin-page-entering/, 'admin must start the complete right-hand page motion before first paint');
assert.doesNotMatch(adminMotionCss, /opacity\s*:\s*0/, 'admin page motion must never hide panels or flash the page');
assert.match(adminMotionCss, /scale\(\.982\)/, 'admin entrance must start with a subtle scale instead of a harsh zoom');
assert.match(adminMotionCss, /scale\(1\.004\)/, 'admin entrance must use a restrained spring overshoot');
assert.match(adminMotionJs, /animationend/, 'admin motion must release its compositor layer after entrance');

console.log('Performance guards passed: cacheable hero CSS, finite card reveal layers, touch-scroll rain yielding');
