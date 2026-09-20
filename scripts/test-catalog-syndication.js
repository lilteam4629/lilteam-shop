const assert = require('assert');
const catalog = require('../src/services/catalog-syndication');

const main = {
  settings: { shopName: 'ร้านหลัก' },
  products: [
    { id: 'p1', slug: 'item-1', title: 'สินค้า 1', price: 100, status: 'active', images: ['https://img.test/1.png'], internalNote: 'secret' },
    { id: 'p2', slug: 'item-2', title: 'สินค้า 2 หมดแล้ว', price: 200, status: 'active', images: ['https://img.test/2.png'], internalNote: 'secret-2' },
  ],
  stockItems: [{ id: 'stock-secret', productId: 'p1', status: 'available', username: 'private', password: 'private' }],
};
const tenant = { settings: { catalogApi: { enabled: true, markupMode: 'percent', markupValue: 10 } } };
const result = catalog.getTenantProducts(main, tenant, 'https://main.test', { id: 'tenant-1', slug: 'tenant' });
assert.strictEqual(result.products.length, 1);
assert.strictEqual(result.products[0].price, 110);
assert.ok(!result.products.some(product => product.sourceProductId === 'p2'), 'sold-out Partner products must stay hidden');
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
const ledger = catalog.calculatePayoutLedger({
  transactions: [
    { type: 'manual-payout', tenantRevenueByTenant: { 'tenant-1': 100, 'tenant-2': 50 } },
    { type: 'payout', tenantShopId: 'tenant-1', amount: 999 },
  ],
  payouts: [{ tenantShopId: 'tenant-1', amount: 40 }],
});
assert.strictEqual(ledger.accrued['tenant-1'], 100, 'sales margin should accrue once');
assert.strictEqual(ledger.pending['tenant-1'], 60, 'pending balance must subtract completed payouts');
assert.strictEqual(ledger.pending['tenant-2'], 50, 'unpaid partner margin should remain payable');
const longLedger = catalog.calculatePayoutLedger({ transactions: Array.from({ length: 120 }, () => ({ tenantRevenueByTenant: { 'tenant-long': 1 } })) });
assert.strictEqual(longLedger.pending['tenant-long'], 120, 'older sales must remain in the payable ledger');
console.log('Catalog syndication checks passed: safe metadata, markup, signed checkout token, disabled feed');
