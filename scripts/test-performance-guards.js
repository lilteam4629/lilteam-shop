const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const hero = read('src/views/partials/locker-hero.ejs');
const heroCss = read('public/css/locker-hero-v1.css');
const motionCss = read('public/css/scroll-motion-v1.css');
const motionJs = read('public/js/scroll-motion-v1.js');
const layout = read('src/views/layouts/main.ejs');
const adminLayout = read('src/views/layouts/admin.ejs');
const adminMotionCss = read('public/css/admin-scroll-motion-v1.css');
const adminMotionJs = read('public/js/admin-mobile-motion.js');
const shopRoutes = read('src/routes/shop.js');
const homeView = read('src/views/shop/home.ejs');

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
assert.match(adminLayout, /admin-scroll-motion-v1\.css/, 'admin must use the restored motion stylesheet on every viewport');
assert.match(adminLayout, /admin-mobile-motion\.js/, 'admin must use the restored motion controller on every viewport');
assert.doesNotMatch(adminLayout, /admin-motion\.js/, 'desktop must not load a different motion controller');
assert.match(adminMotionJs, /document\.documentElement\.classList\.add\('scroll-motion-ready'\)/, 'desktop admin must retain its panel reveal motion');
assert.match(adminMotionCss, /translate3d\(0,34px,0\) scale\(\.94\).*\.42s cubic-bezier\(\.34,1\.56,\.64,1\)/, 'desktop admin must use the rental console panel motion');
assert.match(adminMotionCss, /max-width:800px.*opacity:1!important;transform:none!important;transition:none!important/, 'mobile admin content must never remain hidden behind reveal motion');
assert.doesNotMatch(adminMotionCss, /admin-page-surface[^\n]*animation/, 'the full desktop work surface must never animate');
assert.doesNotMatch(adminMotionJs, /page\.animate|getBoundingClientRect/, 'admin motion must not animate or synchronously measure the full page');
assert.match(adminMotionCss, /prefers-reduced-motion:reduce\)\{body\.admin-main-site\.admin-reference-ui \.scroll-reveal\{transition-duration:\.42s!important/, 'owner-enabled desktop motion must override the studio 0.01ms reset only on the main site');
assert.match(adminMotionJs, /classList\.contains\('hidden'\)/, 'hidden dialogs must not be registered as page panels');
assert.match(adminMotionJs, /matchMedia\('\(max-width: 800px\)'\).*scroll-reveal-visible/s, 'mobile admin must bypass observer-dependent page hiding');
assert.match(adminMotionJs, /admin-main-site'\)\)requestAnimationFrame\(function\(\)\{requestAnimationFrame\(observeNodes\)/, 'main-site admin reveal must preserve a painted start frame on fast pages');
assert.match(adminMotionJs, /IntersectionObserver/, 'restored motion must reveal without blocking navigation');
assert.doesNotMatch(adminLayout, /backdrop-filter: blur\(4px\)/, 'admin navigation must not blur the full viewport');
assert.match(adminLayout, /navigationShowTimer = setTimeout/, 'fast admin navigation must not flash a blocking overlay');
assert.doesNotMatch(adminLayout, /closest\('a\[href\]'\)[\s\S]{0,500}markNavigating\(\)/, 'ordinary admin links must navigate directly like rent-app');
assert.match(adminLayout, /<main class="admin-page-surface/, 'admin must mark the complete right-hand page surface');
assert.match(shopRoutes, /const HOME_PAGE_SIZE = 24/, 'home must cap the initial product DOM to 24 items');
assert.match(shopRoutes, /active\.slice\(\(page - 1\) \* HOME_PAGE_SIZE, page \* HOME_PAGE_SIZE\)/, 'home must paginate without dropping catalog products');
assert.match(homeView, /productTotalPages > 1/, 'home must expose navigation to every product page');

console.log('Performance guards passed: storefront layers and matching mobile/desktop admin motion');
