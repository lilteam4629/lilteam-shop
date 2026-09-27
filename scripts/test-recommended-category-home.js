const assert = require('assert');
const {
  filterHomeProductsByRecommendedCategory,
  getEnabledRecommendedProductIds,
  shouldGroupRecommendedProductsOnHome,
} = require('../src/services/recommended-category-home');

const products = [
  { id: 'featured' },
  { id: 7 },
  { id: 'regular' },
  { id: 'disabled-only' },
];
const categories = [
  { enabled: true, productIds: ['featured', '7', 'featured'] },
  { productIds: [7] },
  { enabled: false, productIds: ['disabled-only'] },
];
const mainRequest = { tenantShop: undefined };
const bankShopRequest = { tenantShop: { slug: 'bank-shop' } };
const unrelatedTenantRequest = { tenantShop: { slug: 'another-shop' } };

assert.equal(shouldGroupRecommendedProductsOnHome(mainRequest), true);
assert.equal(shouldGroupRecommendedProductsOnHome(bankShopRequest), true);
assert.equal(shouldGroupRecommendedProductsOnHome(unrelatedTenantRequest), false);
assert.deepEqual([...getEnabledRecommendedProductIds(categories)].sort(), ['7', 'featured']);
assert.deepEqual(
  filterHomeProductsByRecommendedCategory(products, categories, mainRequest).map(product => product.id),
  ['regular', 'disabled-only'],
);
assert.deepEqual(
  filterHomeProductsByRecommendedCategory(products, categories, bankShopRequest).map(product => product.id),
  ['regular', 'disabled-only'],
);
assert.strictEqual(filterHomeProductsByRecommendedCategory(products, categories, unrelatedTenantRequest), products);
assert.strictEqual(filterHomeProductsByRecommendedCategory(products, categories, null), products);

console.log('Recommended category homepage visibility checks passed: main site, bank-shop only, enabled categories, canonical IDs');
