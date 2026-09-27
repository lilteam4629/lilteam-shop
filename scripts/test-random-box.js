const assert = require('assert');
const randomBox = require('../src/services/random-box');
const catalog = require('../src/services/catalog-syndication');

assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: null }), true, 'main site supports random boxes');
assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: { slug: 'bank-shop' } }), true, 'bank-shop supports random boxes');
assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: { slug: 'other-shop' } }), false, 'other tenants cannot use them');
assert.strictEqual(randomBox.randomTarget((min) => min), 85);
assert.strictEqual(randomBox.randomTarget((min, max) => max - 1), 110);
assert.strictEqual(randomBox.randomTarget((min) => min, 2), 45);
assert.strictEqual(randomBox.randomTarget((min, max) => max - 1, 2), 60);
assert.strictEqual(randomBox.getRateConfig(3).minTarget, 30, 'custom rates calculate their lower round bound');
assert.strictEqual(randomBox.getRateConfig(3).maxTarget, 40, 'custom rates calculate their upper round bound');
assert.strictEqual(randomBox.parseRate({}), 1, 'rate one is the default');
assert.strictEqual(randomBox.parseRate({ randomBoxRate: '2' }), 2, 'the admin can select rate two');
assert.strictEqual(randomBox.parseRate({ randomBoxRate: '3.25' }), 3.25, 'the admin can enter any rate with up to two decimals');
assert.strictEqual(randomBox.validateRate('0.01'), null);
assert.strictEqual(randomBox.validateRate('100'), null);
assert.strictEqual(randomBox.getRateConfig(100).minTarget, 1, 'a 100% rate awards every draw');
assert.notStrictEqual(randomBox.validateRate('1.001'), null);

const validPrizes = [
  { id: 'out', name: 'รางวัลหมด', percent: 50 },
  { id: 'a', name: 'รางวัล A', percent: 25 },
  { id: 'b', name: 'รางวัล B', percent: 25 },
];
assert.strictEqual(randomBox.validatePrizeRows(validPrizes), null);
assert.strictEqual(randomBox.validatePrizeRows([{ name: 'ผิดสัดส่วน', percent: 99 }]), 'เปอร์เซ็นต์รางวัลรวมกันต้องเท่ากับ 100%');
assert.strictEqual(randomBox.validatePrizeRows([{ name: 'ทศนิยมเกิน', percent: 50.001 }, { name: 'อีกรางวัล', percent: 49.999 }]), 'เปอร์เซ็นต์ของรางวัลใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
const prizeStock = [
  { id: 'stock-a', productId: 'box-1', randomBoxPrizeId: 'a', status: 'available', username: 'a-user', password: 'a-key' },
  { id: 'stock-b', productId: 'box-1', randomBoxPrizeId: 'b', status: 'available', username: 'b-user', password: 'b-key' },
  { id: 'sold-a', productId: 'box-1', randomBoxPrizeId: 'a', status: 'sold', username: 'used', password: 'used' },
];
assert.deepStrictEqual(randomBox.availablePrizePool({ prizes: validPrizes }, prizeStock, 'box-1').map(prize => prize.publicPercent), [50, 50]);
assert.deepStrictEqual(randomBox.availablePrizePool({ prizes: validPrizes }, prizeStock, 'other-box'), [], 'stock belonging to another box never leaks into this one');

const data = {
  users: [
    { id: 'buyer-a', role: 'customer', status: 'active', walletBalance: 100 },
    { id: 'buyer-b', role: 'customer', status: 'active', walletBalance: 100 },
  ],
  products: [{
    id: 'box-1', slug: 'one-baht-box', title: 'กล่องสุ่ม', price: 999, originalPrice: 999,
    specialType: randomBox.RANDOM_BOX_KIND, status: 'active', images: ['/box.png'],
    randomBox: { rate: 1, prizes: [
      { id: 'prize-a', name: 'ไอดี A', percent: 50, active: true },
      { id: 'prize-b', name: 'ไอดี B', percent: 50, active: true },
    ] },
  }],
  stockItems: [
    { id: 'prize-a-stock-1', productId: 'box-1', randomBoxPrizeId: 'prize-a', username: 'winner-a', password: 'key-a', status: 'available' },
    { id: 'prize-b-stock-1', productId: 'box-1', randomBoxPrizeId: 'prize-b', username: 'winner-b', password: 'key-b', status: 'available' },
  ],
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
assert.strictEqual(winner.result.rate, 1);
assert.strictEqual(winner.result.missPercent, 99);
assert.strictEqual(winner.result.prizeName, 'ไอดี A');
assert.strictEqual(data.stockItems[0].status, 'sold', 'the selected key is consumed from inventory once');
assert.strictEqual(data.stockItems[0].soldOrderId, winner.orderId, 'inventory is linked to the winning order');
assert.strictEqual(data.randomBoxRounds['box-1'].progress, 0, 'new global round starts after a win');
assert.strictEqual(data.randomBoxRounds['box-1'].roundNumber, 2);
assert.strictEqual(data.users[1].walletBalance, 57, 'winning attempt still costs exactly one baht');
assert.strictEqual(data.orders.length, 85);
assert.strictEqual(data.orders.at(-1).total, 1);
assert.strictEqual(data.orders.at(-1).items[0].price, 1);
assert.strictEqual(data.orders.at(-1).status, 'completed', 'the winning order is complete after immediate automatic delivery');
assert.strictEqual(data.orders.at(-1).items[0].fulfillmentMode, 'automatic');
assert.strictEqual(data.orders.at(-1).items[0].stockItemId, 'prize-a-stock-1', 'winner receives the configured reward stock item');
assert.strictEqual(data.orders.at(-1).items.length, 1, 'the prize is fulfilled on the paid draw without a manual-contact line');

const beforeReplay = {
  balance: data.users[1].walletBalance,
  orderCount: data.orders.length,
  ledgerCount: data.walletTransactions.length,
  prizeStock: data.stockItems[0].status,
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
assert.strictEqual(data.stockItems[0].status, beforeReplay.prizeStock, 'replay does not consume another key');

data.products[0].randomBox.rate = 2;
for (let draw = 1; draw <= 45; draw += 1) {
  const result = randomBox.drawRandomBox(data, {
    productId: 'box-1', userId: draw % 2 ? 'buyer-a' : 'buyer-b', idempotencyKey: `rate-two-${draw}`,
    now: 1_800_000_100_000 + draw, randomInt: deterministicRandom, genId,
  });
  assert.strictEqual(result.result.isWin, draw === 45, `rate two draw ${draw} follows the 45–60 target`);
  if (draw === 45) {
    assert.strictEqual(result.result.rate, 2);
    assert.strictEqual(result.result.missPercent, 98);
    assert.strictEqual(result.result.roundTarget, 45);
  }
}
assert.strictEqual(data.randomBoxRounds['box-1'].rate, 2, 'rate change starts a fresh round at the selected rate');

const mainCatalog = {
  products: [{ id: 'box', slug: 'box', title: 'box', price: 1, status: 'active', specialType: 'random-box' }],
  stockItems: [],
  settings: {},
};
assert.strictEqual(catalog.getTenantProducts(mainCatalog, { settings: { catalogApi: { enabled: true } } }).products.length, 0, 'random boxes are never federated');

const noBalanceData = {
  users: [{ id: 'broke', status: 'active', walletBalance: 0 }],
  products: [{ id: 'box', title: 'box', status: 'active', specialType: 'random-box', randomBox: { prizes: [{ id: 'p', name: 'รางวัล', percent: 100 }] } }],
  stockItems: [{ id: 'available-prize', productId: 'box', randomBoxPrizeId: 'p', username: 'user', password: 'key', status: 'available' }],
  walletTransactions: [], orders: [], randomBoxRounds: {},
};
assert.throws(() => randomBox.drawRandomBox(noBalanceData, {
  productId: 'box', userId: 'broke', idempotencyKey: 'insufficient-balance-request', randomInt: deterministicRandom, genId,
}), error => error.code === 'INSUFFICIENT_BALANCE');
assert.deepStrictEqual(noBalanceData.randomBoxRounds, {}, 'failed payment must not start or advance a round');
assert.strictEqual(noBalanceData.orders.length, 0, 'failed payment must not create an order');

noBalanceData.users[0].walletBalance = 1;
noBalanceData.stockItems[0].status = 'sold';
assert.throws(() => randomBox.drawRandomBox(noBalanceData, {
  productId: 'box', userId: 'broke', idempotencyKey: 'no-prizes-request', randomInt: deterministicRandom, genId,
}), error => error.code === 'NO_PRIZES');
assert.strictEqual(noBalanceData.users[0].walletBalance, 1, 'a draw with no available prize must not charge the buyer');

console.log('Random box checks passed: shop scope, rate 1 and 2 pooled targets, ฿1 debit, prize stock, one-time replay, partner exclusion');
