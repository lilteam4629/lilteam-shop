const assert = require('node:assert/strict');
const box = require('../src/services/random-box');
const catalog = require('../src/services/catalog-syndication');
const make = (count = 3, balance = 1000) => ({
  products: [{ id: 'box', slug: 'box', title: 'Box', price: 1, randomBox: { rate: 1 }, specialType: 'random-box', status: 'active' }],
  users: [{ id: 'buyer', status: 'active', walletBalance: balance }],
  stockItems: Array.from({ length: count }, (_, i) => ({ id: `key-${i}`, productId: 'box', status: 'available', username: `Prize ${i}`, password: `private-${i}` })),
  orders: [], walletTransactions: [],
});
let id = 0;
const genId = () => `test-id-${++id}`;
const miss = (min, max) => max - 1;
const draw = (data, count, key, rng = miss) => box.drawRandomBox(data, { productId: 'box', userId: 'buyer',
  idempotencyKey: key, drawCount: count, randomInt: rng, genId, now: 1800000000000 });
assert.equal(box.supportsRandomBox({ tenantShop: {} }), true);
assert.equal(box.MAX_RANDOM_BOX_PRICE, 1);
assert.equal(box.RANDOM_BOX_MAX_RATE, 1);
assert.equal(box.getDrawPrice({}, { price: 999 }), 1);
for (const value of ['', 0, 2, 10, 1.5, NaN]) {
  assert.ok(box.validateRate(value)); assert.ok(box.validatePrice(value));
}
assert.equal(box.validateRate('1'), null); assert.equal(box.validatePrice('1'), null);
const shared = make();
draw(shared, 109, 'first');
assert.equal(shared.randomBoxGachaStates.box.drySpendCents, 10900);
shared.users.push({ id: 'other', status: 'active', walletBalance: 100 });
const other = box.drawRandomBox(shared, { productId: 'box', userId: 'other', idempotencyKey: 'other-user',
  drawCount: 1, randomInt: miss, genId });
assert.equal(other.result.prizeCount, 1);
assert.equal(shared.randomBoxGachaStates.box.drySpendCents, 0);
assert.equal(shared.users[1].walletBalance, 99);
assert.equal(shared.stockItems.filter(item => item.status === 'sold').length, 1);
assert.ok(!JSON.stringify(other.result).includes('private-'));
const snapshot = JSON.stringify(shared);
const retry = box.drawRandomBox(shared, { productId: 'box', userId: 'other', idempotencyKey: 'other-user',
  drawCount: 500, randomInt: () => { throw new Error('Replay must not roll'); }, genId });
assert.equal(retry.replay, true); assert.equal(retry.orderId, other.orderId);
assert.equal(JSON.stringify(shared), snapshot);
const multi = make(6);
let calls = 0;
const won = draw(multi, 50, 'multiple', (min, max) => ++calls <= 2 ? 0 : max - 1);
assert.equal(won.result.prizeCount, 2);
assert.equal(won.result.total, 50);
assert.equal(multi.users[0].walletBalance, 950);
assert.equal(multi.orders[0].items.length, 50);
assert.equal(multi.orders[0].items[0].randomBoxDraw.prizeCount, 2);
assert.ok(!JSON.stringify(multi.orders[0]).includes('private-'));
const limited = make(3, 25.25);
const cap = draw(limited, 50, 'balance');
assert.equal(cap.result.drawCount, 25); assert.equal(cap.result.total, 25);
assert.equal(cap.result.balanceLimited, true); assert.equal(limited.users[0].walletBalance, 0.25);
const insufficient = make(3, 0.99);
const noMoney = JSON.stringify(insufficient);
assert.throws(() => draw(insufficient, 1, 'insufficient'), error => error.code === 'INSUFFICIENT_BALANCE');
assert.equal(JSON.stringify(insufficient), noMoney);
const one = make(1, 10);
const depleted = draw(one, 500, 'depleted', min => min);
assert.equal(depleted.result.total, 1); assert.equal(depleted.result.drawCount, 1);
assert.equal(depleted.result.stockExhausted, true);
assert.equal(one.users[0].walletBalance, 9);
// Delete and refill must preserve accounting and the shared dry-spend counter.
const state = JSON.stringify(limited.randomBoxGachaStates.box);
assert.equal(box.deletePrizeStock(limited, limited.products[0]).deletedCount, 3);
assert.equal(JSON.stringify(limited.randomBoxGachaStates.box), state);
limited.stockItems.push({ id: 'new-key', productId: 'box', status: 'available', username: 'New Prize' });
limited.users[0].walletBalance = 2;
draw(limited, 1, 'refill', min => min);
assert.equal(limited.randomBoxGachaStates.box.totalCollectedCents, 2600);

// Main/tenant DBs remain isolated even with identical product and user IDs.
const shopA = make(), shopB = make();
draw(shopA, 110, 'shop-a');
assert.equal(shopA.randomBoxGachaStates.box.totalPrizeItems, 1);
assert.equal(shopB.walletTransactions.length, 0);
assert.equal(shopB.users[0].walletBalance, 1000);
// Preserve existing paid history, sold keys and reserved prizes at migration.
const legacy = make(3);
legacy.products[0].price = 2; legacy.products[0].randomBox.rate = 10;
legacy.stockItems[0].status = 'sold';
for (const item of legacy.stockItems.slice(1)) {
  item.status = 'reserved'; item.randomBoxReservedFor = 'box'; item.randomBoxPoolId = 'pool-old';
}
legacy.randomBoxPools = { box: { id: 'pool-old', productId: 'box', price: 2, rate: 10,
  phase: 'recovery', recoveryProgressDraws: 50, totalCollected: 102, totalPrizeItems: 1 } };
legacy.walletTransactions.push({ id: 'tx-old', type: 'random_box_draw', productId: 'box', amount: -102 });
legacy.orders.push({ id: 'order-old', createdAt: '2026-01-01T00:00:00Z', randomBoxOrder: true,
  items: [{ productId: 'box', price: 2, randomBoxDraw: { prizeItems: [{ stockItemId: 'key-0' }] } },
    ...Array.from({ length: 50 }, () => ({ productId: 'box', price: 2, randomBoxDraw: { prizeItems: [] } }))] });
const previousOrders = JSON.stringify(legacy.orders);
assert.equal(box.migrateData(legacy), true);
assert.equal(legacy.products[0].price, 1); assert.equal(legacy.products[0].randomBox.rate, 1);
assert.equal(legacy.randomBoxGachaStates.box.totalCollectedCents, 10200);
assert.equal(legacy.randomBoxGachaStates.box.totalPrizeItems, 1);
assert.equal(legacy.randomBoxGachaStates.box.drySpendCents, 10000);
assert.equal(legacy.randomBoxPools.box, undefined);
assert.equal(legacy.randomBoxMigrationBackup.box.pool.id, 'pool-old');
assert.equal(legacy.stockItems[0].status, 'sold');
assert.ok(legacy.stockItems.slice(1).every(item => item.status === 'available' && !item.randomBoxPoolId));
assert.equal(JSON.stringify(legacy.orders), previousOrders);
assert.equal(box.migrateData(legacy), false);
const migrationPity = draw(legacy, 10, 'migration');
assert.equal(migrationPity.result.prizeCount, 1);
assert.equal(migrationPity.result.total, 10);
assert.equal(legacy.randomBoxGachaStates.box.totalCollectedCents, 11200);
assert.equal(legacy.randomBoxGachaStates.box.drySpendCents, 0);
assert.equal(catalog.getTenantProducts({ products: make().products, stockItems: [], settings: {} },
  { settings: { catalogApi: { enabled: true } } }).products.length, 0);
console.log('PASS: random-box integration, one-baht/rate locks, wallet, orders, replay, shared pity, multi-drop, migration, refill, tenant isolation');
