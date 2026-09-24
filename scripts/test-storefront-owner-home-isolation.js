const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const route = read('src/routes/shop.js');
const layout = read('src/views/layouts/main.ejs');
const home = read('src/views/shop/home.ejs');
const productCard = read('src/views/partials/product-card.ejs');
const css = read('public/css/storefront-owner-home-v7.css');
const redesignCss = read('public/css/storefront-owner-home-v14.css');
const gameWorldCss = read('public/css/storefront-owner-home-v15.css');
const cinematicCss = read('public/css/storefront-owner-home-v20.css');

assert.match(route, /viewData\.storefrontOwnerHomeV7\s*=\s*!req\.tenantShop/,
  'the redesign must be enabled for the main store only');
assert.match(layout, /if \(typeof isMainSite !== 'undefined' && isMainSite\)[\s\S]*?storefront-owner-home-v7\.css/,
  'the owner stylesheet must be available for seamless navigation on the main site');
assert.doesNotMatch(layout, /storefront-owner-home-v(?:8|9|10|11|14|15)\.css/,
  'superseded main-home design layers must no longer be loaded');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[\s\S]*?storefront-owner-home-v20\.css/,
  'the new media-storefront stylesheet must only load on the owner storefront');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[\s\S]*?storefront-owner-home-v21\.css/,
  'the new readable product-card layer must only load on the owner storefront');
assert.doesNotMatch(layout, /storefront-owner-home-v18\.css/,
  'the superseded split hero styling must no longer load');
assert.doesNotMatch(layout, /storefront-owner-home-v16\.(?:css|js)/,
  'the replaced 3D scene stylesheet and script must no longer load');
assert.doesNotMatch(layout, /storefront-owner-home-v13\.css/,
  'the rejected oversized banner treatment must no longer load');
assert.match(home, /if \(ownerHomeV20\) \{[\s\S]*?<div class="owner-home-v20-shell" data-owner-home-layout="media-storefront">[\s\S]*?<aside class="owner-home-v20-sidebar"[\s\S]*?<div class="owner-home-v20-main">/,
  'the new sidebar/content layout must be wrapped only for the main store');
assert.match(home, /if \(ownerHomeV20\) \{ %><\/div><\/div><% \}/,
  'the main-store sidebar and content wrapper must close before shared lower page modules');
assert.match(home, /ownerHomeV20\) \{ %>[\s\S]*?ownerHomeBanner = settings\.hero && settings\.hero\.mode === 'banner' \? settings\.hero\.bannerImage : null/,
  'the new banner-first hero must use the configured real shop banner');
assert.match(home, /class="owner-home-v20-artwork"[\s\S]*?<a href="<%= settings\.hero\.bannerLink %>" aria-label=[\s\S]*?<img src="<%= ownerHomeBanner %>" alt="" fetchpriority="high"/,
  'the uploaded banner must remain visible and load with high priority');
assert.match(home, /recommendedCategories\.slice\(0, 6\)\.forEach\(category => \{[\s\S]*?\/products\?recommended=<%= encodeURIComponent\(category\.id\) %>/,
  'the sidebar must only link to real shop categories');
assert.match(home, /id="latest-orders"[\s\S]*?latestOrders\.forEach\(order => \{/,
  'the sidebar latest-orders destination must use the real order rail');
assert.match(home, /newest\.slice\(0, 6\)\.forEach\(\(product, index\) => \{/,
  'the new horizontal shelf must render actual newest products, not reference/demo items');
assert.equal((home.match(/ownerHomeProductCard: ownerHomeV20/g) || []).length, 2,
  'both main-store product grids must opt in to the new product-card design without affecting tenants');
assert.match(productCard, /if \(useOwnerHomeShowcase\) \{ %>[\s\S]*?owner-home-v21-product-card[\s\S]*?owner-home-v21-name[\s\S]*?owner-home-v21-price-values[\s\S]*?owner-home-v21-stock-row/,
  'the homepage card must show a distinct title, price, and live inventory count');
assert.match(productCard, /owner-home-v21-media[\s\S]*?width="960" height="540"/,
  'the new card must reserve image space and preserve the full product image');
assert.doesNotMatch(home, /owner-home-v17-hero-shell|owner-home-v17-visual|owner-home-v17-banner-frame/,
  'the former split-text and framed-screen hero must be removed from the active homepage template');
assert.doesNotMatch(home, /owner-home-v16|data-scene-motion-toggle|anime/i,
  'the retired 3D scene and unrelated reference media must not remain in the live homepage template');
assert.doesNotMatch(home, /storefront-banner-index/,
  'the rejected side rail must not render around the main-store banner');
assert.match(layout, /id="site-page-shell"[^\n]*storefrontOwnerHomeV7/,
  'the homepage scope must travel with the replaceable page shell');
assert.match(home, /duplicate < \(typeof isMainSite !== 'undefined' && isMainSite \? 1 : 2\)/,
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
assert.match(cinematicCss, /\.owner-home-v20-shell\s*\{[\s\S]*?grid-template-columns:\s*220px minmax\(0, 1fr\)/,
  'the homepage must use a persistent sidebar beside its content');
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
assert.match(productCardCss, /\.owner-home-v21-media\s*>\s*img\s*\{[^}]*object-fit:\s*contain/s,
  'product images must remain fully visible without cropping');
assert.match(productCardCss, /\.owner-home-v21-price-values\s*>\s*strong\s*\{[^}]*font-size:\s*clamp\(19px/s,
  'the live price must be prominent and readable');
assert.match(productCardCss, /\.owner-home-v21-stock-row\s*>\s*strong\s*\{[^}]*font-size:\s*13px/s,
  'the live stock count must have a clear visual hierarchy');
assert.match(productCardCss, /var\(--gold\)/,
  'the new card must retain the shop accent for its primary action');
assert.doesNotMatch(productCardCss, /#(?:00ff91|10b981|34d399)\b/i,
  'the new card must not introduce unrelated green accents');
assert.ok(productCardRuleCount > 0, 'the new product-card layer must have owner-home scoped rules');

console.log(`Owner homepage isolation checks passed (${ruleCount + redesignRuleCount + gameWorldRuleCount + cinematicRuleCount + productCardRuleCount} scoped CSS rules).`);
