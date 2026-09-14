const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const catalog = require('../src/services/rangers-catalog');

assert.equal(catalog.sourceCount, 2577, 'full Rangers source count changed unexpectedly');
const top = catalog.queryCatalog({ view: 'top100', limit: 100 });
assert.equal(top.total, 100);
assert.equal(top.items.length, 100);
assert.equal(top.items[0].rank, 1);
assert.equal(top.items[99].rank, 100);
const search = catalog.queryCatalog({ q: 'Wild Ginseng Brown' });
assert(search.items.some(item => item.code === 'u1535e-brown'));
assert(catalog.validCodes(['u1535e-brown', 'invalid', 'u1535e-brown']).length === 1);
assert(catalog.resolveCodes(['u1535e-brown'])[0].imageUrl.includes('/u1535e-brown/u1535e-brown-thum.png'));
assert.equal(catalog.queryCatalog({ codes: 'u1364e-cony', limit: 100 }).items.filter(item => item.code === 'u1364e-cony').length, 1, 'single-code catalog links must resolve');

for (const file of ['src/views/admin/rangers-catalog.ejs', 'src/views/shop/home-rangers-market.ejs']) {
  ejs.compile(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { filename: file });
}
const adminRoutes = fs.readFileSync(path.join(__dirname, '..', 'src/routes/admin.js'), 'utf8');
const shopRoutes = fs.readFileSync(path.join(__dirname, '..', 'src/routes/shop.js'), 'utf8');
assert(adminRoutes.includes("router.get('/rangers-catalog/source', requireSystemLab"));
assert(adminRoutes.includes("router.post('/rangers-catalog/assign', requireSystemLab"));
assert(adminRoutes.includes("router.post('/rangers-catalog/refresh', requireSystemLab"));
assert(shopRoutes.includes("if (!req.tenantShop?.isSystemLab || !store.data.settings.rangersCatalog?.enabled)"));
const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/rangers-catalog.js'), 'utf8');
const adminTemplate = fs.readFileSync(path.join(__dirname, '..', 'src/views/admin/rangers-catalog.ejs'), 'utf8');
const marketTemplate = fs.readFileSync(path.join(__dirname, '..', 'src/views/shop/home-rangers-market.ejs'), 'utf8');
assert(serviceSource.includes("getJson('/api/v2/equipments')"));
assert(serviceSource.includes("timeZone: 'Asia/Bangkok'"));
assert(serviceSource.includes('scheduleRefresh()'));
assert(adminTemplate.includes('data-view="gear"') && !adminTemplate.includes('data-view="WEAPON"') && !adminTemplate.includes('data-view="ARMOR"') && !adminTemplate.includes('data-view="ACC"'));
assert(marketTemplate.includes('id="rm-match-mode"') && marketTemplate.includes('data-rm-rangers-nav="next"'), 'market selection must expose match mode and image navigation');
assert(!adminTemplate.includes('data-view="new"') && !adminTemplate.includes('มาใหม่'));
assert(adminTemplate.includes("grid.addEventListener('pointermove'"));
console.log('Rangers catalog checks passed: live refresh, Top 100 ranks, new items, gear filters, pointer drag, assignments, templates, tenant guards');
