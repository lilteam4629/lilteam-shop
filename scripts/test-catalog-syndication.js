const assert = require('assert');
const catalog = require('../src/services/catalog-syndication');

const main = {
  settings: { shopName: 'ร้านหลัก' },
  products: [{ id: 'p1', slug: 'item-1', title: 'สินค้า 1', price: 100, status: 'active', images: ['https://img.test/1.png'], internalNote: 'secret' }],
  stockItems: [{ id: 'stock-secret', productId: 'p1', status: 'available', username: 'private', password: 'private' }],
};
const tenant = { settings: { catalogApi: { enabled: true, markupMode: 'percent', markupValue: 10 } } };
const result = catalog.getTenantProducts(main, tenant, 'https://main.test', { id: 'tenant-1', slug: 'tenant' });
assert.strictEqual(result.products.length, 1);
assert.strictEqual(result.products[0].price, 110);
assert.ok(result.products[0].sourceUrl.includes('/federated/checkout?token='));
assert.ok(!JSON.stringify(result.products[0]).includes('private'));
const token = new URL(result.products[0].sourceUrl).searchParams.get('token');
assert.deepStrictEqual(catalog.verifyToken(token).productId, 'p1');
assert.strictEqual(catalog.applyMarkup(100, { markupMode: 'fixed', markupValue: 10 }), 110);
assert.strictEqual(catalog.getTenantProducts(main, { settings: {} }).products.length, 0);
const remoteProducts = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(id => ({ sourceProductId: id }));
const platformFeatured = catalog.normalizeConfig({ catalogApi: { featuredProductIds: ['p1', 'p2'] } });
const tenantFeatured = catalog.normalizeConfig({ catalogApi: { featuredProductIds: ['p5', 'p6'] } });
assert.deepStrictEqual(
  catalog.selectFeaturedProducts(remoteProducts, tenantFeatured, platformFeatured).map(p => p.sourceProductId),
  ['p5', 'p6'],
  'tenant selection must override the platform default',
);
assert.deepStrictEqual(
  catalog.selectFeaturedProducts(remoteProducts, catalog.normalizeConfig({}), platformFeatured).map(p => p.sourceProductId),
  ['p1', 'p2'],
  'platform selection should apply when the tenant has not configured one',
);
assert.deepStrictEqual(
  catalog.selectFeaturedProducts(remoteProducts, catalog.normalizeConfig({ catalogApi: { featuredProductIds: [] } }), platformFeatured),
  [],
  'an explicit empty tenant selection must remain empty',
);
console.log('Catalog syndication checks passed: safe metadata, markup, signed checkout token, disabled feed');
