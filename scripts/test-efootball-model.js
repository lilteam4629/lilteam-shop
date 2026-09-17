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
const template = fs.readFileSync('src/views/shop/home-efootball.ejs', 'utf8');
assert.match(template, /data-ef-player/);
assert.match(template, /https:\/\/efhub\.com\/th/);
const shopRoute = fs.readFileSync('src/routes/shop.js', 'utf8');
assert.match(shopRoute, /shop\/home-efootball/);
console.log('eFootball model checks passed: isolated template, eFHUB player cards, filters, and route');
