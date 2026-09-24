const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const route = read('src/routes/shop.js');
const layout = read('src/views/layouts/main.ejs');
const home = read('src/views/shop/home.ejs');
const css = read('public/css/storefront-owner-home-v7.css');
const bannerCss = read('public/css/storefront-owner-home-v12.css');

assert.match(route, /viewData\.storefrontOwnerHomeV7\s*=\s*!req\.tenantShop/,
  'the redesign must be enabled for the main store only');
assert.match(layout, /if \(typeof isMainSite !== 'undefined' && isMainSite\)[\s\S]*?storefront-owner-home-v7\.css/,
  'the owner stylesheet must be available for seamless navigation on the main site');
assert.match(layout, /if \(typeof storefrontOwnerHomeV7 !== 'undefined' && storefrontOwnerHomeV7\)[\s\S]*?storefront-owner-home-v12\.css/,
  'the editorial banner stylesheet must only load on the owner homepage');
assert.match(home, /class="storefront-banner-index" aria-hidden="true"/,
  'the main-store banner index should stay outside the banner artwork');
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

const bannerStylesheet = postcss.parse(bannerCss, { from: 'storefront-owner-home-v12.css' });
let bannerRuleCount = 0;
bannerStylesheet.walkRules(rule => {
  bannerRuleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('#site-page-shell.storefront-owner-home-v7'),
      `unscoped banner rule could affect rental shops: ${selector}`);
  }
});
assert.match(bannerCss, /object-fit:\s*contain\s*!important/,
  'the full banner artwork must never be crop-filled');
assert.match(bannerCss, /height:\s*auto\s*!important/,
  'the banner must keep its intrinsic aspect ratio');
assert.ok(bannerRuleCount > 0, 'the owner-only editorial banner needs scoped CSS rules');

console.log(`Owner homepage isolation checks passed (${ruleCount + bannerRuleCount} scoped CSS rules).`);
