const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root=path.resolve(__dirname,'..');
const layout=fs.readFileSync(path.join(root,'src/views/layouts/main.ejs'),'utf8');
for(const css of ['random-box-prize-stock-v1','product-gallery-v1','storefront-logo-contrast-v1']) {
 const link=layout.match(new RegExp('<link[^>]*'+css+'\\.css[^>]*>'))?.[0];
 assert.ok(link?.includes('data-route-stylesheet'),css+' must survive soft navigation from older releases');
}
const template=fs.readFileSync(path.join(root,'src/views/partials/random-box-prize-stock.ejs'),'utf8');
for(const count of [0,73,12345]) {
 const html=ejs.render(template,{p:{remainingPrizeCount:count}});
 assert.match(html,/<svg[^>]*width="23"[^>]*height="23"/,'SVG must remain bounded without external CSS');
 assert.match(html,/max-width:23px/,'intrinsic icon size cannot stretch with card');
 assert.ok(html.includes('data-prize-remaining="'+count+'"'));
 assert.ok(!html.includes('NaN'));
}
console.log('Prize stock CSS lifecycle and no-CSS icon bounds passed (empty/available/large counts).');
