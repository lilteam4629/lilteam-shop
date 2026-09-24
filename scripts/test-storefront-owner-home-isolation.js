const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const route = read('src/routes/shop.js');
const layout = read('src/views/layouts/main.ejs');
const home = read('src/views/shop/home.ejs');
const css = read('public/css/storefront-owner-home-v7.css');
const redesignCss = read('public/css/storefront-owner-home-v14.css');
const gameWorldCss = read('public/css/storefront-owner-home-v15.css');
const cinematicCss = read('public/css/storefront-owner-home-v18.css');

assert.match(route, /viewData\.storefrontOwnerHomeV7\s*=\s*!req\.tenantShop/,
  'the redesign must be enabled for the main store only');
assert.match(layout, /if \(typeof isMainSite !== 'undefined' && isMainSite\)[\s\S]*?storefront-owner-home-v7\.css/,
  'the owner stylesheet must be available for seamless navigation on the main site');
assert.doesNotMatch(layout, /storefront-owner-home-v(?:8|9|10|11|14|15)\.css/,
  'superseded main-home design layers must no longer be loaded');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[\s\S]*?storefront-owner-home-v18\.css/,
  'the new cinema/catalog stylesheet must only load on the owner storefront');
assert.doesNotMatch(layout, /storefront-owner-home-v16\.(?:css|js)/,
  'the replaced 3D scene stylesheet and script must no longer load');
assert.doesNotMatch(layout, /storefront-owner-home-v13\.css/,
  'the rejected oversized banner treatment must no longer load');
assert.match(home, /if \(ownerHomeV18\) \{ %><div class="owner-home-v18-layout"/,
  'the new content layout must be wrapped only for the main store');
assert.match(home, /if \(ownerHomeV18\) \{ %><\/div><% \}/,
  'the main-store layout wrapper must close before the shared lower page modules');
assert.match(home, /ownerHomeV18\) \{ %>[\s\S]*?ownerHomeBanner = settings\.hero && settings\.hero\.mode === 'banner' \? settings\.hero\.bannerImage : null/,
  'the new banner-first hero must use the configured real shop banner');
assert.match(home, /class="owner-home-v18-banner-link"[\s\S]*?<img src="<%= ownerHomeBanner %>"[\s\S]*?fetchpriority="high"/,
  'the uploaded banner must remain visible and load with high priority');
assert.match(home, /newest\.slice\(0, 6\)\.forEach\(\(product, index\) => \{/,
  'the new horizontal shelf must render actual newest products, not reference/demo items');
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

const cinematicStylesheet = postcss.parse(cinematicCss, { from: 'storefront-owner-home-v18.css' });
let cinematicRuleCount = 0;
cinematicStylesheet.walkRules(rule => {
  if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
  cinematicRuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('#site-page-shell.storefront-owner-home-v7'),
      `new cinema/catalog homepage selector must be isolated from tenant shops: ${selector}`);
  }
});
assert.match(cinematicCss, /\.owner-home-v18-banner-link img\s*\{[\s\S]*?width:\s*100%[\s\S]*?height:\s*auto[\s\S]*?object-fit:\s*contain/,
  'the full-width banner must preserve its whole image without cropping');
assert.doesNotMatch(cinematicCss, /\.owner-home-v18-feature-info\s*\{[^}]*grid-template-columns/,
  'banner and copy must not return to the old side-by-side split layout');
assert.match(cinematicCss, /prefers-reduced-motion:\s*reduce/,
  'the cinematic homepage must respect reduced-motion preferences');
assert.match(cinematicCss, /var\(--gold\)/,
  'the cinematic homepage must retain the selected shop theme accent');
assert.match(cinematicCss, /body:has\(#site-page-shell\.storefront-owner-home-v7(?:\s|\))/,
  'the navigation theme must only change when the main homepage is active');
assert.ok(cinematicRuleCount > 0, 'the cinematic design must include scoped owner-only rules');

console.log(`Owner homepage isolation checks passed (${ruleCount + redesignRuleCount + gameWorldRuleCount + cinematicRuleCount} scoped CSS rules).`);
