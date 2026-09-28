const assert = require('assert');
const randomBox = require('../src/services/random-box');
const catalog = require('../src/services/catalog-syndication');

assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: null }), true);
assert.strictEqual(randomBox.supportsRandomBox({ tenantShop: { slug: 'bank-shop' } }), false,
  'random boxes are restricted to the main shop');

const expectedRateBounds = new Map([
  [1, [85, 110]], [2, [45, 60]], [3, [30, 40]], [4, [22, 27]], [5, [17, 22]],
  [6, [15, 18]], [7, [13, 15]], [8, [11, 13]], [9, [10, 12]], [10, [9, 11]],
]);
for (const [rate, [minimum, maximum]] of expectedRateBounds) {
  assert.deepStrictEqual(
    [randomBox.getRateConfig(rate).minTarget, randomBox.getRateConfig(rate).maxTarget],
    [minimum, maximum],
    `rate ${rate} has a valid, decreasing draw interval`,
  );
  assert.strictEqual(randomBox.getRateConfig(rate).rate, rate);
}
assert.strictEqual(randomBox.parseRate({ randomBoxRate: '10' }), 10);
assert.strictEqual(randomBox.validateRate('1'), null);
assert.strictEqual(randomBox.validateRate('10'), null);
for (const invalidRate of ['', '0', '11', '1.5', '-2', 'NaN']) {
  assert.ok(randomBox.validateRate(invalidRate), `reject rate ${invalidRate}`);
}
assert.strictEqual(randomBox.parsePrice('1'), 1);
assert.strictEqual(randomBox.parsePrice('2'), 2);
for (const invalidPrice of ['', '0', '-1', '1.5', '100000001', 'NaN']) {
  assert.strictEqual(randomBox.parsePrice(invalidPrice), null, `reject price ${invalidPrice}`);
}
assert.strictEqual(randomBox.validatePrice('2'), null);
assert.ok(randomBox.validatePrice('0'));
assert.strictEqual(randomBox.parseDrawCount('101'), 101);
assert.throws(() => randomBox.parseDrawCount('501'), error => error.code === 'INVALID_DRAW_COUNT');
assert.strictEqual(randomBox.normalizeMissMessage('  เกลือ  '), 'เกลือ');
const awardWeightRolls = [1, 60, 61, 80, 81, 92, 93, 98, 99, 100];
assert.deepStrictEqual(awardWeightRolls.map(roll => randomBox.randomAwardCount(10, (min, maxExclusive) => {
  assert.strictEqual(min, 1);
  assert.strictEqual(maxExclusive, 101);
  return roll;
})), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
'random prize bundles include 1–5 items, with one item common and larger bundles less common');

function seededRandom(seed) {
  let state = seed >>> 0;
  return (min, maxExclusive) => {
    assert.ok(maxExclusive > min, `random range is valid (${min}, ${maxExclusive})`);
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return min + (state % (maxExclusive - min));
  };
}

function idFactory() {
  let value = 0;
  return length => String(++value).padStart(length, '0').slice(-length);
}

function makeScenario({ count, rate, price, seed = 1 }) {
  const product = {
    id: `box-${count}-${rate}-${price}`,
    slug: 'box',
    title: 'กล่องสุ่ม',
    price,
    status: 'active',
    specialType: randomBox.RANDOM_BOX_KIND,
    randomBox: { rate, missMessage: 'เกลือ' },
    images: ['/box.png'],
  };
  const stockItems = Array.from({ length: count }, (_, index) => ({
    id: `key-${count}-${rate}-${price}-${index + 1}`,
    productId: product.id,
    username: `Prize ${index + 1}`,
    password: `private-password-${index + 1}`,
    extra: '',
    fulfillmentMode: 'automatic',
    status: 'available',
  }));
  return {
    product,
    data: {
      users: [{ id: 'buyer', status: 'active', walletBalance: 5_000_000 }],
      products: [product],
      stockItems,
      walletTransactions: [],
      orders: [],
      randomBoxPools: {},
    },
    randomInt: seededRandom(seed),
    genId: idFactory(),
  };
}

function performDraw(data, product, randomInt, genId, drawCount, requestNumber, now = 1_800_000_000_000) {
  return randomBox.drawRandomBox(data, {
    productId: product.id,
    userId: 'buyer',
    idempotencyKey: `request-${String(requestNumber).padStart(4, '0')}-unique`,
    drawCount,
    now: now + requestNumber,
    randomInt,
    genId,
  });
}

function completeAllPrizes(scenario, { firstDraw = 500 } = {}) {
  const { data, product, randomInt, genId } = scenario;
  const orders = [];
  let request = 1;
  while (randomBox.availablePrizeStockCount(data, product) > 0) {
    const opened = performDraw(data, product, randomInt, genId, firstDraw, request++);
    orders.push(opened);
    assert.ok(opened.result.drawCount >= 1 && opened.result.drawCount <= firstDraw);
    assert.ok(opened.result.total > 0);
    assert.ok(opened.result.total <= firstDraw * product.price);
    if (request > 100) throw new Error('simulation did not consume all stock');
  }
  return orders;
}

function payoutEvents(data) {
  const events = [];
  let drawNumber = 0;
  let previousWin = 0;
  for (const order of data.orders) {
    for (const item of order.items) {
      drawNumber += 1;
      const draw = item.randomBoxDraw;
      if (!draw?.isWin) continue;
      events.push({ interval: drawNumber - previousWin, count: draw.prizeCount });
      previousWin = drawNumber;
    }
  }
  return events;
}

// Stock is displayed oldest-first in admin, placing the newest prize at the
// bottom. Payouts must consume that bottom row first, even if storage order
// differs from display order.
const bottomToTopScenario = makeScenario({ count: 4, rate: 1, price: 1, seed: 401 });
bottomToTopScenario.data.stockItems.forEach((stock, index) => {
  stock.addedAt = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
});
bottomToTopScenario.data.stockItems.reverse();
const adminRowOrder = randomBox.stockItemsOldestFirst(
  bottomToTopScenario.data.stockItems, bottomToTopScenario.product.id,
).map(stock => stock.id);
completeAllPrizes(bottomToTopScenario);
const payoutOrder = bottomToTopScenario.data.orders.flatMap(order => order.items.flatMap(item =>
  item.randomBoxDraw.prizeItems.map(prize => prize.stockItemId)));
assert.deepStrictEqual(payoutOrder, [...adminRowOrder].reverse(),
  'prizes are delivered from the bottom admin row to the top row');

// Every rate-1 payout event stays within 85–110 draws. The draw count is
// independent of the random 1–5 item bundle size, so large batches do not
// stretch into one long recovery period.
const controlledBatch = makeScenario({ count: 13, rate: 1, price: 1, seed: 702 });
completeAllPrizes(controlledBatch);
const controlledEvents = payoutEvents(controlledBatch.data);
assert.ok(controlledEvents.length >= 3, '13 prizes are split into multiple payout events');
assert.ok(controlledEvents.every(event => event.interval >= 85 && event.interval <= 110),
  'every prize event is within the configured 85–110 draw interval');
assert.ok(controlledEvents.every(event => event.count >= 1 && event.count <= 5),
  'each payout contains 1–5 prizes');
assert.ok(controlledEvents.some(event => event.count < 5), 'payouts are not always five prizes');
assert.strictEqual(controlledEvents.reduce((sum, event) => sum + event.count, 0), 13,
  'all 13 prizes are eventually delivered');

// Active pools created by the previous schedule used a stock-sized recovery
// target. The first draw after upgrade migrates them to one bounded interval.
const legacySchedule = makeScenario({ count: 8, rate: 1, price: 1, seed: 703 });
const migrationRandom = (min, maxExclusive) => {
  if (min === 85 && maxExclusive === 111) return 96;
  if (min === 1 && maxExclusive === 101) return 1;
  return min;
};
performDraw(legacySchedule.data, legacySchedule.product, migrationRandom, legacySchedule.genId, 1, 1);
const legacyPool = randomBox.getActivePool(legacySchedule.data, legacySchedule.product.id);
legacyPool.phase = 'recovery';
legacyPool.recoveryProgressDraws = 400;
legacyPool.recoveryTargetDraws = 1200;
legacyPool.recoveryMilestones = [{ atDraws: 800, count: 2 }, { atDraws: 1200, count: 5 }];
legacyPool.recoveryMilestoneIndex = 0;
delete legacyPool.payoutScheduleVersion;
const migratedLegacyPayout = performDraw(legacySchedule.data, legacySchedule.product, migrationRandom,
  legacySchedule.genId, 1, 2);
assert.strictEqual(migratedLegacyPayout.result.winCount, 1,
  'a pool already past the 110-draw limit pays out on the next draw after migration');
assert.strictEqual(legacyPool.recoveryMilestones.length, 1, 'only the next prize event is scheduled');
assert.strictEqual(legacyPool.recoveryMilestones[0].count, 1, 'the next bundle size is randomized from 1–5');
const migratedTarget = legacyPool.recoveryTargetDraws;
assert.strictEqual(migratedTarget - legacyPool.recoveryProgressDraws, 96,
  'the next migrated prize is scheduled within one 85–110 interval');
const migratedPayout = performDraw(legacySchedule.data, legacySchedule.product, migrationRandom,
  legacySchedule.genId, migratedTarget - legacyPool.recoveryProgressDraws, 3);
assert.strictEqual(migratedPayout.result.winCount, 1);
assert.strictEqual(legacyPool.recoveryTargetDraws - migratedTarget, 96,
  'subsequent payouts also stay within a single bounded interval');

// User's worked example: 15 prizes, rate 1, ฿1 per draw. The first event
// collects ฿100 and awards five; later events award five each after another
// bounded 85–110 draws, instead of waiting for one batch-sized recovery target.
const targetExample = makeScenario({ count: 15, rate: 1, price: 1, seed: 7 });
const fixedExampleRandom = (min, maxExclusive) => {
  if (min === 85 && maxExclusive === 111) return 100;
  if (min === 1 && maxExclusive === 101) return 100;
  return min + Math.floor((maxExclusive - min - 1) / 2);
};
const firstExampleOrder = performDraw(targetExample.data, targetExample.product, fixedExampleRandom, targetExample.genId, 100, 1);
assert.strictEqual(firstExampleOrder.result.total, 100);
assert.strictEqual(firstExampleOrder.result.winCount, 1);
assert.strictEqual(firstExampleOrder.result.prizeCount, 5);
const activeExamplePool = randomBox.getActivePool(targetExample.data, targetExample.product.id);
assert.strictEqual(activeExamplePool.initialCount, 15);
assert.strictEqual(activeExamplePool.remainingStockIds.length, 10);
assert.strictEqual(activeExamplePool.entryProgressDraws, 100);
assert.strictEqual(activeExamplePool.recoveryTargetDraws, 100);
assert.strictEqual(activeExamplePool.recoveryMilestones[0].count, 5);
assert.strictEqual(activeExamplePool.recoveryMilestones[0].atDraws, 100);
assert.ok(!('recoveryTargetDraws' in firstExampleOrder.result));
assert.ok(!JSON.stringify(firstExampleOrder.result).includes('1500'));
assert.ok(targetExample.data.orders[0].items.some(item => item.randomBoxDraw.prizeItems.some(prize => prize.productTitle.startsWith('Prize '))));
assert.ok(!JSON.stringify(firstExampleOrder.result).includes('private-password'));
assert.strictEqual(targetExample.data.users[0].walletBalance, 4_999_900);

let exampleRequest = 2;
while (randomBox.availablePrizeStockCount(targetExample.data, targetExample.product) > 0) {
  performDraw(targetExample.data, targetExample.product, fixedExampleRandom, targetExample.genId, 500, exampleRequest++);
  if (exampleRequest > 10) throw new Error('the 15-prize worked example did not finish');
}
const completedExample = targetExample.data.randomBoxPoolHistory.at(-1);
assert.strictEqual(completedExample.initialCount, 15);
assert.strictEqual(completedExample.totalPrizeItems, 15);
assert.strictEqual(completedExample.entryProgressDraws, 100);
assert.strictEqual(completedExample.recoveryTargetDraws, 200);
assert.strictEqual(completedExample.recoveryProgressDraws, 200);
assert.strictEqual(completedExample.totalCollected, 300,
  'the first and two later prize events each use a bounded 100-draw target');
assert.strictEqual(targetExample.data.stockItems.filter(stock => stock.status === 'sold').length, 15);

// Deleting a reserved prize deducts it from the active batch without adding
// another long wait or invalidating the currently scheduled bundle.
const removalExample = makeScenario({ count: 8, rate: 2, price: 2, seed: 203 });
const removalRandom = (min, maxExclusive) => {
  if (min === 45 && maxExclusive === 61) return 45;
  if (min === 1 && maxExclusive === 101) return 1;
  if (min === 0) return 0;
  return min + Math.floor((maxExclusive - min - 1) / 2);
};
performDraw(removalExample.data, removalExample.product, removalRandom, removalExample.genId, 45, 1);
const removalPool = randomBox.getActivePool(removalExample.data, removalExample.product.id);
assert.strictEqual(removalPool.phase, 'recovery');
const removedPrizeId = removalPool.remainingStockIds[0];
const previousRecoveryTarget = removalPool.recoveryTargetDraws;
const removedPrize = randomBox.deletePrizeStock(removalExample.data, removalExample.product, {
  stockIds: [removedPrizeId], randomInt: removalRandom, now: 1_800_000_000_050,
});
assert.strictEqual(removedPrize.deletedCount, 1);
assert.strictEqual(removedPrize.removedReservedCount, 1);
assert.strictEqual(removedPrize.stockEmpty, false);
assert.strictEqual(removalPool.initialCount, 7);
assert.strictEqual(removalPool.cancelledPrizeCount, 1);
assert.strictEqual(removalPool.remainingStockIds.length, 6);
assert.strictEqual(removalPool.recoveryTargetDraws, previousRecoveryTarget,
  'removing a prize does not extend or unexpectedly shorten the next payout interval');
assert.strictEqual(removalPool.recoveryMilestones.length, 1);
assert.ok(removalPool.recoveryMilestones[0].count <= removalPool.remainingStockIds.length);
const deliveredRemovalExample = removalExample.data.stockItems.find(stock => stock.status === 'sold');
const protectedSoldPrize = randomBox.deletePrizeStock(removalExample.data, removalExample.product, {
  stockIds: [deliveredRemovalExample.id], randomInt: removalRandom,
});
assert.strictEqual(protectedSoldPrize.deletedCount, 0, 'delete-all selection never removes already delivered prizes');
assert.ok(removalExample.data.stockItems.some(stock => stock.id === deliveredRemovalExample.id));

// Delete-all removes current and pending unsold prizes, records the canceled
// batch, and the next added item starts a clean pool with a fresh stock count.
const deleteAllExample = makeScenario({ count: 4, rate: 1, price: 1, seed: 207 });
const delayPayoutRandom = (min, maxExclusive) => {
  if (min === 85 && maxExclusive === 111) return 110;
  return min;
};
performDraw(deleteAllExample.data, deleteAllExample.product, delayPayoutRandom, deleteAllExample.genId, 1, 1);
deleteAllExample.data.stockItems.push({
  id: 'pending-prize', productId: deleteAllExample.product.id, username: 'Pending prize',
  status: 'available', fulfillmentMode: 'automatic',
});
const deleteOneReserved = randomBox.deletePrizeStock(deleteAllExample.data, deleteAllExample.product, {
  stockIds: [randomBox.getActivePool(deleteAllExample.data, deleteAllExample.product.id).remainingStockIds[0]],
  randomInt: delayPayoutRandom,
});
assert.strictEqual(deleteOneReserved.deletedCount, 1);
assert.strictEqual(randomBox.getActivePool(deleteAllExample.data, deleteAllExample.product.id).initialCount, 3);
const deleteEveryUnsoldPrize = randomBox.deletePrizeStock(deleteAllExample.data, deleteAllExample.product, {
  randomInt: delayPayoutRandom,
});
assert.strictEqual(deleteEveryUnsoldPrize.deletedCount, 4);
assert.strictEqual(deleteEveryUnsoldPrize.removedReservedCount, 3);
assert.strictEqual(deleteEveryUnsoldPrize.resetPool, true);
assert.strictEqual(deleteEveryUnsoldPrize.stockEmpty, true);
assert.strictEqual(randomBox.getActivePool(deleteAllExample.data, deleteAllExample.product.id), null);
assert.strictEqual(randomBox.availablePrizeStockCount(deleteAllExample.data, deleteAllExample.product), 0);
assert.strictEqual(deleteAllExample.data.randomBoxPoolHistory.at(-1).cancelledPrizeCount, 4);
deleteAllExample.data.stockItems.push({
  id: 'fresh-prize', productId: deleteAllExample.product.id, username: 'Fresh prize',
  status: 'available', fulfillmentMode: 'automatic',
});
performDraw(deleteAllExample.data, deleteAllExample.product, delayPayoutRandom, deleteAllExample.genId, 1, 2);
assert.strictEqual(randomBox.getActivePool(deleteAllExample.data, deleteAllExample.product.id).initialCount, 1,
  'new stock after an empty reset creates a new batch from its own item count');

// Rate and price cases: recovery budget follows the initial count × the saved
// rate interval × saved per-draw price, and every key is paid exactly once.
const matrix = [
  { count: 1, rate: 1, price: 1 },
  { count: 2, rate: 1, price: 2 },
  { count: 6, rate: 2, price: 1 },
  { count: 10, rate: 2, price: 2 },
  { count: 15, rate: 3, price: 1 },
  { count: 25, rate: 5, price: 2 },
  { count: 8, rate: 7, price: 3 },
  { count: 12, rate: 10, price: 2 },
  ...Array.from({ length: 10 }, (_, index) => {
    const rate = index + 1;
    return { count: [1, 6, 15][index % 3], rate, price: rate % 2 ? 1 : 2 };
  }),
];
const observedAwardSizes = new Set();
for (const [index, scenarioConfig] of matrix.entries()) {
  const scenario = makeScenario({ ...scenarioConfig, seed: 100 + index });
  const orders = completeAllPrizes(scenario);
  const history = scenario.data.randomBoxPoolHistory.at(-1);
  const events = payoutEvents(scenario.data);
  events.forEach(event => observedAwardSizes.add(event.count));
  const { minTarget, maxTarget } = randomBox.getRateConfig(scenarioConfig.rate);
  assert.strictEqual(history.initialCount, scenarioConfig.count);
  assert.strictEqual(history.rate, scenarioConfig.rate);
  assert.strictEqual(history.price, scenarioConfig.price);
  assert.ok(events.length >= 1);
  assert.ok(events.every(event => event.interval >= minTarget && event.interval <= maxTarget),
    `each payout interval stays inside the configured rate: ${JSON.stringify(scenarioConfig)}`);
  assert.ok(events.every(event => event.count >= 1 && event.count <= randomBox.MAX_RANDOM_BOX_PRIZE_ITEMS),
    'each payout bundle contains between one and five prizes');
  assert.strictEqual(events.reduce((sum, event) => sum + event.count, 0), scenarioConfig.count);
  assert.strictEqual(history.totalPrizeItems, scenarioConfig.count);
  assert.strictEqual(history.entryPrizeCount, events[0].count);
  assert.strictEqual(history.recoveryTargetDraws, events.slice(1).reduce((sum, event) => sum + event.interval, 0));
  assert.strictEqual(history.recoveryProgressDraws, history.recoveryTargetDraws);
  const draws = orders.reduce((sum, opened) => sum + opened.result.drawCount, 0);
  const collected = orders.reduce((sum, opened) => sum + opened.result.total, 0);
  assert.strictEqual(draws, history.totalDraws);
  assert.strictEqual(collected, history.totalCollected);
  assert.strictEqual(collected, draws * scenarioConfig.price);
  assert.strictEqual(scenario.data.stockItems.filter(stock => stock.status === 'sold').length, scenarioConfig.count);
  assert.strictEqual(scenario.data.users[0].walletBalance, 5_000_000 - collected);
  assert.strictEqual(orders.flatMap(opened => {
    const order = scenario.data.orders.find(item => item.id === opened.orderId);
    return order.items.map(item => item.randomBoxDraw);
  }).filter(result => result.isWin).reduce((sum, result) => sum + result.prizeCount, 0), scenarioConfig.count);
  for (const opened of orders) {
    assert.ok(opened.result.total <= opened.result.drawCount * scenarioConfig.price);
    assert.ok(!('rate' in opened.result));
    assert.ok(!('roundTarget' in opened.result));
    assert.ok(!('recoveryTargetDraws' in opened.result));
    for (const draw of scenario.data.orders.find(order => order.id === opened.orderId).items) {
      assert.ok(draw.price === scenarioConfig.price);
      if (draw.randomBoxDraw.isWin) assert.ok(draw.randomBoxDraw.prizeCount >= 1 && draw.randomBoxDraw.prizeCount <= 5);
      assert.ok(!JSON.stringify(draw.randomBoxDraw).includes('private-password'));
      if (draw.randomBoxDraw.isWin) assert.ok(JSON.stringify(draw.randomBoxDraw).includes('Prize '));
    }
  }
}
assert.ok(observedAwardSizes.has(1) && [...observedAwardSizes].some(size => size > 1),
  'simulation regularly delivers single prizes and sometimes multiple prizes');

// Price snapshots survive an admin changing configuration mid-batch. The new
// rate/price only applies after the captured stock batch finishes.
const changedSettings = makeScenario({ count: 1, rate: 1, price: 1, seed: 99 });
const oldPrice = randomBox.getDrawPrice(changedSettings.data, changedSettings.product);
assert.strictEqual(oldPrice, 1);
const stablePoolRandom = (min, maxExclusive) => {
  if (min === 85 && maxExclusive === 111) return 85;
  if (min === 1 && maxExclusive === 101) return 1;
  return min;
};
performDraw(changedSettings.data, changedSettings.product, stablePoolRandom, changedSettings.genId, 84, 1);
changedSettings.data.stockItems.push({
  id: 'new-key-after-snapshot', productId: changedSettings.product.id, username: 'new-secret',
  status: 'available', fulfillmentMode: 'automatic',
});
changedSettings.product.price = 2;
changedSettings.product.randomBox.rate = 2;
assert.strictEqual(randomBox.getDrawPrice(changedSettings.data, changedSettings.product), 1,
  'the active pool uses its captured draw price');
const finishOldPool = performDraw(changedSettings.data, changedSettings.product, stablePoolRandom, changedSettings.genId, 500, 2);
assert.strictEqual(finishOldPool.result.drawCount, 1);
assert.strictEqual(finishOldPool.result.total, 1);
assert.strictEqual(finishOldPool.result.priceChanged, true,
  'a request stops at the pool boundary instead of unexpectedly charging the new price');
assert.strictEqual(randomBox.availablePrizeStockCount(changedSettings.data, changedSettings.product), 1,
  'newly added stock remains for a separate request at the new price');
const newPoolDraw = performDraw(changedSettings.data, changedSettings.product, stablePoolRandom, changedSettings.genId, 1, 3);
assert.strictEqual(newPoolDraw.result.total, 2);
assert.strictEqual(randomBox.getActivePool(changedSettings.data, changedSettings.product.id)?.price, 2);

// Contributions are shared across different customers: the second buyer's
// draw reaches the same active pool started by the first buyer.
const sharedPool = makeScenario({ count: 5, rate: 1, price: 1, seed: 101 });
sharedPool.data.users.push({ id: 'buyer-two', status: 'active', walletBalance: 100 });
const sharedRandom = (min, maxExclusive) => {
  if (min === 85 && maxExclusive === 111) return 100;
  if (min === 1 && maxExclusive === 101) return 100;
  return min;
};
const buyerOneContribution = randomBox.drawRandomBox(sharedPool.data, {
  productId: sharedPool.product.id, userId: 'buyer', idempotencyKey: 'shared-buyer-one-00001',
  drawCount: 50, randomInt: sharedRandom, genId: sharedPool.genId,
});
assert.strictEqual(buyerOneContribution.result.isWin, false);
assert.strictEqual(randomBox.getActivePool(sharedPool.data, sharedPool.product.id).entryProgressDraws, 50);
const buyerTwoContribution = randomBox.drawRandomBox(sharedPool.data, {
  productId: sharedPool.product.id, userId: 'buyer-two', idempotencyKey: 'shared-buyer-two-00001',
  drawCount: 50, randomInt: sharedRandom, genId: sharedPool.genId,
});
assert.strictEqual(buyerTwoContribution.result.winCount, 1);
assert.strictEqual(buyerTwoContribution.result.prizeCount, 5);
assert.strictEqual(sharedPool.data.users[0].walletBalance, 5_000_000 - 50);
assert.strictEqual(sharedPool.data.users[1].walletBalance, 50);

// An order idempotency retry must not charge again or consume another key.
const replayCase = makeScenario({ count: 3, rate: 10, price: 2, seed: 4 });
const replayRandom = seededRandom(77);
const firstReplayAttempt = performDraw(replayCase.data, replayCase.product, replayRandom, replayCase.genId, 1, 1);
const walletAfterFirst = replayCase.data.users[0].walletBalance;
const stockAfterFirst = replayCase.data.stockItems.filter(stock => stock.status === 'sold').length;
const replay = randomBox.drawRandomBox(replayCase.data, {
  productId: replayCase.product.id,
  userId: 'buyer',
  idempotencyKey: 'request-0001-unique',
  drawCount: 1,
  now: 1_800_000_000_001,
  randomInt: () => { throw new Error('replay must not draw again'); },
  genId: replayCase.genId,
});
assert.strictEqual(replay.replay, true);
assert.strictEqual(replay.orderId, firstReplayAttempt.orderId);
assert.strictEqual(replayCase.data.users[0].walletBalance, walletAfterFirst);
assert.strictEqual(replayCase.data.stockItems.filter(stock => stock.status === 'sold').length, stockAfterFirst);

// A buyer with too little money cannot start a round or reserve the prize.
const insufficient = makeScenario({ count: 3, rate: 1, price: 2, seed: 13 });
insufficient.data.users[0].walletBalance = 1;
assert.throws(() => performDraw(insufficient.data, insufficient.product, insufficient.randomInt, insufficient.genId, 1, 1),
  error => error.code === 'INSUFFICIENT_BALANCE');
assert.strictEqual(randomBox.getActivePool(insufficient.data, insufficient.product.id), null);
assert.ok(insufficient.data.stockItems.every(stock => stock.status === 'available'));

// Rate/price edits do not bring other catalog inventory into the prize pool.
const directOnly = makeScenario({ count: 2, rate: 1, price: 1, seed: 35 });
directOnly.data.products.push({ id: 'valuable-other', title: 'สินค้าราคาสูง', price: 999999, status: 'active' });
directOnly.data.stockItems.push({ id: 'other-stock', productId: 'valuable-other', status: 'available' });
assert.strictEqual(randomBox.availablePrizeStockCount(directOnly.data, directOnly.product), 2);

const mainCatalog = {
  products: [{ id: 'box', slug: 'box', title: 'box', price: 1, status: 'active', specialType: randomBox.RANDOM_BOX_KIND }],
  stockItems: [], settings: {},
};
assert.strictEqual(catalog.getTenantProducts(mainCatalog, { settings: { catalogApi: { enabled: true } } }).products.length, 0,
  'random boxes never reach tenant catalogs');

console.log('Random box simulations passed: 1–10 rates, editable draw prices, 1–5 prize events, 15-prize recovery example, stock snapshots, secrecy, idempotency, and main-shop isolation');
