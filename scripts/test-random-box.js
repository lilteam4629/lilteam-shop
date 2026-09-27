const assert = require('assert');
const randomBox = require('../src/services/random-box');
const catalog = require('../src/services/catalog-syndication');

assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: null }), true, 'main site supports random boxes');
assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: { slug: 'bank-shop' } }), true, 'bank-shop supports random boxes');
assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: { slug: 'other-shop' } }), false, 'other tenants cannot use them');
assert.strictEqual(randomBox.randomTarget((min) => min), 85);
assert.strictEqual(randomBox.randomTarget((min, max) => max - 1), 110);

const validPrizes = [
  { id: 'out', name: 'รางวัลหมด', percent: 50, stock: 0 },
  { id: 'a', name: 'รางวัล A', percent: 25, stock: 1 },
  { id: 'b', name: 'รางวัล B', percent: 25, stock: null },
];
assert.strictEqual(randomBox.validatePrizeRows(validPrizes), null);
assert.strictEqual(randomBox.validatePrizeRows([{ name: 'ผิดสัดส่วน', percent: 99, stock: null }]), 'เปอร์เซ็นต์รางวัลรวมกันต้องเท่ากับ 100%');
assert.strictEqual(randomBox.validatePrizeRows([{ name: 'ทศนิยมเกิน', percent: 50.001, stock: null }, { name: 'อีกรางวัล', percent: 49.999, stock: null }]), 'เปอร์เซ็นต์ของรางวัลใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
assert.deepStrictEqual(randomBox.availablePrizePool({ prizes: validPrizes }).map(prize => prize.publicPercent), [50, 50]);

const data = {
  users: [
    { id: 'buyer-a', role: 'customer', status: 'active', walletBalance: 100 },
    { id: 'buyer-b', role: 'customer', status: 'active', walletBalance: 100 },
  ],
  products: [{
    id: 'box-1', slug: 'one-baht-box', title: 'กล่องสุ่ม', price: 999, originalPrice: 999,
    specialType: randomBox.RANDOM_BOX_KIND, status: 'active', images: ['/box.png'],
    randomBox: { prizes: [
      { id: 'prize-a', name: 'ไอดี A', percent: 50, stock: 1, active: true },
      { id: 'prize-b', name: 'ไอดี B', percent: 50, stock: null, active: true },
    ] },
  }],
  walletTransactions: [],
  orders: [],
  randomBoxRounds: {},
};
let generatedId = 0;
const genId = length => String(++generatedId).padStart(length, '0').slice(-length);
const deterministicRandom = (min) => min;

for (let draw = 1; draw <= 84; draw += 1) {
  const buyerId = draw % 2 ? 'buyer-a' : 'buyer-b';
  const result = randomBox.drawRandomBox(data, {
    productId: 'box-1', userId: buyerId, idempotencyKey: `draw-request-${String(draw).padStart(4, '0')}`,
    now: 1_800_000_000_000, randomInt: deterministicRandom, genId,
  });
  assert.strictEqual(result.result.isWin, false, `draw ${draw} must not win before the global target`);
}
assert.strictEqual(data.randomBoxRounds['box-1'].progress, 84, 'round count is global across buyers');
assert.strictEqual(data.users[0].walletBalance, 58, 'first buyer pays for their own 42 attempts');
assert.strictEqual(data.users[1].walletBalance, 58, 'second buyer pays for their own 42 attempts');

const winKey = 'draw-request-0085';
const winner = randomBox.drawRandomBox(data, {
  productId: 'box-1', userId: 'buyer-b', idempotencyKey: winKey,
  now: 1_800_000_000_000, randomInt: deterministicRandom, genId,
});
assert.strictEqual(winner.result.isWin, true, 'the draw that reaches target wins');
assert.strictEqual(winner.result.roundProgress, 85);
assert.strictEqual(winner.result.prizeName, 'ไอดี A');
assert.strictEqual(data.products[0].randomBox.prizes[0].stock, 0, 'finite prize stock is decremented once');
assert.strictEqual(data.randomBoxRounds['box-1'].progress, 0, 'new global round starts after a win');
assert.strictEqual(data.randomBoxRounds['box-1'].roundNumber, 2);
assert.strictEqual(data.users[1].walletBalance, 57, 'winning attempt still costs exactly one baht');
assert.strictEqual(data.orders.length, 85);
assert.strictEqual(data.orders.at(-1).total, 1);
assert.strictEqual(data.orders.at(-1).items[0].price, 1);
assert.strictEqual(data.orders.at(-1).items[1].fulfillmentMode, 'contact');

const beforeReplay = {
  balance: data.users[1].walletBalance,
  orderCount: data.orders.length,
  ledgerCount: data.walletTransactions.length,
  prizeStock: data.products[0].randomBox.prizes[0].stock,
};
const replay = randomBox.drawRandomBox(data, {
  productId: 'box-1', userId: 'buyer-b', idempotencyKey: winKey,
  now: 1_800_000_000_001, randomInt: deterministicRandom, genId,
});
assert.strictEqual(replay.replay, true);
assert.strictEqual(replay.orderId, winner.orderId);
assert.strictEqual(data.users[1].walletBalance, beforeReplay.balance, 'replay does not debit twice');
assert.strictEqual(data.orders.length, beforeReplay.orderCount, 'replay does not create another order');
assert.strictEqual(data.walletTransactions.length, beforeReplay.ledgerCount, 'replay does not create another ledger entry');
assert.strictEqual(data.products[0].randomBox.prizes[0].stock, beforeReplay.prizeStock, 'replay does not consume another prize');

const mainCatalog = {
  products: [{ id: 'box', slug: 'box', title: 'box', price: 1, status: 'active', specialType: 'random-box' }],
  stockItems: [],
  settings: {},
};
assert.strictEqual(catalog.getTenantProducts(mainCatalog, { settings: { catalogApi: { enabled: true } } }).products.length, 0, 'random boxes are never federated');

const noBalanceData = {
  users: [{ id: 'broke', status: 'active', walletBalance: 0 }],
  products: [{ id: 'box', title: 'box', status: 'active', specialType: 'random-box', randomBox: { prizes: [{ id: 'p', name: 'รางวัล', percent: 100, stock: null }] } }],
  walletTransactions: [], orders: [], randomBoxRounds: {},
};
assert.throws(() => randomBox.drawRandomBox(noBalanceData, {
  productId: 'box', userId: 'broke', idempotencyKey: 'insufficient-balance-request', randomInt: deterministicRandom, genId,
}), error => error.code === 'INSUFFICIENT_BALANCE');
assert.deepStrictEqual(noBalanceData.randomBoxRounds, {}, 'failed payment must not start or advance a round');
assert.strictEqual(noBalanceData.orders.length, 0, 'failed payment must not create an order');

noBalanceData.users[0].walletBalance = 1;
noBalanceData.products[0].randomBox.prizes[0].stock = 0;
assert.throws(() => randomBox.drawRandomBox(noBalanceData, {
  productId: 'box', userId: 'broke', idempotencyKey: 'no-prizes-request', randomInt: deterministicRandom, genId,
}), error => error.code === 'NO_PRIZES');
assert.strictEqual(noBalanceData.users[0].walletBalance, 1, 'a draw with no available prize must not charge the buyer');

console.log('Random box checks passed: shop scope, pooled 85–110 target, ฿1 debit, prize stock, one-time replay, partner exclusion');
