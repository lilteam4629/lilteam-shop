const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const hero = read('src/views/partials/locker-hero.ejs');
const heroCss = read('public/css/locker-hero-v1.css');
const motionCss = read('public/css/scroll-motion-v1.css');
const motionJs = read('public/js/scroll-motion-v1.js');
const layout = read('src/views/layouts/main.ejs');
const adminLayout = read('src/views/layouts/admin.ejs');
const shopRoutes = read('src/routes/shop.js');
const homeView = read('src/views/shop/home.ejs');
const adminMobileCss = read('public/css/admin-mobile-v1.css');
const minigameWidget = read('src/views/partials/minigame-widget.ejs');
const minigameRail = read('src/views/partials/minigame-rail.ejs');
const filterPanel = read('src/views/partials/filter-panel.ejs');
const productDetail = read('src/views/shop/product-detail.ejs');
const productForm = read('src/views/admin/product-form.ejs');
const adminProducts = read('src/views/admin/products.ejs');

assert.match(hero, /locker-hero-v1\.css/, 'large hero styles must be a cacheable asset');
assert.doesNotMatch(hero, /<style>/, 'large hero CSS must not be repeated in every home response');
assert.ok(heroCss.length > 1000, 'extracted hero stylesheet must contain the complete design');
assert.match(motionCss, /scroll-reveal-visible\{opacity:1!important;transform:none!important;transition:/, 'product cards need an important transition that overrides home safety styles');
assert.match(motionCss, /scroll-reveal-complete[^}]*transform:none!important/, 'finished reveals must release compositor transforms');
assert.match(motionJs, /scroll-reveal-complete/, 'cards must mark completed reveals');
assert.match(motionJs, /transitionend/, 'cards must leave their transition layer after revealing');
assert.match(motionCss, /scroll-reveal-admin\{transform:translate3d\(0,24px,0\) scale\(\.96\);transition-duration:\.38s/, 'mobile admin reveal must match the rental console');
assert.match(motionCss, /:not\(\.scroll-reveal-admin\)/, 'mobile performance overrides must not flatten the admin bounce');
assert.doesNotMatch(layout, /mobile-is-scrolling[^\n]{0,120}(return|continue)/,
  'rain must not freeze while a touch device scrolls');
assert.match(layout, /contain:layout paint size;transform:translateZ\(0\);will-change:transform/,
  'rain canvas must stay isolated from page layout and paint');
assert.match(layout, /Math\.min\(\.08,Math\.max\(\.001,\(now-last\)\/1000\)\)/,
  'rain must preserve its velocity after a dropped frame');
assert.match(layout, /function start\(\).*function stop\(\)/s,
  'rain must restart reliably after browser lifecycle suspension');
assert.doesNotMatch(adminLayout, /admin-scroll-motion-v1\.css|admin-mobile-motion\.js|admin-motion\.js|admin-page-surface/, 'admin must not load or expose the removed bounce system');
assert.doesNotMatch(adminLayout, /backdrop-filter: blur\(4px\)/, 'admin navigation must not blur the full viewport');
assert.match(adminLayout, /navigationShowTimer = setTimeout/, 'fast admin navigation must not flash a blocking overlay');
assert.doesNotMatch(adminLayout, /closest\('a\[href\]'\)[\s\S]{0,500}markNavigating\(\)/, 'ordinary admin links must navigate directly like rent-app');
assert.match(shopRoutes, /const HOME_PAGE_SIZE = 24/, 'home must cap the initial product DOM to 24 items');
assert.match(shopRoutes, /active\.slice\(\(page - 1\) \* HOME_PAGE_SIZE, page \* HOME_PAGE_SIZE\)/, 'home must paginate without dropping catalog products');
assert.match(shopRoutes, /UNPAGINATED_HOME_TENANTS = new Set\(\['moopee-shop'\]\)/, 'Moopee Shop must be the only tenant with an unpaginated home catalog');
assert.match(shopRoutes, /showAllProducts\s*\? active\s*:\s*active\.slice/, 'the selected tenant must receive every visible product on its home page');
assert.match(shopRoutes, /req\.query\.recommended/, 'recommended category links must be handled by the products route');
assert.match(shopRoutes, /recommendedCategory\.productIds/, 'recommended category listings must filter by assigned product ids');
assert.match(shopRoutes, /rangersFeatured:[\s\S]{0,260}slice\(0, 5\)/, 'Rangers hero must expose the refreshed Top 1–5 lineup');
assert.match(homeView, /productTotalPages > 1/, 'home must expose navigation to every product page');
assert.match(homeView, /recommended=<%=?\s*encodeURIComponent\(category\.id\)/, 'recommended category cards must link to their filtered listing');
assert.match(adminMobileCss, /main > \.grid\[class~="md:grid-cols-2"\][\s\S]{0,300}min-width: 0/, 'mobile minigame preview grid must be allowed to shrink');
assert.match(adminMobileCss, /admin-page-minigame \.mg-stage[^}]*height: 168px/, 'mobile box preview must keep a readable stage');
assert.match(minigameWidget, /\.mg-box {/, 'box preview must render its initial gift');
assert.match(minigameWidget, /new AbortController\(\)[\s\S]{0,180}10000/, 'box preview must time out a stalled request');
assert.match(minigameWidget, /pageshow[\s\S]{0,180}releaseBusyState/, 'box preview must recover from browser cache with an enabled button');
assert.match(minigameRail, /\.rail-window{[^}]*overflow:hidden/, 'rail preview must clip its track inside the viewport');
assert.match(minigameRail, /new AbortController\(\)[\s\S]{0,180}10000/, 'rail preview must time out a stalled request');
assert.match(minigameRail, /transitionend['"],completeSpin/, 'rail preview must finish from the real transition event');
assert.match(minigameRail, /pageshow[\s\S]{0,180}releaseSpin/, 'rail preview must recover from browser cache with an enabled button');

assert.match(filterPanel, /window\.location\.assign\(query\?['"]\/products\?tags=/, 'filter selection must navigate to a server-filtered listing');
assert.doesNotMatch(filterPanel, /if\(cards\.length\)\{apply\(\);return\}/, 'filter selection must not remain client-only');
assert.match(productDetail, /product-action-secondary/, 'purchase action must use a theme-independent readable class');
assert.match(productDetail, /product-topup-action/, 'top-up action must use a theme-independent readable class');
assert.match(productForm, /fallbackData\.append\('productImages'/, 'folder import must fall back to the server uploader when direct R2 upload fails');
assert.match(productForm, /return submitData\(fallbackData\)/, 'folder import fallback must submit and create products');
[
  '/admin/products/bulk-import',
  'id="bulk-price-open"',
  '/admin/products/stock/add-all',
  '/admin/products/set-status-all',
  'id="delete-all-products-btn"',
].forEach(marker => assert.match(adminProducts, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `rental shop product admin is missing ${marker}`));
assert.doesNotMatch(adminProducts, /isMainSite[\s\S]{0,300}(bulk-actions|bulk-import|bulk-price|stock\/add-all)/, 'rental shop bulk actions must not be gated to the main site');
console.log('Performance guards passed: storefront layers and matching mobile/desktop admin motion');
