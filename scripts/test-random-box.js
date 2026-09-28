const assert = require('assert');
const randomBox = require('../src/services/random-box');
const catalog = require('../src/services/catalog-syndication');

assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: null }), true, 'main site supports random boxes');
assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: { slug: 'bank-shop' } }), false, 'other shops cannot use random boxes');
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
assert.strictEqual(randomBox.normalizeMissMessage('  เสียใจด้วยครับ\r\nลองใหม่อีกครั้ง  '), 'เสียใจด้วยครับ\nลองใหม่อีกครั้ง');
assert.strictEqual(randomBox.normalizeMissMessage('x'.repeat(400)).length, randomBox.MAX_MISS_MESSAGE_LENGTH, 'miss copy is bounded');
assert.strictEqual(randomBox.MAX_RANDOM_BOX_DRAWS, 500, 'the customer may select more than 100 draws at once');
assert.strictEqual(randomBox.parseDrawCount(undefined), 1, 'a missing count keeps the single-draw default');
assert.strictEqual(randomBox.parseDrawCount('7'), 7, 'buyers can request multiple draws');
assert.strictEqual(randomBox.parseDrawCount('101'), 101, 'a batch may exceed the previous 100-draw limit');
assert.strictEqual(randomBox.parseDrawCount('500'), 500, 'the maximum batch size is accepted');
for (const invalidCount of ['', '0', '-1', '1.5', '501', '2e2']) {
  assert.throws(() => randomBox.parseDrawCount(invalidCount), error => error.code === 'INVALID_DRAW_COUNT', `invalid draw count ${invalidCount} is rejected`);
}

const prizeStock = [
  { id: 'stock-legacy', productId: 'box-1', randomBoxPrizeId: 'legacy-prize', status: 'available', username: 'legacy-user', password: 'legacy-key' },
  { id: 'stock-direct', productId: 'box-1', status: 'available', username: 'direct-key', password: '' },
  { id: 'sold-key', productId: 'box-1', status: 'sold', username: 'used', password: 'used' },
  { id: 'other-box-key', productId: 'other-box', status: 'available', username: 'other', password: 'box' },
];
assert.strictEqual(randomBox.availableStockCount(prizeStock, 'box-1'), 2, 'all available lines count as one prize each, including old categorized stock');
assert.strictEqual(randomBox.availableStockCount(prizeStock, 'other-box'), 1, 'stock counts stay scoped to their product');
assert.deepStrictEqual(randomBox.availableStockItems(prizeStock, 'other-box').map(item => item.id), ['other-box-key'], 'stock belonging to another box never leaks into this one');
const outOfOrderStock = [
  { id: 'row-3', productId: 'box-1', addedAt: '2026-09-03T00:00:00.000Z' },
  { id: 'row-2', productId: 'box-1', addedAt: '2026-09-02T00:00:00.000Z' },
  { id: 'row-1', productId: 'box-1', addedAt: '2026-09-01T00:00:00.000Z' },
  { id: 'row-2-added-later', productId: 'box-1', addedAt: '2026-09-02T00:00:00.000Z' },
];
assert.deepStrictEqual(randomBox.stockItemsOldestFirst(outOfOrderStock).map(item => item.id),
  ['row-1', 'row-2', 'row-2-added-later', 'row-3'], 'stock rows are oldest-first with stable ordering for equal timestamps');

const data = {
  users: [
    { id: 'buyer-a', role: 'customer', status: 'active', walletBalance: 100 },
    { id: 'buyer-b', role: 'customer', status: 'active', walletBalance: 100 },
  ],
  products: [{
    id: 'box-1', slug: 'one-baht-box', title: 'กล่องสุ่ม', price: 999, originalPrice: 999,
    specialType: randomBox.RANDOM_BOX_KIND, status: 'active', images: ['/box.png'],
    randomBox: { rate: 1, missMessage: 'ขอบคุณที่ร่วมสนุก', prizes: [{ id: 'legacy-prize', name: 'รางวัลเดิม', percent: 99, active: true }] },
  }],
  stockItems: [
    { id: 'legacy-stock-1', productId: 'box-1', randomBoxPrizeId: 'legacy-prize', username: 'winner-a', password: 'key-a', status: 'available' },
    { id: 'direct-stock-1', productId: 'box-1', username: 'winner-b', password: '', status: 'available' },
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
  assert.strictEqual(result.result.missMessage, 'ขอบคุณที่ร่วมสนุก', 'each miss snapshots the configured customer message');
  assert.strictEqual(result.result.missCount, 1, 'single miss summaries report their miss count');
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
assert.strictEqual(winner.result.prizeName, 'winner-b', 'a win takes the newest stock row at the bottom first');
assert.strictEqual(winner.result.missMessage, null, 'winning draws do not include the miss message');
assert.strictEqual(winner.result.missCount, 0, 'winning draw summaries count no misses');
assert.strictEqual(Object.hasOwn(winner.result, 'prizePercent'), false, 'draw results no longer depend on prize percentages');
assert.strictEqual(data.stockItems[1].status, 'sold', 'the selected key is consumed from inventory once');
assert.strictEqual(data.stockItems[1].soldOrderId, winner.orderId, 'inventory is linked to the winning order');
assert.strictEqual(data.randomBoxRounds['box-1'].progress, 0, 'new global round starts after a win');
assert.strictEqual(data.randomBoxRounds['box-1'].roundNumber, 2);
assert.strictEqual(data.users[1].walletBalance, 57, 'winning attempt still costs exactly one baht');
assert.strictEqual(data.orders.length, 85);
assert.strictEqual(data.orders.at(-1).total, 1);
assert.strictEqual(data.orders.at(-1).items[0].price, 1);
assert.strictEqual(data.orders.at(-1).status, 'completed', 'the winning order is complete after immediate automatic delivery');
assert.strictEqual(data.orders.at(-1).items[0].fulfillmentMode, 'automatic');
assert.strictEqual(data.orders.at(-1).items[0].stockItemId, 'direct-stock-1', 'the bottom stock line is delivered without requiring a prize category');
assert.strictEqual(data.orders.at(-1).items.length, 1, 'the prize is fulfilled on the paid draw without a manual-contact line');

const beforeReplay = {
  balance: data.users[1].walletBalance,
  orderCount: data.orders.length,
  ledgerCount: data.walletTransactions.length,
  prizeStock: data.stockItems[1].status,
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
assert.strictEqual(data.stockItems[1].status, beforeReplay.prizeStock, 'replay does not consume another key');

data.products[0].randomBox.rate = 2;
for (let draw = 1; draw <= 45; draw += 1) {
  const result = randomBox.drawRandomBox(data, {
    productId: 'box-1', userId: draw % 2 ? 'buyer-a' : 'buyer-b', idempotencyKey: `rate-two-${draw}`,
    now: 1_800_000_100_000 + draw, randomInt: deterministicRandom, genId,
  });
  assert.strictEqual(result.result.isWin, draw === 45, `rate two draw ${draw} follows the 45–60 target`);
  if (draw === 45) {
    assert.strictEqual(result.result.roundTarget, 45);
    assert.strictEqual(result.result.prizeName, 'winner-a:key-a', 'the next award moves upward to the prior stock row');
    assert.strictEqual(data.orders.at(-1).items[0].stockItemId, 'legacy-stock-1');
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
  products: [{ id: 'box', title: 'box', status: 'active', specialType: 'random-box', randomBox: { rate: 1 } }],
  stockItems: [{ id: 'available-prize', productId: 'box', username: 'user', password: 'key', status: 'available' }],
  walletTransactions: [], orders: [], randomBoxRounds: {},
};
assert.throws(() => randomBox.drawRandomBox(noBalanceData, {
  productId: 'box', userId: 'broke', idempotencyKey: 'insufficient-balance-request', randomInt: deterministicRandom, genId,
}), error => error.code === 'INSUFFICIENT_BALANCE');
assert.deepStrictEqual(noBalanceData.randomBoxRounds, {}, 'failed payment must not start or advance a round');
assert.strictEqual(noBalanceData.orders.length, 0, 'failed payment must not create an order');

noBalanceData.users[0].walletBalance = 1;
assert.throws(() => randomBox.drawRandomBox(noBalanceData, {
  productId: 'box', userId: 'broke', idempotencyKey: 'insufficient-batch-request', drawCount: 2,
  randomInt: deterministicRandom, genId,
}), error => error.code === 'INSUFFICIENT_BALANCE');
assert.strictEqual(noBalanceData.users[0].walletBalance, 1, 'an unaffordable batch is rejected without a partial debit');
assert.deepStrictEqual(noBalanceData.randomBoxRounds, {}, 'an unaffordable batch never advances the shared round');
assert.strictEqual(noBalanceData.orders.length, 0, 'an unaffordable batch creates no order');
noBalanceData.stockItems[0].status = 'sold';
assert.throws(() => randomBox.drawRandomBox(noBalanceData, {
  productId: 'box', userId: 'broke', idempotencyKey: 'no-prizes-request', randomInt: deterministicRandom, genId,
}), error => error.code === 'NO_PRIZES');
assert.strictEqual(noBalanceData.users[0].walletBalance, 1, 'a draw with no available prize must not charge the buyer');

const multiDrawData = {
  users: [{ id: 'multi-buyer', status: 'active', walletBalance: 20 }],
  products: [{ id: 'multi-box', slug: 'multi-box', title: 'multi box', status: 'active', specialType: randomBox.RANDOM_BOX_KIND, randomBox: { rate: 1 } }],
  stockItems: [
    { id: 'multi-prize-a', productId: 'multi-box', username: 'multi-a', status: 'available' },
    { id: 'multi-prize-b', productId: 'multi-box', username: 'multi-b', status: 'available' },
  ],
  walletTransactions: [],
  orders: [],
  randomBoxRounds: { 'multi-box': { progress: 84, target: 85, rate: 1, roundNumber: 1, totalDraws: 84, totalAwards: 0 } },
};
const multiDrawKey = 'multi-draw-request-0001';
const multiDraw = randomBox.drawRandomBox(multiDrawData, {
  productId: 'multi-box', userId: 'multi-buyer', idempotencyKey: multiDrawKey, drawCount: '3',
  now: 1_800_000_200_000, randomInt: deterministicRandom, genId,
});
const multiOrder = multiDrawData.orders[0];
assert.strictEqual(multiDraw.result.drawCount, 3, 'a batch performs the requested number of draws');
assert.strictEqual(multiDraw.result.winCount, 1, 'each draw in a batch advances the shared round in order');
assert.strictEqual(multiOrder.items.length, 3, 'each draw has its own auditable order line');
assert.strictEqual(multiOrder.items[0].randomBoxDraw.isWin, true, 'the first draw reaches the existing pooled target');
assert.strictEqual(multiOrder.items[0].stockItemId, 'multi-prize-b', 'a batch win consumes the bottom stock row first');
assert.strictEqual(multiOrder.total, 3, 'the batch order charges one baht per completed draw');
assert.strictEqual(multiDrawData.users[0].walletBalance, 17, 'the wallet is debited once for the batch total');
assert.strictEqual(multiDrawData.walletTransactions[0].amount, -3, 'the ledger records the exact batch debit');
assert.strictEqual(multiDrawData.randomBoxRounds['multi-box'].progress, 2, 'draws after a win continue the next shared round');
const multiReplay = randomBox.drawRandomBox(multiDrawData, {
  productId: 'multi-box', userId: 'multi-buyer', idempotencyKey: multiDrawKey, drawCount: '3',
  now: 1_800_000_200_001, randomInt: deterministicRandom, genId,
});
assert.strictEqual(multiReplay.replay, true, 'a replayed batch request returns the original order');
assert.strictEqual(multiDrawData.users[0].walletBalance, 17, 'a batch replay never charges twice');
assert.strictEqual(multiDrawData.orders.length, 1, 'a batch replay never creates another order');

const orderedDrawData = {
  users: [{ id: 'ordered-buyer', status: 'active', walletBalance: 3 }],
  products: [{ id: 'ordered-box', slug: 'ordered-box', title: 'ordered box', status: 'active', specialType: randomBox.RANDOM_BOX_KIND, randomBox: { rate: 100 } }],
  stockItems: [
    { id: 'newest-row', productId: 'ordered-box', username: 'newest', addedAt: '2026-09-03T00:00:00.000Z', status: 'available' },
    { id: 'oldest-row', productId: 'ordered-box', username: 'oldest', addedAt: '2026-09-01T00:00:00.000Z', status: 'available' },
    { id: 'middle-row', productId: 'ordered-box', username: 'middle', addedAt: '2026-09-02T00:00:00.000Z', status: 'available' },
  ],
  walletTransactions: [], orders: [], randomBoxRounds: {},
};
const orderedDraw = randomBox.drawRandomBox(orderedDrawData, {
  productId: 'ordered-box', userId: 'ordered-buyer', idempotencyKey: 'ordered-stock-request', drawCount: 3,
  now: 1_800_000_250_000, randomInt: deterministicRandom, genId,
});
assert.deepStrictEqual(orderedDrawData.orders[0].items.map(item => item.stockItemId),
  ['newest-row', 'middle-row', 'oldest-row'], 'consecutive wins deliver bottom-to-top through row one');
assert.strictEqual(orderedDraw.result.winCount, 3, 'the ordered stock fixture wins each draw at a 100% test rate');
const largeBatchData = {
  users: [{ id: 'large-buyer', status: 'active', walletBalance: 101 }],
  products: [{ id: 'large-box', title: 'large box', status: 'active', specialType: randomBox.RANDOM_BOX_KIND, randomBox: { rate: 0.01 } }],
  stockItems: [{ id: 'large-prize', productId: 'large-box', username: 'large-key', status: 'available' }],
  walletTransactions: [], orders: [], randomBoxRounds: {},
};
const largeBatch = randomBox.drawRandomBox(largeBatchData, {
  productId: 'large-box', userId: 'large-buyer', idempotencyKey: 'large-batch-request-0101', drawCount: 101,
  now: 1_800_000_250_000, randomInt: deterministicRandom, genId,
});
assert.strictEqual(largeBatch.result.drawCount, 101, 'a request can complete more than 100 draws');
assert.strictEqual(largeBatchData.orders[0].items.length, 101, 'every draw in a large batch remains separately recorded');
assert.strictEqual(largeBatchData.orders[0].total, 101, 'a large batch charges exactly one baht per completed draw');
assert.strictEqual(largeBatchData.users[0].walletBalance, 0, 'large batches debit only the selected total');
assert.strictEqual(largeBatchData.randomBoxRounds['large-box'].progress, 101, 'all large-batch draws advance the shared round');

const freshIntentData = {
  users: [{ id: 'repeat-buyer', status: 'active', walletBalance: 2 }],
  products: [{ id: 'repeat-box', title: 'repeat box', status: 'active', specialType: randomBox.RANDOM_BOX_KIND, randomBox: { rate: 100 } }],
  stockItems: [
    { id: 'repeat-prize-a', productId: 'repeat-box', username: 'first-key', status: 'available' },
    { id: 'repeat-prize-b', productId: 'repeat-box', username: 'second-key', status: 'available' },
  ],
  walletTransactions: [], orders: [], randomBoxRounds: {},
};
const firstIntent = randomBox.drawRandomBox(freshIntentData, {
  productId: 'repeat-box', userId: 'repeat-buyer', idempotencyKey: 'intent-request-first-0001',
  now: 1_800_000_260_000, randomInt: deterministicRandom, genId,
});
const secondIntent = randomBox.drawRandomBox(freshIntentData, {
  productId: 'repeat-box', userId: 'repeat-buyer', idempotencyKey: 'intent-request-second-0002',
  now: 1_800_000_260_001, randomInt: deterministicRandom, genId,
});
assert.notStrictEqual(secondIntent.orderId, firstIntent.orderId, 'a fresh submission key creates a new draw instead of replaying the old order');
assert.strictEqual(freshIntentData.orders.length, 2, 'separate intentional draws create separate orders');
assert.strictEqual(freshIntentData.users[0].walletBalance, 0, 'each fresh draw is charged exactly once');
const exhaustedBatchData = {
  users: [{ id: 'last-buyer', status: 'active', walletBalance: 10 }],
  products: [{ id: 'last-box', title: 'last box', status: 'active', specialType: randomBox.RANDOM_BOX_KIND, randomBox: { rate: 100 } }],
  stockItems: [{ id: 'last-prize', productId: 'last-box', username: 'last-key', status: 'available' }],
  walletTransactions: [], orders: [], randomBoxRounds: {},
};
const exhaustedBatch = randomBox.drawRandomBox(exhaustedBatchData, {
  productId: 'last-box', userId: 'last-buyer', idempotencyKey: 'last-stock-batch-0001', drawCount: 5,
  now: 1_800_000_300_000, randomInt: deterministicRandom, genId,
});
assert.strictEqual(exhaustedBatch.result.drawCount, 1, 'a batch stops when its prize inventory runs out');
assert.strictEqual(exhaustedBatch.result.stockExhausted, true, 'a partial batch reports that inventory stopped the remaining draws');
assert.strictEqual(exhaustedBatch.result.total, 1, 'only completed draws are charged when stock runs out mid-batch');
assert.strictEqual(exhaustedBatchData.users[0].walletBalance, 9, 'unperformed draws are not charged');

console.log('Random box checks passed: shop scope, rate mechanics, selectable multi-draws, pooled awards, exact debits, idempotency, inventory exhaustion, partner exclusion');
