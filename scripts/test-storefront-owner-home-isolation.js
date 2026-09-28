const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const route = read('src/routes/shop.js');
const layout = read('src/views/layouts/main.ejs');
const home = read('src/views/shop/home.ejs');
const listing = read('src/views/shop/listing.ejs');
const productCard = read('src/views/partials/product-card.ejs');
const ownerBaseCss = read('public/css/storefront-owner-home-v1.css');
const css = read('public/css/storefront-owner-home-v7.css');
const redesignCss = read('public/css/storefront-owner-home-v14.css');
const gameWorldCss = read('public/css/storefront-owner-home-v15.css');
const cinematicCss = read('public/css/storefront-owner-home-v20.css');
const cozyCss = read('public/css/storefront-home-cozy-v1.css');
const cozyHeroCss = read('public/css/storefront-home-hero-cozy-v1.css');
const ownerHeroFxCss = read('public/css/storefront-owner-home-hero-v23.css');
const ownerHeroLayoutCss = read('public/css/storefront-owner-home-hero-v22.css');
const heroCozyCss = read('public/css/storefront-home-hero-cozy-v1.css');
const musicWidgetCss = read('public/css/storefront-music-unified-v1.css');
const accountMenuCss = read('public/css/storefront-account-menu-cozy-v1.css');
const productArtworkCss = read('public/css/storefront-product-artwork-full-v1.css');
const homeSectionSpacingCss = read('public/css/storefront-home-section-spacing-v1.css');
const latestOrdersCss = read('public/css/latest-orders-3d-v1.css');
const latestOrdersJs = read('public/js/latest-orders-3d-v1.js');

assert.match(route, /viewData\.storefrontOwnerHomeV7\s*=\s*true/,
  'the updated home should be served to both the primary store and tenant stores');
assert.match(route, /viewData\.welcomePopupRedesign\s*=\s*true/,
  'tenant welcome popups must use the accessible shared design');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[\s\S]*?storefront-owner-home-v7\.css/,
  'the shared home stylesheet must be available when the refreshed home is active');
assert.doesNotMatch(layout, /storefront-owner-home-v(?:8|9|10|11|14|15)\.css/,
  'superseded main-home design layers must no longer be loaded');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[\s\S]*?storefront-owner-home-v20\.css/,
  'the media-storefront stylesheet must load only on refreshed home pages');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[\s\S]*?storefront-owner-home-v21\.css/,
  'the readable product-card layer must load only on refreshed home pages');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[^\n]*storefront-owner-home-hero-v23\.css[^\n]*rev=5/,
  'the banner-only hero stylesheet must be cache-busted for all refreshed shops');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[\s\S]*?storefront-home-cozy-v1\.css/,
  'the cozy homepage layer must load for all refreshed stores');
const homeSectionSpacingLink = layout.split(/\r?\n/).find(line => line.includes('storefront-home-section-spacing-v1.css')) || '';
assert.ok(homeSectionSpacingLink && !homeSectionSpacingLink.includes('<% if'),
  'homepage announcement spacing must load for every customer storefront');
assert.match(homeSectionSpacingCss, /#site-page-shell \.store-announcements \+ #latest-orders\.latest-orders-section\s*\{\s*margin-top:\s*24px\s*!important/s,
  'homepage announcements must have a clear 24px gap before recent orders on desktop');
assert.match(homeSectionSpacingCss, /@media\s*\(max-width:\s*640px\)[\s\S]*?#site-page-shell \.store-announcements \+ #latest-orders\.latest-orders-section\s*\{\s*margin-top:\s*20px\s*!important/s,
  'homepage announcements must have a clear 20px gap before recent orders on mobile');
const musicWidgetLink = layout.split(/\r?\n/).find(line => line.includes('storefront-music-unified-v1.css')) || '';
assert.ok(!musicWidgetLink.includes('if (') && musicWidgetLink.includes('rev=2'),
  'one cache-busted music skin must load on every customer-facing shop page');
assert.doesNotMatch(layout, /storefront-music-widget-cozy-v1\.css/,
  'the homepage-only player skin must not create a second page-specific appearance');
assert.match(layout, /storefront-mobile-header-cozy-shared-v1\.css[\s\S]*?storefront-account-menu-cozy-v1\.css/,
  'the shared mobile header and account menu styles must load for every shop');
assert.match(accountMenuCss, /\.store-nav--cozy-owner \.store-nav__account-menu--main\s*\{[^}]*box-shadow:\s*0 18px 46px/s,
  'the account menu must read as a calm, elevated surface above the mobile storefront');
assert.match(accountMenuCss, /\.store-nav--cozy-owner \.store-nav__account-balance\s*\{[^}]*background:\s*color-mix/s,
  'the wallet balance must remain visually distinct and theme-aware');
assert.match(accountMenuCss, /\.store-nav--cozy-owner \.store-nav__balance-action\s*\{[^}]*min-height:\s*44px/s,
  'the top-up action must retain a mobile-sized touch target');
assert.match(musicWidgetCss, /#music-widget\s*\{[^}]*width:\s*104px;[^}]*height:\s*54px;/s,
  'the shared music widget must remain a small dock on desktop and mobile');
assert.match(musicWidgetCss, /\.music-widget__toggle[\s\S]*?\.music-widget__expand/s,
  'the shared music skin must style its play and settings controls together');
assert.doesNotMatch(read('public/css/storefront-navbar-main-v3.css'), /music-widget-main-v[12]\.css/,
  'legacy primary-store music styles must not override the shared player');
assert.doesNotMatch(layout, /storefront-owner-home-v18\.css/,
  'the superseded split hero styling must no longer load');
assert.doesNotMatch(layout, /storefront-owner-home-v16\.(?:css|js)/,
  'the replaced 3D scene stylesheet and script must no longer load');
const productArtworkLink = layout.split(/\r?\n/).find(line => line.includes('storefront-product-artwork-full-v1.css')) || '';
assert.ok(productArtworkLink && !productArtworkLink.includes('<% if'),
  'the full-product-image override must load for every storefront, including rentals');
for (const selector of ['.catalog-image > img', '.premium-product-card img', '.owner-home-v21-media > img', '.owner-home-v16-product-card img', '.v4-product-card__image img', '.new-product-card__media img', '.v6-product-card__media img']) {
  assert.ok(productArtworkCss.includes(selector), `shared product image rules must cover ${selector}`);
}
assert.match(productArtworkCss, /object-fit:\s*contain\s*!important/,
  'storefront product artwork must use the full image rather than crop to fill');
assert.match(productArtworkCss, /object-position:\s*center\s*!important/,
  'full product artwork must stay centered within its media frame');
assert.match(productArtworkCss, /transform:\s*none\s*!important/,
  'product hover effects must not zoom the image and clip its edges');
for (const selector of [
  'body.storefront-customer-refresh #site-page-shell .owner-home-v20-shell .owner-home-v21-product-card .owner-home-v21-media',
  'body.storefront-customer-refresh #site-page-shell .catalog-card .catalog-image',
  'body.storefront-customer-refresh #site-page-shell .premium-natural-card > div:first-child > div',
  'body.storefront-customer-refresh #site-page-shell .premium-product-card > div:first-child',
]) {
  assert.ok(productArtworkCss.includes(selector), `shared artwork sizing must reset the image frame for ${selector}`);
}
assert.match(productArtworkCss, /owner-home-v21-media,[\s\S]*?aspect-ratio:\s*auto\s*!important;[\s\S]*?background:\s*transparent\s*!important/,
  'rental product image frames must use the artwork dimensions without black letterbox bars');
assert.match(productArtworkCss, /owner-home-v21-media\s*>\s*img,[\s\S]*?height:\s*auto\s*!important;[\s\S]*?object-fit:\s*contain\s*!important/,
  'rental cards must show the full uploaded image at its natural aspect ratio');
assert.doesNotMatch(productArtworkCss, /aspect-ratio:\s*16\s*\/\s*9\s*!important/,
  'shared product art must not be forced into a fixed frame that adds side bars');
assert.doesNotMatch(layout, /storefront-owner-home-v13\.css/,
  'the rejected oversized banner treatment must no longer load');
assert.match(home, /if \(ownerHomeV20\) \{[\s\S]*?<div class="owner-home-v20-shell" data-owner-home-layout="cozy-marketplace">[\s\S]*?<div class="owner-home-v20-main">/,
  'the shared full-width home layout must be wrapped when its route flag is active');
assert.doesNotMatch(home, /owner-home-v20-sidebar|owner-home-v20-nav/,
  'the removed main-store sidebar must not render or remain as dead navigation');
assert.match(home, /if \(ownerHomeV20\) \{ %><\/div><\/div><% \}/,
  'the shared home content wrapper must close before lower page modules');
assert.doesNotMatch(ownerHeroFxCss, /perspective\s*\(|rotate[XYZ]\s*\(|translateZ\s*\(|filter\s*:\s*blur\s*\(/i,
  'the main hero must avoid 3D transforms and blurred compositor layers that paint as black shapes on some mobile GPUs');
assert.doesNotMatch(ownerHeroFxCss, /owner-home-v23-banner-(?:float|glint)[^}]*infinite|animation:[^;}]*owner-home-v23-banner-(?:float|glint)/i,
  'the main hero must not keep GPU-heavy banner animations running continuously');
assert.match(ownerHeroFxCss, /owner-home-v20-artwork:not\(\.owner-home-v23-spotlight\)\s*\{[^}]*transform:\s*none;[^}]*animation:\s*none;/,
  'the configured banner must keep a stable, flat rendering layer');
assert.match(ownerHeroFxCss, /owner-home-v20-artwork:not\(\.owner-home-v23-spotlight\)::before\s*\{[^}]*content:\s*none;[^}]*display:\s*none;/,
  'the blurred banner underlay that can turn into a black disk must stay removed');
assert.match(ownerHeroLayoutCss, /\.owner-home-v20-artwork img\s*\{[^}]*filter:\s*none;/,
  'the main banner image must not create a filtered GPU layer');
assert.match(home, /ownerHomeV20\) \{ %>[\s\S]*?ownerHomeBanner = settings\.hero && settings\.hero\.mode === 'banner' \? settings\.hero\.bannerImage : null/,
  'the new banner-first hero must use the configured real shop banner');
assert.match(home, /class="owner-home-v20-artwork"[\s\S]*?<a href="<%= settings\.hero\.bannerLink %>" aria-label=[\s\S]*?<img src="<%= ownerHomeBanner %>" alt="" fetchpriority="high"/,
  'the uploaded banner must remain visible and load with high priority');
assert.match(home, /owner-home-v20-hero--banner-only[\s\S]*?if \(!ownerHomeBanner\) \{ %>[\s\S]*?owner-home-v20-hero-content/,
  'a configured banner must replace the homepage text and action block');
assert.doesNotMatch(home, /owner-home-v20-hero-note/,
  'the enlarged banner must not carry a floating text badge');
assert.match(ownerHeroFxCss, /owner-home-v20-hero--banner-only[\s\S]*?width:\s*100%[\s\S]*?owner-home-v20-artwork[\s\S]*?width:\s*100%[\s\S]*?object-fit:\s*contain/s,
  'each shop banner must use the available width and preserve the full image');
assert.match(heroCozyCss, /@media \(min-width:\s*901px\)[\s\S]*?owner-home-v20-hero--banner-only[\s\S]*?max-height:\s*none !important;[\s\S]*?height:\s*auto !important;[\s\S]*?object-fit:\s*contain !important;/,
  'the desktop banner must use its full row width at the original aspect ratio');
assert.doesNotMatch(heroCozyCss, /max-height:\s*min\(52vh,\s*460px\)/,
  'the desktop banner must not be narrowed by a viewport-height cap');
assert.match(home, /recommendedCategories\.forEach\(category => \{[\s\S]*?class="home-category-card <%= fullRecommendedCategoryImages \? 'full-category-artwork' : '' %>" href="\/products\?recommended=<%= encodeURIComponent\(category\.id\) %>/,
  'real shop categories must remain available in the homepage category rail');
assert.match(home, /include\('\.\.\/partials\/latest-orders-rail', \{ latestOrders, isOwnerLatestRail: true \}\)/,
  'the main homepage order rail must use its shared live-data partial');
assert.match(read('src/views/partials/latest-orders-rail.ejs'), /latestOrders\.forEach\(order => \{/,
  'the shared order rail must render live order data');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[^\n]*latest-orders-3d-v1\.css/,
  'the order rail styling must load on every refreshed main or rental homepage');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[^\n]*latest-orders-3d-v1\.js/,
  'the order rail behavior must load on every refreshed main or rental homepage');
assert.doesNotMatch(layout, /isMainSite[^\n]*latest-orders-3d-v1\.(?:css|js)/,
  'the order rail must not depend on the main-shop identity');
assert.match(css, /\.latest-orders-track\s*\{[^}]*width:\s*max-content/s,
  'the refreshed-home stylesheet may set rail sizing but must leave carousel motion to the shared rail layer');
assert.doesNotMatch(css, /\.latest-orders-track\s*\{[^}]*animation\s*:\s*none\s*!important/s,
  'the refreshed-home stylesheet must not cancel the shared automatic order rail');
assert.doesNotMatch(css, /\.latest-orders-group\[aria-hidden="true"\]\s*\{\s*display:\s*none\s*!important/s,
  'the refreshed-home stylesheet must keep duplicated cards available for seamless looping');
assert.doesNotMatch(home, /#site-page-shell\.storefront-owner-home-v7 #latest-orders \.latest-orders-track\s*\{[^}]*animation:\s*none\s*!important/s,
  'the homepage inline stylesheet must not override the shared autoplay styles');
assert.match(latestOrdersCss, /\.latest-orders-shell\.is-visible[^}]*animation-play-state:\s*running\s*!important/s,
  'the recent-orders carousel must autoplay whenever visible');
assert.match(latestOrdersCss, /\.is-motion-reduced \.latest-orders-track\s*\{\s*animation:\s*none\s*!important/s,
  'the carousel must stop autoplay for reduced-motion preferences');
assert.match(latestOrdersCss, /\.is-user-paused \.latest-orders-track|:is\(:active, \.is-user-paused\)/,
  'the carousel must pause while customers interact with the rail');
assert.match(latestOrdersJs, /data-latest-orders-clone/,
  'the rail must create and refresh enough inert duplicate cards for continuous motion');
assert.match(latestOrdersJs, /pointerdown[\s\S]*pointerup[\s\S]*scroll/,
  'customers must be able to pause the motion and manually swipe or scroll the rail');
assert.doesNotMatch(home, /id="home-new-arrivals"|owner-home-v24-/,
  'the new-arrivals showcase must be removed from the main homepage');
assert.doesNotMatch(layout, /storefront-new-arrivals-(?:v1|mobile-v2|cozy-v2)\.css/,
  'the main homepage must not load styles for the removed new-arrivals section');
assert.equal((home.match(/ownerHomeProductCard: ownerHomeV20/g) || []).length, 2,
  'both refreshed product grids must use the same product-card design');
assert.match(productCard, /const isMainStorefrontCard = typeof isMainSite !== 'undefined' && isMainSite/,
  'the shared product card must opt in to owner-only changes without altering tenant cards');
assert.match(productCard, /if \(useOwnerHomeShowcase\) \{ %>[\s\S]*?owner-home-v21-product-card main-store-product-card[\s\S]*?owner-home-v21-summary[\s\S]*?owner-home-v21-name[\s\S]*?owner-home-v21-stock-badge[\s\S]*?owner-home-v21-purchase-row[\s\S]*?owner-home-v21-price-values[\s\S]*?owner-home-v21-buy/,
  'the homepage card must place live stock beside its title below the full image');
assert.match(productCard, /if \(!isMainStorefrontCard\) \{[\s\S]*?ready-glow/,
  'tenant cards must retain their existing image-overlay stock badge');
assert.match(productCard, /if \(isMainStorefrontCard\) \{[\s\S]*?main-store-product-title-row[\s\S]*?main-store-product-stock/,
  'main-store classic and natural cards must show live stock beside the product name');
assert.match(productCard, /owner-home-v21-media[\s\S]*?width="960" height="540"/,
  'the new card must reserve image space and preserve the full product image');
assert.match(listing, /isMainStorefrontListing[\s\S]*?main-store-product-title-row[\s\S]*?main-store-product-stock/,
  'the shared catalog page must place each product stock badge beside its title');
assert.doesNotMatch(home, /owner-home-v17-hero-shell|owner-home-v17-visual|owner-home-v17-banner-frame/,
  'the former split-text and framed-screen hero must be removed from the active homepage template');
assert.doesNotMatch(home, /owner-home-v16|data-scene-motion-toggle|anime/i,
  'the retired 3D scene and unrelated reference media must not remain in the live homepage template');
assert.doesNotMatch(home, /storefront-banner-index/,
  'the rejected side rail must not render around the main-store banner');
assert.match(layout, /id="site-page-shell"[^\n]*storefrontOwnerHomeV7/,
  'the homepage scope must travel with the replaceable page shell');
assert.match(read('src/views/partials/latest-orders-rail.ejs'), /duplicate < \(isOwnerLatestRail \? 1 : 2\)/,
  'only the main store may change the duplicated order-carousel item count');

const stylesheet = postcss.parse(css, { from: 'storefront-owner-home-v7.css' });
let ruleCount = 0;
stylesheet.walkRules(rule => {
  ruleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('#site-page-shell.storefront-owner-home-v7'),
      `unscoped rule could affect rental shops: ${selector}`);
  }
});
const shellBackground = stylesheet.nodes.find(node =>
  node.type === 'rule' && node.selector === '#site-page-shell.storefront-owner-home-v7');
assert.ok(shellBackground, 'the home shell must have an explicit opaque background to cover uploaded page art');
assert.ok(shellBackground.nodes.some(node => node.prop === 'background-color' && node.important),
  'the shell background must override the shared layout background treatment');
const uploadedBackgroundOverride = stylesheet.nodes.find(node =>
  node.type === 'rule' && node.selector === 'body.storefront-global-background #site-page-shell.storefront-owner-home-v7');
assert.ok(uploadedBackgroundOverride, 'uploaded backgrounds must not show through this homepage');
assert.ok(ruleCount > 0, 'the owner-only stylesheet should contain the redesign rules');

const redesignStylesheet = postcss.parse(redesignCss, { from: 'storefront-owner-home-v14.css' });
let redesignRuleCount = 0;
redesignStylesheet.walkRules(rule => {
  redesignRuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('#site-page-shell.storefront-owner-home-v7'),
      `unscoped redesign rule could affect rental shops: ${selector}`);
    if (!selector.includes('.owner-home-v14-layout')) {
      assert.ok(selector.includes('> .store-content-section'),
        `non-layout rule must be scoped to known main-home modules: ${selector}`);
    }
  }
});
assert.match(redesignCss, /\.banner-sparkle img\s*\{[\s\S]*?height:\s*auto\s*!important/,
  'the smaller banner must keep its intrinsic aspect ratio');
assert.match(redesignCss, /\.banner-sparkle img\s*\{[\s\S]*?object-fit:\s*contain\s*!important/,
  'the banner artwork must remain fully visible');
assert.match(redesignCss, /\.owner-home-v14-hero\s*\{[\s\S]*?grid-template-columns:\s*minmax\(265px,\s*\.76fr\)\s+minmax\(0,\s*1\.62fr\)[\s\S]*?width:\s*min\(1180px,\s*100%\)/,
  'the banner must sit in a compact split hero rather than dominate a full-width row');
assert.match(redesignCss, /\.owner-home-v14-layout\s*\{[\s\S]*?display:\s*flex/,
  'the main homepage content must receive an intentional new section order');
assert.doesNotMatch(redesignCss, /#(?:00(?:ff|cc)91|34cf91|34d399|10b981)\b/i,
  'the redesign must not hardcode green accents over the selected shop theme');
assert.match(redesignCss, /\.ready-glow\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--gold\)/,
  'available-product badges must use the selected shop accent instead of fixed green');
assert.ok(redesignRuleCount > 0, 'the owner-only homepage redesign should contain scoped CSS rules');

const gameWorldStylesheet = postcss.parse(gameWorldCss, { from: 'storefront-owner-home-v15.css' });
let gameWorldRuleCount = 0;
gameWorldStylesheet.walkRules(rule => {
  gameWorldRuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('#site-page-shell.storefront-owner-home-v7'),
      `game-world selector must include the main-store homepage scope: ${selector}`);
    const explicitlyHomepageScoped = selector.includes('.owner-home-v14-layout')
      || selector === '#site-page-shell.storefront-owner-home-v7'
      || selector.startsWith('body:has(#site-page-shell.storefront-owner-home-v7)')
      || selector.startsWith('body.storefront-global-background #site-page-shell.storefront-owner-home-v7')
      || selector.includes('> .store-content-section');
    assert.ok(explicitlyHomepageScoped,
      `game-world styles may target only the owner home, its navbar/footer, or lower home modules: ${selector}`);
  }
});
assert.match(gameWorldCss, /\.store-nav--main\s*\{[\s\S]*?background:\s*rgba\(17,\s*13,\s*22,\s*\.96\)/,
  'the owner homepage should carry the cinematic dark game-menu direction into its main navigation');
assert.match(gameWorldCss, /\.owner-home-v14-hero\s*\{[\s\S]*?grid-template-columns:\s*minmax\(250px,\s*\.68fr\)\s+minmax\(0,\s*1\.65fr\)/,
  'the dark game-inspired homepage must retain its editorial split hero');
assert.match(gameWorldCss, /\.banner-sparkle img\s*\{[\s\S]*?height:\s*auto\s*!important[\s\S]*?object-fit:\s*contain\s*!important/,
  'the main banner must stay fully visible without cropping');
assert.match(gameWorldCss, /var\(--gold\)/,
  'the atmosphere may change, but active accents must continue to use the saved shop theme');
assert.ok(gameWorldRuleCount > 0, 'the Pinterest-inspired style must contain scoped homepage rules');

const cinematicStylesheet = postcss.parse(cinematicCss, { from: 'storefront-owner-home-v20.css' });
let cinematicRuleCount = 0;
cinematicStylesheet.walkRules(rule => {
  if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
  cinematicRuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('#site-page-shell.storefront-owner-home-v7'),
      `new cinema/catalog homepage selector must be isolated from tenant shops: ${selector}`);
  }
});
assert.match(cinematicCss, /\.owner-home-v20-artwork img\s*\{[\s\S]*?object-fit:\s*contain[\s\S]*?object-position:\s*center/,
  'the banner must preserve its whole image without cropping');
assert.match(cinematicCss, /\.owner-home-v20-shell\s*\{[\s\S]*?width:\s*min\(1580px, 100%\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  'the homepage content must use the available width without a sidebar column');
assert.doesNotMatch(cinematicCss, /owner-home-v20-sidebar|owner-home-v20-nav/,
  'the removed sidebar must not leave unused sidebar styling in the main-store stylesheet');
assert.match(cinematicCss, /\.owner-home-v20-hero\s*\{[\s\S]*?grid-template-columns:\s*minmax\(225px, \.74fr\) minmax\(0, 1\.36fr\)/,
  'the hero must use a compact split layout with the banner visible in full');
assert.match(cinematicCss, /\.owner-home-v20-hero-content\s*\{[\s\S]*?z-index:\s*2/,
  'hero copy and actions must layer above the complete banner artwork');
assert.match(cinematicCss, /prefers-reduced-motion:\s*reduce/,
  'the cinematic homepage must respect reduced-motion preferences');
assert.match(cinematicCss, /background:\s*var\(--bg\)/,
  'the media storefront must follow the background selected in the shop theme');
assert.match(cinematicCss, /background:\s*var\(--card\)/,
  'the media storefront cards must follow the surfaces selected in the shop theme');
assert.match(cinematicCss, /color:\s*var\(--gold-text\)/,
  'the media storefront accents must follow the accent selected in the shop theme');
assert.doesNotMatch(cinematicCss, /--(?:gold|bg|card|input|border|text):\s*#[0-9a-f]{3,8}/i,
  'the owner homepage must not replace the saved shop theme with a fixed palette');
assert.match(cinematicCss, /body:has\(#site-page-shell\.storefront-owner-home-v7\s+\.owner-home-v20-shell\)/,
  'the navigation theme must only change when the main homepage is active');
assert.ok(cinematicRuleCount > 0, 'the media-storefront design must include scoped owner-only rules');

const cozyStylesheet = postcss.parse(cozyCss, { from: 'storefront-home-cozy-v1.css' });
let cozyRuleCount = 0;
cozyStylesheet.walkRules(rule => {
  cozyRuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('#site-page-shell.storefront-owner-home-v7') && selector.includes('[data-owner-home-layout="cozy-marketplace"]'),
      `cozy homepage selector must be isolated to the main-store layout: ${selector}`);
  }
});
assert.match(cozyCss, /@media \(max-width: 640px\)/, 'the cozy layout must adapt to phone widths');
assert.match(cozyCss, /prefers-reduced-motion: reduce/, 'the cozy layout must respect reduced-motion settings');
const cozyHeroStylesheet = postcss.parse(cozyHeroCss, { from: 'storefront-home-hero-cozy-v1.css' });
let desktopBannerUsesIntrinsicRatio = false;
cozyHeroStylesheet.walkAtRules('media', mediaRule => {
  if (mediaRule.params !== '(min-width: 901px)') return;
  mediaRule.walkRules(rule => {
    if (!rule.selector.includes('.owner-home-v20-hero--banner-only')) return;
    assert.ok(rule.selector.includes('#site-page-shell.storefront-owner-home-v7')
      && rule.selector.includes('[data-owner-home-layout="cozy-marketplace"]'),
    'the desktop banner sizing must remain isolated to the main storefront');
    const declarations = Object.fromEntries(rule.nodes
      .filter(node => node.type === 'decl')
      .map(node => [node.prop, node.value]));
    if (declarations['max-height'] === 'none'
      && declarations.height === 'auto'
      && declarations['object-fit'] === 'contain') {
      desktopBannerUsesIntrinsicRatio = true;
    }
  });
});
assert.ok(desktopBannerUsesIntrinsicRatio,
  'the main-store banner must fill its row while preserving its original aspect ratio');
let mobileBannerUsesIntrinsicRatio = false;
let mobileCoverHidden = false;
let phoneBannerHasCompactBottomSpacing = false;
cozyHeroStylesheet.walkAtRules('media', mediaRule => {
  if (mediaRule.params === '(max-width: 900px)') {
    let artworkFollowsImageHeight = false;
    let imageKeepsItsNaturalRatio = false;
    mediaRule.walkRules(rule => {
      const declarations = Object.fromEntries(rule.nodes
        .filter(node => node.type === 'decl')
        .map(node => [node.prop, node.value]));
      if (rule.selector.includes('.owner-home-v20-hero--banner-only')
        && declarations.display === 'none'
        && rule.nodes.some(node => node.type === 'decl' && node.prop === 'display' && node.important)
        && rule.selector.includes('#site-page-shell.storefront-owner-home-v7 #home-top.owner-home-v20-hero--banner-only')) {
        mobileCoverHidden = true;
      }
      if (declarations.height === 'auto' && declarations['aspect-ratio'] === 'auto') {
        artworkFollowsImageHeight = true;
      }
      if (rule.selector.includes('> img') && declarations.display === 'block'
        && declarations.height === 'auto' && declarations['object-fit'] === 'contain') {
        imageKeepsItsNaturalRatio = true;
      }
    });
    mobileBannerUsesIntrinsicRatio = mobileBannerUsesIntrinsicRatio || (artworkFollowsImageHeight && imageKeepsItsNaturalRatio);
  }
  if (mediaRule.params === '(max-width: 640px)') {
    mediaRule.walkRules(rule => {
      if (!rule.selector.endsWith('.owner-home-v23-hero.owner-home-v20-hero--banner')) return;
      const declarations = Object.fromEntries(rule.nodes
        .filter(node => node.type === 'decl')
        .map(node => [node.prop, node.value]));
      if (declarations.padding === '14px 0 4px') phoneBannerHasCompactBottomSpacing = true;
    });
  }
});
assert.ok(mobileCoverHidden,
  'the image-only homepage cover must be hidden on phone widths');
assert.ok(mobileBannerUsesIntrinsicRatio,
  'the mobile banner frame must follow the full, uncropped image height');
assert.ok(phoneBannerHasCompactBottomSpacing,
  'the mobile banner must not leave excess padding before the announcement');
assert.ok(cozyRuleCount > 0, 'the cozy marketplace layout should contain owner-only rules');

const productCardCss = read('public/css/storefront-owner-home-v21.css');
const productCardStylesheet = postcss.parse(productCardCss, { from: 'storefront-owner-home-v21.css' });
let productCardRuleCount = 0;
productCardStylesheet.walkRules(rule => {
  productCardRuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('#site-page-shell.storefront-owner-home-v7') && selector.includes('.owner-home-v20-shell'),
      `product-card style could affect a tenant or non-home page: ${selector}`);
  }
});
assert.match(productCardCss, /\.owner-home-v21-media\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s,
  'product artwork preview must follow the wide source image ratio');
assert.match(productCardCss, /\.owner-home-v21-media\s*>\s*img\s*\{[^}]*object-fit:\s*contain/s,
  'product artwork must remain fully visible without cropping or distortion');
assert.match(productCardCss, /\.owner-home-v21-price-values\s*>\s*strong\s*\{[^}]*font-size:\s*clamp\(20px/s,
  'the live price must be prominent and readable');
assert.match(productCardCss, /\.owner-home-v21-stock-badge\s+strong\s*\{[^}]*font-size:\s*11px/s,
  'the live inventory count must be legible in the image badge');
assert.match(productCardCss, /var\(--gold\)/,
  'the new card must retain the shop accent for its primary action');
assert.doesNotMatch(productCardCss, /#(?:00ff91|10b981|34d399)\b/i,
  'the new card must not introduce unrelated green accents');
assert.ok(productCardRuleCount > 0, 'the new product-card layer must have owner-home scoped rules');

const heroV23Css = read('public/css/storefront-owner-home-hero-v23.css');
const heroV23Stylesheet = postcss.parse(heroV23Css, { from: 'storefront-owner-home-hero-v23.css' });
let heroV23RuleCount = 0;
heroV23Stylesheet.walkRules(rule => {
  if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
  heroV23RuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('#site-page-shell.storefront-owner-home-v7'),
      `new homepage hero styling could leak to a rental storefront: ${selector}`);
  }
});
assert.match(heroV23Css, /owner-home-v23-hero:not\(\.owner-home-v20-hero--no-art\).*owner-home-v20-artwork:not\(\.owner-home-v23-spotlight\)[\s\S]*?transform:\s*none;/,
  'the configured banner must remain in the stable flat treatment');
assert.doesNotMatch(heroV23Css, /owner-home-v23-banner-float|owner-home-v23-banner-glint/,
  'the retired 3D banner animations must not remain in the hero stylesheet');
assert.ok(heroV23RuleCount > 0, 'the v23 hero layer must have owner-home scoped rules');

const mainProductCssStart = ownerBaseCss.indexOf('/* Main-store product cards:');
assert.notEqual(mainProductCssStart, -1, 'main-store product-card rules must be present');
const mainProductCss = ownerBaseCss.slice(mainProductCssStart);
const mainProductStylesheet = postcss.parse(mainProductCss, { from: 'main-store-product-cards.css' });
mainProductStylesheet.walkRules(rule => {
  for (const selector of rule.selectors) {
    assert.ok(selector.startsWith('body.storefront-unified #site-page-shell'),
      `full-image and stock-title styles must follow the shared storefront design: ${selector}`);
  }
});
assert.match(mainProductCss, /\.main-store-product-card img\s*\{[^}]*object-fit:\s*contain\s*!important/s,
  'all current and future main-store product cards must show uploaded artwork without cropping');
assert.match(mainProductCss, /\.main-store-product-card img\s*\{[^}]*height:\s*auto\s*!important[^}]*aspect-ratio:\s*auto\s*!important/s,
  'main-store product images must keep their intrinsic dimensions rather than fill a cropped frame');
assert.match(mainProductCss, /\.main-store-product-card :is\(\.catalog-image, \.owner-home-v21-media, \.owner-home-v20-poster\)\s*\{[^}]*aspect-ratio:\s*auto\s*!important[^}]*overflow:\s*visible\s*!important/s,
  'catalog, featured-card, and new-arrival media frames must not clip full product artwork');
assert.match(mainProductCss, /\.main-store-product-card :is\(\.catalog-image, \.owner-home-v21-media, \.owner-home-v20-poster\)\s*>\s*img\s*\{[^}]*height:\s*auto\s*!important[^}]*object-fit:\s*contain\s*!important/s,
  'product images inside each supported media frame must scale by width without cropping or distortion');
assert.match(mainProductCss, /\.main-store-product-stock\s*\{[^}]*var\(--gold\)/s,
  'stock badges beside product titles must use the saved storefront accent');

const sharedNavbarCss = read('public/css/storefront-navbar-shared-v1.css');
const sharedNavbarStylesheet = postcss.parse(sharedNavbarCss, { from: 'storefront-navbar-shared-v1.css' });
let sharedNavbarRuleCount = 0;
sharedNavbarStylesheet.walkRules(rule => {
  sharedNavbarRuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('.store-nav--cozy-owner'),
      `shared navigation styles must stay scoped to the redesigned store header: ${selector}`);
  }
});
assert.match(sharedNavbarCss, /grid-template-columns:\s*minmax\(170px, 1fr\) auto 38px auto/,
  'the redesigned header must keep the brand left and place navigation, search, and actions to its right');
assert.match(sharedNavbarCss, /justify-content:\s*flex-end/,
  'the navigation links must align to the right side of the header');
assert.match(sharedNavbarCss, /border-radius:\s*999px/,
  'the signup action must use the rounded treatment shown in the reference');
assert.match(sharedNavbarCss, /\.store-nav--cozy-owner \.store-nav__mobile-toggle\s*\{\s*display:\s*none !important/s,
  'the mobile hamburger must not create an extra row on desktop');
assert.match(sharedNavbarCss, /min-height:\s*60px !important/,
  'the desktop header must remain compact');
assert.match(sharedNavbarCss, /background:\s*var\(--gold\)/,
  'header action colors must follow the accent selected in the admin theme');
assert.match(sharedNavbarCss, /background:\s*var\(--card\)/,
  'header surfaces must follow the background selected in the admin theme');
assert.doesNotMatch(sharedNavbarCss, /#[0-9a-f]{3,8}/i,
  'the redesigned header must not introduce a fixed palette');
assert.ok(sharedNavbarRuleCount > 0, 'the shared header redesign must include scoped styles');
const layoutHtml = read('src/views/layouts/main.ejs');
assert.match(layoutHtml, /storefront-navbar-shared-v1\.css/,
  'the shared redesigned navigation stylesheet must be loaded for storefronts');
assert.match(read('src/views/partials/navbar.ejs'), /store-nav--cozy-owner/,
  'rental shop headers must opt into the shared navigation layout');

const mobileHeaderCss = postcss.parse(read('public/css/storefront-mobile-header-cozy-shared-v1.css'), {
  from: 'storefront-mobile-header-cozy-shared-v1.css'
});
const assertTenantMobileHeaderSpacing = (breakpoint, selector, expectedValue, property = 'gap') => {
  let found = false;
  mobileHeaderCss.walkAtRules('media', media => {
    if (media.params !== `(max-width: ${breakpoint}px)`) return;
    media.walkRules(selector, rule => {
      const declaration = rule.nodes.find(node => node.type === 'decl' && node.prop === property);
      const normalizedValue = typeof expectedValue === 'number' ? `${expectedValue}px` : expectedValue;
      if (declaration && declaration.value === normalizedValue && declaration.important) found = true;
      assert.ok(rule.selector.includes(':not(.store-nav--main)'),
        `rental mobile spacing must exclude the main store header: ${rule.selector}`);
    });
  });
  assert.ok(found,
    `rental headers must keep ${property} at ${expectedValue}${typeof expectedValue === 'number' ? 'px' : ''} through ${breakpoint}px screens`);
};
assertTenantMobileHeaderSpacing(900, '.store-nav--cozy-owner:not(.store-nav--main) .store-nav__actions', 6);
assertTenantMobileHeaderSpacing(900, '.store-nav--cozy-owner:not(.store-nav--main) .store-nav__inner', '100%', 'width');
assertTenantMobileHeaderSpacing(900, '.store-nav--cozy-owner:not(.store-nav--main) .store-nav__inner', '0', 'margin-inline');
assertTenantMobileHeaderSpacing(900, '.store-nav--cozy-owner:not(.store-nav--main) .store-nav__login', 12, 'padding-inline');
assertTenantMobileHeaderSpacing(380, '.store-nav--cozy-owner:not(.store-nav--main) .store-nav__inner', 6);
assertTenantMobileHeaderSpacing(380, '.store-nav--cozy-owner:not(.store-nav--main) .store-nav__inner', '100%', 'width');
assertTenantMobileHeaderSpacing(380, '.store-nav--cozy-owner:not(.store-nav--main) .store-nav__inner', '0', 'margin-inline');
assertTenantMobileHeaderSpacing(380, '.store-nav--cozy-owner:not(.store-nav--main) .store-nav__actions', 1);
assertTenantMobileHeaderSpacing(380, '.store-nav--cozy-owner:not(.store-nav--main) .store-nav__login', 10, 'padding-inline');

const listingHtml = read('src/views/shop/listing.ejs');
const sharedCatalogCss = read('public/css/storefront-catalog-shared-v1.css');
assert.match(listingHtml, /if \(isMainStorefrontListing\)[\s\S]*?storefront-catalog-shared-v1\.css/,
  'the redesigned catalogue stylesheet must load for all refreshed shops');
assert.match(listingHtml, /main-storefront-catalog-page/,
  'the storefront listing must expose its catalog styling scope');
const sharedCatalogStylesheet = postcss.parse(sharedCatalogCss, { from: 'storefront-catalog-shared-v1.css' });
let sharedCatalogRuleCount = 0;
sharedCatalogStylesheet.walkRules(rule => {
  if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
  sharedCatalogRuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('body.storefront-customer-refresh') && selector.includes('.main-storefront-catalog-page'),
      `shared catalog style must be scoped to updated storefronts: ${selector}`);
  }
});
assert.match(sharedCatalogCss, /\.catalog-grid\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
  'the shared catalogue must show four products per desktop row');
assert.match(sharedCatalogCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  'the shared catalogue must retain a readable two-column mobile layout');
assert.ok(sharedCatalogRuleCount > 0, 'shared catalogue styles must stay scoped to refreshed shops');

assert.match(home, /settings\.shopName \|\| 'ร้านค้า'/,
  'each tenant home must use that shop\'s own name in its refreshed hero');
assert.match(home, /settings\.hero\.bannerImage/,
  'each tenant home must read its configured banner from the active shop settings');
assert.match(productCard, /src="<%= p\.images\[0\] %>"/,
  'refreshed product cards must read image URLs from the active shop product records');
const app = read('src/app.js');
assert.match(app, /res\.locals\.storefrontCustomerRefresh\s*=\s*true/,
  'the shared storefront theme applies across rental routes without changing tenant data scope');
assert.match(app, /res\.locals\.storefrontCozyNav\s*=\s*true/,
  'the updated storefront navigation is enabled across primary and rental shops');
assert.match(app, /res\.locals\.settings\s*=\s*requestShopSettings\(store\.data\.settings, req\.tenantShop\)/,
  'layout branding continues to resolve settings inside the request-scoped shop');
assert.match(route, /const active = req\?\.tenantShop \? localProducts : localProducts\.concat\(remote\)/,
  'a rental storefront must keep rendering its own catalog records instead of the main-shop catalog');

console.log(`Shared tenant storefront checks passed (${ruleCount + redesignRuleCount + gameWorldRuleCount + cinematicRuleCount + productCardRuleCount + heroV23RuleCount + sharedNavbarRuleCount + sharedCatalogRuleCount} scoped CSS rules).`);
