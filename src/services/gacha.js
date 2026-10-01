"use strict";
const { randomInt } = require('node:crypto');
const DEFAULT_CONFIG = Object.freeze({
  rate: 1, ticketPriceCents: 100, targetRevenuePerItemCents: 9750,
  pityLimitCents: 11000, maxDropItems: 5, feedbackWindow: 50,
  bonusNumerator: 2, bonusDenominator: 5,
});
const STATE_VERSION = 4;
const MAX_TOTAL_CENTS = 1_000_000_000_000;

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  }
  return value;
}
function stockIndex(stock) {
  if (!Array.isArray(stock) || stock.length > 50000) throw new RangeError('Invalid stock array');
  const byId = new Map();
  for (const item of stock) {
    if (!item || typeof item.stockId !== 'string' || !item.stockId.trim() || byId.has(item.stockId)) {
      throw new Error('Every stock item must have a unique, nonempty stockId');
    }
    if (!['available', 'reserved', 'sold'].includes(item.status)) throw new Error('Invalid stock status');
    byId.set(item.stockId, item);
  }
  return byId;
}
function configuration(options) {
  integer(options.rate ?? DEFAULT_CONFIG.rate, 1, 1, 'rate');
  integer(options.ticketPriceCents ?? DEFAULT_CONFIG.ticketPriceCents, 100, 100, 'ticketPriceCents');
  integer(options.ticketCount ?? 1, 1, 500, 'ticketCount');
  if (options.rtpBps !== undefined || options.dropSlots !== undefined) {
    throw new Error('Old RTP/dropSlots options are not supported');
  }
  const poolId = options.poolId ?? 'default';
  if (typeof poolId !== 'string' || !poolId.trim()) throw new Error('Invalid poolId');
  return { poolId, ticketCount: options.ticketCount ?? 1 };
}
function freshState(poolId) {
  return {
    version: STATE_VERSION, poolId, rate: 1, ticketPriceCents: 100,
    targetRevenuePerItemCents: 9750, totalCollectedCents: 0,
    totalPrizeItems: 0, drySpendCents: 0,
  };
}
function validateState(state, poolId) {
  if (!state || state.version !== STATE_VERSION || state.poolId !== poolId
    || state.rate !== 1 || state.ticketPriceCents !== 100 || state.targetRevenuePerItemCents !== 9750) {
    throw new Error('INVALID_POOL_STATE');
  }
  integer(state.totalCollectedCents, 0, MAX_TOTAL_CENTS, 'totalCollectedCents');
  integer(state.totalPrizeItems, 0, Math.floor(MAX_TOTAL_CENTS / 9750), 'totalPrizeItems');
  if (state.totalCollectedCents % 100
    || state.totalPrizeItems > state.totalCollectedCents / 100 * DEFAULT_CONFIG.maxDropItems) {
    throw new Error('INVALID_POOL_STATE');
  }
  integer(state.drySpendCents, 0, 10900, 'drySpendCents');
  if (state.drySpendCents % 100 || state.drySpendCents > state.totalCollectedCents) {
    throw new Error('INVALID_POOL_STATE');
  }
}
function odds(state, remainingStock) {
  const slots = Math.min(DEFAULT_CONFIG.maxDropItems, remainingStock);
  const ledgerCents = state.totalCollectedCents - state.totalPrizeItems * 9750;
  // P feedback: positive ledger raises odds; excess giveaways reduce odds.
  // A nonzero floor keeps random early/multiple drops possible after a win.
  const denominatorPerItem = 9750 * DEFAULT_CONFIG.feedbackWindow;
  const numerator = Math.min(denominatorPerItem,
    Math.max(250, 100 * DEFAULT_CONFIG.feedbackWindow + ledgerCents + 100));
  // If the first prize wins, each next prize has a 2/5 continuation chance.
  // Normalize the first-hit chance by E[bundle], so bonuses are included in
  // the overall payout budget instead of silently increasing the drop rate.
  let bundleNumerator = 0;
  const bundleDenominator = 5 ** (slots - 1);
  for (let i = 0; i < slots; i++) bundleNumerator += 2 ** i * 5 ** (slots - 1 - i);
  const firstHitNumerator = numerator * bundleDenominator;
  const firstHitDenominator = denominatorPerItem * bundleNumerator;
  const firstHitProbability = firstHitNumerator / firstHitDenominator;
  const probabilities = [1 - firstHitProbability];
  for (let count = 1; count <= slots; count++) {
    probabilities.push(firstHitProbability * 0.4 ** (count - 1) * (count === slots ? 1 : 0.6));
  }
  const pityDue = state.drySpendCents + 100 >= DEFAULT_CONFIG.pityLimitCents;
  if (pityDue) {
    probabilities[1] += probabilities[0];
    probabilities[0] = 0;
  }
  return {
    slots, numerator: firstHitNumerator, denominator: firstHitDenominator, pityDue,
    probabilities,
    probabilityAnyDrop: 1 - probabilities[0],
    probabilityMultiDrop: probabilities.slice(2).reduce((sum, p) => sum + p, 0),
    expectedItemCount: probabilities.reduce((sum, p, count) => sum + p * count, 0),
  };
}
function inspect(options) {
  const config = configuration(options);
  const byId = stockIndex(options.stock);
  const pool = [...byId.values()].filter(item => item.status === 'available');
  if (!pool.length) throw new Error('NO_STOCK');
  const state = options.state == null ? freshState(config.poolId) : options.state;
  validateState(state, config.poolId);
  if (state.totalCollectedCents + config.ticketCount * 100 > MAX_TOTAL_CENTS
    || state.totalPrizeItems + Math.min(pool.length, config.ticketCount * 5) > Math.floor(MAX_TOTAL_CENTS / 9750)) {
    throw new Error('ACCOUNTING_LIMIT');
  }
  return { config, pool, state };
}
function publicQuote(config, pool, state) {
  const chances = odds(state, pool.length);
  return {
    rate: 1, ticketPriceCents: 100, requestedTicketCount: config.ticketCount,
    requestedPaymentCents: config.ticketCount * 100,
    targetRevenuePerItemCents: 9750,
    pityLimitCents: 11000,
    pityScope: 'box',
    drySpendCents: state.drySpendCents,
    remainingStock: pool.length,
    // These odds apply ONLY to the next 1-baht ticket; reprice after every ticket.
    probabilityAnyDrop: chances.probabilityAnyDrop,
    probabilityMultiDrop: chances.probabilityMultiDrop,
    dropCountProbabilities: chances.probabilities,
  };
}
function quote(options) {
  const { config, pool, state } = inspect(options);
  return publicQuote(config, pool, state);
}
/**
 * Actual first-hit and continuation trials on every ticket, plus shared-box pity.
 * Keep the same shared accounting state through stock refills and restarts.
 * Caller must atomically commit wallet, stock, state, order and idempotency.
 */
function draw(options, { rng = randomInt } = {}) {
  const inspected = inspect(options);
  const { config, pool } = inspected;
  const pricing = publicQuote(config, pool, inspected.state);
  const state = { ...inspected.state };
  const roll = (min, max) => integer(rng(min, max), min, max - 1, 'rng result');
  const rewards = [], drawResults = [];
  let ticketCount = 0;
  for (; ticketCount < config.ticketCount && pool.length; ticketCount++) {
    const chances = odds(state, pool.length);
    let count = 0;
    if (roll(0, chances.denominator) < chances.numerator) {
      count = 1;
      while (count < chances.slots
        && roll(0, DEFAULT_CONFIG.bonusDenominator) < DEFAULT_CONFIG.bonusNumerator) count++;
    }
    const pityApplied = chances.pityDue && count === 0;
    if (pityApplied) count = 1;
    const ids = [];
    for (let prize = 0; prize < count; prize++) {
      // The caller supplies stock in the same order shown in its stock table.
      // Randomness controls whether/how many prizes drop; delivery is FIFO.
      const item = pool.shift();
      rewards.push({ stockId: item.stockId, rewardId: item.rewardId,
        title: item.title, estimatedValueCents: item.estimatedValueCents });
      ids.push(item.stockId);
    }
    state.totalCollectedCents += 100;
    state.totalPrizeItems += count;
    state.drySpendCents = count ? 0 : state.drySpendCents + 100;
    drawResults.push({ prizeCount: count, stockIds: ids, pityApplied });
  }
  const soldIds = new Set(rewards.map(item => item.stockId));
  return {
    ...pricing, ticketCount, paymentCents: ticketCount * 100,
    prizeCount: rewards.length, rewards, drawResults, stockExhausted: !pool.length,
    // Private server-only accounting and credential-bearing stock.
    nextState: state,
    nextStock: options.stock.map(item => soldIds.has(item.stockId) ? { ...item, status: 'sold' } : { ...item }),
  };
}
module.exports = { draw, quote, DEFAULT_CONFIG, createState: freshState, STATE_VERSION };
