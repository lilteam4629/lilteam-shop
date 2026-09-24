const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const route = read('src/routes/shop.js');
const layout = read('src/views/layouts/main.ejs');
const home = read('src/views/shop/home.ejs');
const css = read('public/css/storefront-owner-home-v7.css');

assert.match(route, /viewData\.storefrontOwnerHomeV7\s*=\s*!req\.tenantShop/,
  'the redesign must be enabled for the main store only');
assert.match(layout, /if \(typeof isMainSite !== 'undefined' && isMainSite\)[\s\S]*?storefront-owner-home-v7\.css/,
  'the owner stylesheet must be available for seamless navigation on the main site');
assert.match(layout, /id="site-page-shell"[^\n]*storefrontOwnerHomeV7/,
  'the homepage scope must travel with the replaceable page shell');
assert.match(home, /duplicate < \(typeof isMainSite !== 'undefined' && isMainSite \? 1 : 2\)/,
  'only the main store may change the duplicated order-carousel item count');

const stylesheet = postcss.parse(css, { from: 'storefront-owner-home-v7.css' });
let ruleCount = 0;
stylesheet.walkRules(rule => {
  ruleCount += 1;
  for (const selector of rule.selectors) {
    assert.ok(selector.trim().startsWith('#site-page-shell.storefront-owner-home-v7 '),
      `unscoped rule could affect rental shops: ${selector}`);
  }
});
assert.ok(ruleCount > 0, 'the owner-only stylesheet should contain the redesign rules');

console.log(`Owner homepage isolation checks passed (${ruleCount} scoped CSS rules).`);
