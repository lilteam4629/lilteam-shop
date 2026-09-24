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

assert.match(route, /viewData\.storefrontOwnerHomeV7\s*=\s*!req\.tenantShop/,
  'the redesign must be enabled for the main store only');
assert.match(layout, /if \(typeof isMainSite !== 'undefined' && isMainSite\)[\s\S]*?storefront-owner-home-v7\.css/,
  'the owner stylesheet must be available for seamless navigation on the main site');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[\s\S]*?storefront-owner-home-v14\.css/,
  'the full homepage redesign must only load on the owner homepage');
assert.doesNotMatch(layout, /storefront-owner-home-v13\.css/,
  'the rejected oversized banner treatment must no longer load');
assert.match(home, /if \(ownerHomeV14\) \{ %><div class="owner-home-v14-layout"/,
  'the new content layout must be wrapped only for the main store');
assert.match(home, /if \(ownerHomeV14\) \{ %><\/div><% \}/,
  'the main-store layout wrapper must close before the shared lower page modules');
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
assert.ok(redesignRuleCount > 0, 'the owner-only homepage redesign should contain scoped CSS rules');

console.log(`Owner homepage isolation checks passed (${ruleCount + redesignRuleCount} scoped CSS rules).`);
