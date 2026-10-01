"use strict";
const assert = require('node:assert/strict');
const { draw, quote } = require('../src/services/gacha');
function stock(count, prefix = 'id') {
  return Array.from({ length: count }, (_, i) => ({
    stockId: `${prefix}-${i}`, rewardId: 'account', title: `Account ${i}`,
    status: 'available', credentialsRef: `private-${i}`,
  }));
}
function seededRandom(seed) {
  let state = seed >>> 0;
  return (min, max) => {
    const width = max - min;
    const limit = Math.floor(0x100000000 / width) * width;
    let value;
    do {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      value = state >>> 0;
    } while (value >= limit);
    return min + value % width;
  };
}
const miss = (min, max) => max - 1;
const options = { stock: stock(60), poolId: 'box-1', userId: 'alice' };
const quoted = quote(options);
assert.equal(quoted.ticketPriceCents, 100);
assert.equal(quoted.targetRevenuePerItemCents, 9750);
assert.ok(quoted.probabilityMultiDrop > 0);
assert.ok(Math.abs(quoted.dropCountProbabilities.reduce((sum, p) => sum + p, 0) - 1) < 1e-12);
for (const invalid of [{ rate: 2 }, { ticketPriceCents: 200 }, { ticketCount: 0 },
  { ticketCount: 501 }, { rtpBps: 9000 }, { dropSlots: 5 }]) {
  assert.throws(() => draw({ ...options, ...invalid }));
}
assert.doesNotThrow(() => draw({ ...options, userId: undefined }));
assert.throws(() => draw({ ...options, stock: [] }), /NO_STOCK/);
assert.throws(() => draw({ ...options, stock: [stock(1)[0], stock(1)[0]] }));
assert.throws(() => draw(options, { rng: () => -1 }));
// Force a first win and one bonus on the first ticket; all later main draws miss.
// This proves even fresh low budgets can win multiple IDs without past funding.
for (const ticketCount of [1, 50, 100]) {
  let calls = 0;
  const original = JSON.stringify(options);
  const result = draw({ ...options, ticketCount }, { rng: (min, max) => {
    calls++;
    if (calls <= 2) return 0;
    return max - 1;
  } });
  assert.equal(result.prizeCount, 2);
  assert.equal(result.drawResults[0].prizeCount, 2);
  assert.deepEqual(result.rewards.map(item => item.stockId), ['id-0', 'id-1'], 'multi-drop consumes the top stock rows');
  assert.equal(result.paymentCents, ticketCount * 100);
  assert.equal(new Set(result.rewards.map(item => item.stockId)).size, 2);
  assert.equal(JSON.stringify(options), original);
  assert.ok(!JSON.stringify(result.rewards).includes('private-'));
}
// Shared-box pity persists across calls and changing players.
const first = draw({ ...options, ticketCount: 109 }, { rng: miss });
assert.equal(first.prizeCount, 0);
assert.equal(first.nextState.drySpendCents, 10900);
const originalState = JSON.stringify(first.nextState);
const pityQuote = quote({ ...options, stock: first.nextStock, state: first.nextState, userId: 'bob' });
assert.equal(pityQuote.pityScope, 'box');
assert.equal(pityQuote.probabilityAnyDrop, 1);
assert.equal(pityQuote.dropCountProbabilities[0], 0);
assert.ok(Math.abs(pityQuote.dropCountProbabilities.reduce((sum, p) => sum + p, 0) - 1) < 1e-12);
const forced = draw({ ...options, stock: first.nextStock, state: first.nextState, userId: 'bob' }, { rng: miss });
assert.equal(forced.prizeCount, 1);
assert.equal(forced.drawResults[0].pityApplied, true);
assert.equal(forced.nextState.drySpendCents, 0);
assert.equal(JSON.stringify(first.nextState), originalState);
const bob = draw({ ...options, stock: forced.nextStock, state: forced.nextState,
  userId: 'bob', ticketCount: 50 }, { rng: miss });
assert.equal(bob.prizeCount, 0);
assert.equal(bob.nextState.drySpendCents, 5000);
const alice = draw({ ...options, stock: bob.nextStock, state: bob.nextState,
  userId: 'alice', ticketCount: 60 }, { rng: miss });
assert.equal(alice.prizeCount, 1);
assert.equal(alice.nextState.drySpendCents, 0);
// Any player's natural win resets the shared counter for everyone.
const natural = draw({ ...options, stock: bob.nextStock, state: bob.nextState, userId: 'carol' }, { rng: () => 0 });
assert.equal(natural.prizeCount, 5);
assert.equal(natural.drawResults[0].pityApplied, false);
assert.equal(natural.nextState.drySpendCents, 0);
// Rebalance the next-ticket distribution after generous early drops.
assert.ok(quote({ ...options, stock: natural.nextStock, state: natural.nextState }).probabilityMultiDrop
  < quote(options).probabilityMultiDrop);
assert.ok(quote({ ...options, stock: first.nextStock, state: first.nextState, userId: 'new-player' }).probabilityMultiDrop
  > quote(options).probabilityMultiDrop);
assert.throws(() => draw({ ...options, state: { ...first.nextState, version: 2 } }), /INVALID_POOL_STATE/);
assert.throws(() => draw({ ...options, state: { ...first.nextState, poolId: 'other' } }), /INVALID_POOL_STATE/);
const invalid = structuredClone(first.nextState);
invalid.drySpendCents = 11000;
assert.throws(() => draw({ ...options, state: invalid }));
assert.doesNotThrow(() => quote({ ...options, state: JSON.parse(JSON.stringify(first.nextState)) }));
const unavailable = stock(3);
unavailable[0].status = 'sold'; unavailable[1].status = 'reserved';
const last = draw({ ...options, stock: unavailable, ticketCount: 500 }, { rng: () => 0 });
assert.deepEqual(last.rewards.map(item => item.stockId), ['id-2']);
assert.equal(last.paymentCents, 100);
assert.equal(last.ticketCount, 1);
assert.equal(last.stockExhausted, true);
assert.throws(() => draw({ ...options, stock: last.nextStock, state: last.nextState }), /NO_STOCK/);
assert.doesNotThrow(() => draw(options));

function consume(requestSize, seed, count = 60) {
  let nextStock = stock(count), state = null, collected = 0;
  const rng = seededRandom(seed), delivered = [], events = [];
  for (let guard = 0; guard < count * 110 + 1; guard++) {
    const result = draw({ ...options, stock: nextStock, state, ticketCount: requestSize }, { rng });
    for (const event of result.drawResults) {
      collected += 100;
      if (event.prizeCount) events.push({ collected, ...event });
    }
    delivered.push(...result.rewards.map(item => item.stockId));
    state = result.nextState; nextStock = result.nextStock;
    assert.equal(state.totalCollectedCents, collected);
    if (result.stockExhausted) break;
  }
  assert.equal(delivered.length, count);
  assert.equal(new Set(delivered).size, count);
  assert.equal(state.totalPrizeItems, count);
  return { collected, delivered, events, state: JSON.parse(JSON.stringify(state)) };
}
const single = consume(1, 456);
for (const size of [50, 100, 500]) assert.deepEqual(consume(size, 456), single);

// Carry accounting through refills; resetting it would destroy cost feedback.
function longRun(players, seed, runs = 200000, actionSize = 100) {
  let state = null, nextStock = stock(500), epoch = 1, processed = 0;
  let multiDrops = 0, pityDrops = 0, actions = 0, zeroActions = 0, multiActions = 0;
  const rng = seededRandom(seed);
  let dry = 0;
  while (processed < runs) {
    if (nextStock.filter(item => item.status === 'available').length < 10) {
      nextStock = [...nextStock.filter(item => item.status === 'available'), ...stock(500, `refill-${epoch++}`)];
    }
    const userId = `user-${Math.floor(processed / actionSize) % players}`;
    const result = draw({ ...options, userId, stock: nextStock, state,
      ticketCount: Math.min(actionSize, runs - processed) }, { rng });
    actions++;
    zeroActions += Number(result.prizeCount === 0);
    multiActions += Number(result.prizeCount >= 2);
    for (const event of result.drawResults) {
      const spent = dry + 100;
      assert.ok(spent <= 11000, 'box cannot miss for more than 110 baht across all players');
      dry = event.prizeCount ? 0 : spent;
      multiDrops += Number(event.prizeCount > 1);
      pityDrops += Number(event.pityApplied);
    }
    processed += result.ticketCount;
    state = result.nextState; nextStock = result.nextStock;
    assert.equal(state.drySpendCents, dry);
  }
  const revenuePerItemBaht = state.totalCollectedCents / state.totalPrizeItems / 100;
  assert.ok(Math.abs(revenuePerItemBaht - 97.5) < 0.25);
  return { players, actionBaht: actionSize, tickets: processed, prizes: state.totalPrizeItems,
    revenuePerItemBaht: +revenuePerItemBaht.toFixed(4), multiDrops, pityDrops,
    zeroActionPercent: +(zeroActions / actions * 100).toFixed(2),
    multiActionPercent: +(multiActions / actions * 100).toFixed(2),
    ledgerBalanceBaht: (state.totalCollectedCents - state.totalPrizeItems * 9750) / 100 };
}
// The number/identity of participants never changes a box's odds or pity.
const onePlayer = longRun(1, 137);
const manyPlayers = longRun(10, 137);
assert.deepEqual({ ...onePlayer, players: 10 }, manyPlayers);
const simulated = [onePlayer, longRun(10, 237), longRun(100, 337),
  longRun(10, 437, 200000, 50), longRun(10, 537, 200000, 200)];
console.log('PASS: actual random multi-drop, shared-box 110-baht pity, odds normalization, feedback, stock, privacy, partition invariance, refills');
console.table(simulated);
