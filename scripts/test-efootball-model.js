const assert = require('assert');
const fs = require('fs');
const catalog = require('../src/services/efootball-catalog');

const status = catalog.status();
assert.strictEqual(status.source, 'eFHUB');
assert.ok(status.count >= 10, 'eFootball source should contain a useful player set');
const forwards = catalog.queryCatalog({ position: 'CF' });
assert.ok(forwards.items.length > 0 && forwards.items.every(item => item.position === 'CF'));
assert.ok(catalog.queryCatalog({ minRating: 89 }).items.every(item => item.rating >= 89));
assert.ok(catalog.queryCatalog({ search: 'best' }).items.some(item => item.name === 'George Best'));
for (const item of catalog.queryCatalog().items) {
  assert.match(item.imageUrl, /^https:\/\/efimg\.com\/efootballhub22\/images\/player_cards\//);
  assert.ok(item.name && item.position && Number.isInteger(item.rating));
}
const adminRoute = fs.readFileSync('src/routes/admin.js', 'utf8');
assert.match(adminRoute, /filter-tags\/efootball\/import/);
assert.match(adminRoute, /efootball-\$\{player\.id\}/);
assert.match(adminRoute, /source: 'eFHUB'/);
const modelAdmin = fs.readFileSync('src/views/admin/storefront-models.ejs', 'utf8');
assert.ok(!modelAdmin.includes('value="efootball"'), 'eFootball must stay out of storefront model selection');
const shopRoute = fs.readFileSync('src/routes/shop.js', 'utf8');
assert.ok(!shopRoute.includes('home-efootball'), 'eFootball must not replace the existing storefront');
console.log('eFootball filter checks passed: eFHUB player cards, deterministic tags, and classic filter import');
