const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

(async () => {
  const product = { id: 'fixture', slug: 'fixture', title: 'Fixture product', price: 30,
    images: ['/fixture.png'], genres: [], filterTagIds: [], description: 'Fixture',
    stockCount: 0, flashSaleActive: false, flashSaleUpcoming: false };
  const variants = [
    ['product-card', { ownerHomeProductCard: true }],
    ['product-card', { settings: { productCardStyle: 'natural' } }],
    ['product-card', { settings: { productCardStyle: 'classic' } }],
    ['product-card-v4', {}], ['product-card-v5', {}], ['product-card-v6', {}],
  ];
  for (const [template, options] of variants) {
    for (const stockCount of [0, 3]) {
      const html = await ejs.renderFile(path.join(__dirname, '../src/views/partials', `${template}.ejs`), {
        p: { ...product, stockCount }, settings: { productCardStyle: 'natural' }, isMainSite: true, ...options,
      });
      assert.match(html, /product-stock-media/);
      assert.equal((html.match(/class="product-sold-overlay"/g) || []).length, stockCount ? 0 : 1, template);
      if (!stockCount) assert.match(html, /สินค้าหมด/);
      assert.match(html, /href="\/game\/fixture"/);
    }
  }
  const box = await ejs.renderFile(path.join(__dirname, '../src/views/partials/product-sold-overlay.ejs'), {
    p: { ...product, specialType: 'random-box' }, soldOut: true,
  });
  assert.match(box, /รางวัลหมด/);
  console.log('PASS sold/available states: owner, natural, classic, v4/v5/v6; details remain accessible; random prize label');
})().catch(error => { console.error(error); process.exitCode = 1; });
