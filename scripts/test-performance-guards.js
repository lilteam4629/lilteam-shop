const assert = require('node:assert/strict');
const fs = require('node:fs');
const { checkCssBundles } = require('./build-css-bundles');

const read = file => fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const hero = read('src/views/partials/locker-hero.ejs');
const heroCss = read('public/css/locker-hero-v1.css');
const motionCss = read('public/css/scroll-motion-v1.css');
const motionJs = read('public/js/scroll-motion-v1.js');
const layout = read('src/views/layouts/main.ejs');
const adminLayout = read('src/views/layouts/admin.ejs');
const adminExperimentLayout = read('src/views/layouts/admin-experiment.ejs');
const shopRoutes = read('src/routes/shop.js');
const homeView = read('src/views/shop/home.ejs');
const latestOrdersRail = read('src/views/partials/latest-orders-rail.ejs');
const welcomePopupCss = read('public/css/storefront-welcome-popup-experiment-v1.css');
const adminMobileCss = read('public/css/admin-mobile-v1.css');
const minigameWidget = read('src/views/partials/minigame-widget.ejs');
const minigameRail = read('src/views/partials/minigame-rail.ejs');
const minigameExperiment = read('src/views/admin/minigame-experiment.ejs');
const minigameExperimentCss = read('public/css/admin-experiment-minigame-v1.css');
const { buildLiveCatalogPreview } = require('../src/services/minigame');
const filterPanel = read('src/views/partials/filter-panel.ejs');
const productDetail = read('src/views/shop/product-detail.ejs');
const productForm = read('src/views/admin/product-form.ejs');
const adminProducts = read('src/views/admin/products.ejs');
const rangerMarketJs = read('public/js/storefront-rangers-market-v1.js');

assert.deepEqual(checkCssBundles(), { ok: true, staleFiles: [] },
  'storefront CSS bundles must stay in sync with the source stylesheets');
assert.match(layout, /storefront-pre-home-v1\.css/,
  'the home page must use one pre-theme bundle instead of its full stylesheet chain');
assert.match(layout, /storefront-pre-unified-v1\.css/,
  'every other unified storefront page must use one pre-theme bundle');
assert.match(layout, /storefront-post-home-v1\.css/,
  'the home page must use one post-theme bundle');
assert.match(layout, /storefront-post-unified-v1\.css/,
  'every other unified storefront page must use one post-theme bundle');

for (const [name, routeLayout] of [['storefront', layout], ['admin', adminLayout], ['admin experiment', adminExperimentLayout]]) {
  assert.match(routeLayout, /data-route-stylesheet/, `${name} must promote page stylesheets into the document head`);
  assert.match(routeLayout, /routeStylesheetMarkup/, `${name} layout must render extracted page stylesheets before body content`);
}
const styleReadyIndex = layout.indexOf('await prepareRouteStyles');
const shellSwapIndex = layout.indexOf('currentShell.replaceWith(nextShell)');
assert.ok(styleReadyIndex >= 0 && styleReadyIndex < shellSwapIndex,
  'seamless storefront navigation must finish loading destination styles before swapping the page shell');
assert.match(layout, /waitForStylesheet\(link, signal\)/,
  'route navigation must wait for stylesheet completion and support aborting stale requests');
assert.match(layout, /commitRouteStyles\(routeStyles\)/,
  'old route styles must be retired only as the new page is committed');

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
assert.match(layout, /contain:layout paint size/,
  'rain canvas must stay isolated from page layout and paint');
assert.doesNotMatch(layout, /id="store-rain"[^>]*(?:translateZ\(0\)|will-change:transform)/,
  'full-screen rain canvas must not force a GPU layer that can flash large black polygons');
assert.match(layout, /Math\.min\(\.08,Math\.max\(\.001,\(now-last\)\/1000\)\)/,
  'rain must preserve its velocity after a dropped frame');
assert.match(layout, /function start\(\).*function stop\(\)/s,
  'rain must restart reliably after browser lifecycle suspension');
assert.doesNotMatch(adminLayout, /admin-scroll-motion-v1\.css|admin-mobile-motion\.js|admin-motion\.js|admin-page-surface/, 'admin must not load or expose the removed bounce system');
assert.doesNotMatch(adminLayout, /backdrop-filter: blur\(4px\)/, 'admin navigation must not blur the full viewport');
assert.match(adminLayout, /navigationShowTimer = setTimeout/, 'fast admin navigation must not flash a blocking overlay');
assert.doesNotMatch(adminLayout, /closest\('a\[href\]'\)[\s\S]{0,500}markNavigating\(\)/, 'ordinary admin links must navigate directly like rent-app');
assert.match(shopRoutes, /const HOME_PAGE_SIZE = 24/, 'home must cap the initial product DOM to 24 items');
assert.match(shopRoutes, /const HOME_SECTION_PREVIEW_SIZE = 8/, 'featured home sections must cap the initial product DOM to eight cards each');
assert.match(shopRoutes, /totalProducts: products\.length,[\s\S]{0,100}products: products\.slice\(0, HOME_SECTION_PREVIEW_SIZE\)/, 'featured section previews must keep the full item count while rendering only the initial cards');
assert.match(homeView, /section\.totalProducts \|\| section\.products\.length/, 'featured section headings must continue to show the full item count');
assert.match(shopRoutes, /active\.slice\(\(page - 1\) \* HOME_PAGE_SIZE, page \* HOME_PAGE_SIZE\)/, 'every storefront must paginate without dropping catalog products');
assert.doesNotMatch(shopRoutes, /UNPAGINATED_HOME_TENANTS|showAllProducts/, 'no storefront may bypass the initial home catalog page limit');
assert.match(shopRoutes, /viewData\.storefrontOwnerHomeV7 = true/, 'every standard storefront home must enable the shared layout fallback');
assert.match(layout, /id="storefront-home-critical-fallback"/, 'homepage grid and cards must stay bounded if a cached theme layer is delayed');
assert.match(shopRoutes, /welcomePopupRedesign: false/, 'tenant and secondary storefront renders must keep the legacy welcome popup by default');
assert.match(shopRoutes, /viewData\.welcomePopupRedesign = true/, 'the accessible welcome popup redesign must be enabled for every tenant storefront');
assert.match(homeView, /<% if \(showWelcomePopupRedesign\) \{ %><link rel="stylesheet" href="<%= asset\('css\/storefront-home-popup-v1\.css'\) %>" \/>/, 'main shop must load the combined redesigned welcome popup styles');
assert.match(homeView, /const showWelcomePopupRedesign = Boolean\(welcomePopupRedesign \|\| welcomePopupExperiment\)/, 'local popup experiments must keep working independently of production rollout');
assert.match(welcomePopupCss, /welcome-popup-slider img\{object-fit: contain;object-position: center\}/, 'announcement images must remain fully visible without cropping');
const homeSvgTags = [...homeView.matchAll(/<svg\b[^>]*>/g)];
assert.ok(homeSvgTags.length > 0 && homeSvgTags.every(match => /\bwidth="\d+"/.test(match[0]) && /\bheight="\d+"/.test(match[0])), 'homepage SVGs must have intrinsic dimensions to prevent unstyled oversized icons');
const criticalHomeImageTags = [...homeView.matchAll(/<img\b[^\n]*?\/>/g)].filter(match => !/src=""/.test(match[0]));
assert.ok(criticalHomeImageTags.every(match => /\bwidth="\d+"/.test(match[0]) && /\bheight="\d+"/.test(match[0])), 'homepage images must reserve layout space before decoding');
const latestOrderSvgTags = [...latestOrdersRail.matchAll(/<svg\b[^>]*>/g)];
assert.ok(latestOrderSvgTags.length > 0 && latestOrderSvgTags.every(match => /\bwidth="\d+"/.test(match[0]) && /\bheight="\d+"/.test(match[0])), 'recent order icons and chevrons must have intrinsic dimensions');
assert.match(latestOrdersRail, /width="54" height="60" class="latest-order-image"/, 'recent order thumbnails must have stable dimensions before image decoding');
const latestOrdersMotion = read('public/js/latest-orders-3d-v1.js');
assert.match(latestOrdersMotion, /track\.children\.length < 2/, 'latest-order rail may add at most one clone group');
assert.match(homeView, /loading="lazy" decoding="async" fetchpriority="low" class="mg-prize-image"/, 'offscreen minigame images must not delay the initial homepage render');
assert.match(shopRoutes, /req\.query\.recommended/, 'recommended category links must be handled by the products route');
assert.match(shopRoutes, /recommendedCategory\.productIds/, 'recommended category listings must filter by assigned product ids');
assert.match(shopRoutes, /rangersFeatured:[\s\S]{0,260}slice\(0, 5\)/, 'Rangers hero must expose the refreshed Top 1–5 lineup');
assert.match(homeView, /productTotalPages > 1/, 'home must expose navigation to every product page');
assert.match(homeView, /recommended=<%=?\s*encodeURIComponent\(category\.id\)/, 'recommended category cards must link to their filtered listing');
assert.match(homeView, /home-category-grid\{display:grid!important;grid-template-columns:1fr!important/, 'mobile recommended categories must use full-width banner rows');
assert.match(adminMobileCss, /main > \.grid\[class~="md:grid-cols-2"\][\s\S]{0,300}min-width: 0/, 'mobile minigame preview grid must be allowed to shrink');
assert.match(adminMobileCss, /admin-page-minigame \.mg-stage[^}]*height: 168px/, 'mobile box preview must keep a readable stage');
assert.match(minigameWidget, /\.mg-box {/, 'box preview must render its initial gift');
assert.match(minigameWidget, /new AbortController\(\)[\s\S]{0,180}10000/, 'box preview must time out a stalled request');
assert.match(minigameWidget, /mg-box-scene\.is-shaking \.mg-box-aura[^}]*infinite/, 'box preview must keep a visible anticipation effect while the weighted result loads');
assert.match(minigameWidget, /minShakeMs = visualExperience \? \(reduceMotion \? 80 : 1400\)/, 'box preview must hold a full shake and opening sequence before revealing the result');
assert.match(minigameWidget, /mg-lid-open \.9s/, 'box preview must visibly lift the lid before revealing the prize');
assert.match(minigameWidget, /pageshow[\s\S]{0,240}previewUnavailable[\s\S]{0,80}releaseBusyState/, 'box preview must recover a busy animation without unlocking an empty prize pool');
assert.match(minigameRail, /\.rail-window{[^}]*overflow:hidden/, 'rail preview must clip its track inside the viewport');
assert.match(minigameRail, /new AbortController\(\)[\s\S]{0,180}10000/, 'rail preview must time out a stalled request');
assert.match(minigameRail, /function warmup\(now\)[\s\S]{0,420}requestAnimationFrame\(warmup\)/, 'rail must begin continuously moving while the result is being selected');
assert.ok(minigameRail.indexOf('if(!reduceMotion)spinFrame=requestAnimationFrame(warmup)') < minigameRail.indexOf('await fetch('), 'rail movement must start before waiting for the weighted result');
assert.match(minigameRail, /const prefersReducedMotion=window\.matchMedia/, 'shop rail still detects the visitor’s reduced-motion setting');
assert.match(minigameRail, /const reduceMotion=prefersReducedMotion;/, 'customer pages and admin previews respect the same reduced-motion setting');
assert.match(minigameRail, /Math\.max\(8500,Math\.min\(12000,distance\/420\*1000\)\)/, 'rail must travel through a long, progressive deceleration instead of a short jump');
assert.match(minigameRail, /track\.children\[winnerIndex\]\.replaceWith\(item\(winner,true\)\)/, 'the reel must finish on the exact server-selected weighted reward');
assert.match(minigameRail, /\[winnerIndex-1,winnerIndex\+1\]/, 'the selected item must remain visually distinct from an identical adjacent card');
assert.match(minigameRail, /cubic-bezier\(\.5,\.3,\.12,1\)/, 'the rail must ease into its selected prize without an abrupt stop');
assert.match(minigameRail, /addEventListener\(['"]transitionend['"],onTransitionEnd/, 'rail preview must finish from the real transition event');
assert.match(minigameRail, /pageshow[\s\S]{0,240}previewUnavailable[\s\S]{0,100}releaseSpin/, 'rail preview must recover a busy animation without unlocking an empty prize pool');
assert.doesNotMatch(minigameExperiment, /mgx-product-picker|mgx-live-products|LIVE STORE CATALOG/, 'the separate live catalog chooser must be removed from the minigame screen');
assert.doesNotMatch(minigameExperiment, /live-catalog/, 'minigame simulation must not choose arbitrary catalog products');
assert.match(minigameExperiment, /previewPrizes: prizes\.filter\(/, 'box preview must display the active, stocked prizes configured for this shop');
assert.match(minigameExperiment, /endpoint: '\/admin\/minigame\/preview\?mode=rail'/, 'rail preview must request its weighted result from the current shop');
assert.doesNotMatch(minigameExperiment, /catalogPreview\.select\(/, 'minigame preview must select an outcome from configured reward weights');
assert.equal((minigameExperiment.match(/class="mgx-game-tabs"/g) || []).length, 1, 'box and rail preview tabs must remain exactly once');
assert.doesNotMatch(minigameWidget, /lilteamLiveCatalogPreview\.pick\(catalog\.products\)/, 'box preview must follow the configured random weights');
assert.doesNotMatch(minigameRail, /lilteamLiveCatalogPreview\.pick\(catalog\.products\)/, 'rail preview must follow the configured random weights');
assert.match(minigameWidget, /\.mg-play-panel \{[\s\S]{0,260}display: flex[\s\S]{0,120}padding: 1\.5rem/, 'box layout must be defined in the shared partial so admin and storefront match without a Tailwind dependency');
assert.match(minigameWidget, /mg-preview-prize-list/, 'admin box preview must display its actual reward pool');
assert.match(minigameWidget, /data-preview-unavailable="true"/, 'empty box previews must stay disabled after browser-cache recovery');
assert.match(minigameRail, /rail-game--admin-preview/, 'admin rail preview must share its responsive game surface');
assert.doesNotMatch(minigameExperimentCss, /\.mgx-product-picker|\.mgx-product-grid|\.mgx-product-card/, 'removed chooser styles must not remain in the minigame stylesheet');
assert.doesNotMatch(minigameExperimentCss, /\.mgx-preview-panel \.(?:mg-stage|mg-result-el|mg-play-btn|rail-game|rail-window|rail-result)/, 'admin preview CSS must not change the customer game dimensions or motion surface');
assert.doesNotMatch(minigameExperimentCss, /\.mgx-preview-panel \.mg-play-panel\{[^}]*\b(?:padding|height|min-height|display|gap):/, 'admin preview CSS must not resize the customer box surface');
const liveCatalogFixture = buildLiveCatalogPreview({
  settings: { shopName: 'LILTeam Shop' },
  products: [
    { id: 'available-product', title: 'สินค้าพร้อมขาย', price: 125, status: 'active', images: ['https://cdn.example.test/product.webp'] },
    { id: 'sold-out-product', title: 'สินค้าหมด', price: 50, status: 'active', images: ['https://cdn.example.test/sold.webp'] },
    { id: 'inactive-product', title: 'สินค้าไม่แสดง', price: 50, status: 'inactive', images: ['https://cdn.example.test/inactive.webp'] },
    { id: 'unsafe-image-product', title: 'รูปไม่ปลอดภัย', price: 50, status: 'active', images: ['http://cdn.example.test/insecure.jpg'] },
  ],
  stockItems: [
    { productId: 'available-product', status: 'available', username: 'private-user', password: 'private-secret' },
    { productId: 'available-product', status: 'sold', username: 'sold-user', password: 'sold-secret' },
    { productId: 'sold-out-product', status: 'sold', username: 'sold-user', password: 'sold-secret' },
  ],
});
assert.deepEqual(liveCatalogFixture.products, [{
  id: 'available-product', title: 'สินค้าพร้อมขาย', price: 125,
  image: 'https://cdn.example.test/product.webp', availableStock: 1,
}], 'main admin preview must use active in-stock products and never expose stock credentials');
assert.doesNotMatch(JSON.stringify(liveCatalogFixture), /private-user|private-secret|sold-user|sold-secret/, 'live preview payload must not contain stock credentials');

assert.match(filterPanel, /window\.location\.assign\(query\?['"]\/products\?tags=/, 'filter selection must navigate to a server-filtered listing');
assert.doesNotMatch(filterPanel, /if\(cards\.length\)\{apply\(\);return\}/, 'filter selection must not remain client-only');
assert.match(productDetail, /product-action-secondary/, 'purchase action must use a theme-independent readable class');
assert.match(productDetail, /product-topup-action/, 'top-up action must use a theme-independent readable class');
assert.match(shopRoutes, /productRangers/, 'product details must resolve assigned Rangers');
assert.match(productDetail, /product-ranger-title/, 'product details must show assigned Rangers');
assert.match(rangerMarketJs, /selectedCodes\.some\(code/, 'selected Ranger filters must show only matching products');
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
