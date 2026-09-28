const crypto = require('crypto');

const RANDOM_BOX_KIND = 'random-box';
const RANDOM_BOX_PRICE = 1;
const RANDOM_BOX_MIN_RATE = 1;
const RANDOM_BOX_MAX_RATE = 10;
const MAX_RANDOM_BOX_DRAWS = 500;
const MAX_RANDOM_BOX_PRICE = 100000000;
const MAX_RANDOM_BOX_STOCK = 50000;
const DEFAULT_RANDOM_BOX_RATE = 1;
const RANDOM_BOX_MIN_TARGET = 85;
const RANDOM_BOX_MAX_TARGET = 110;
const MAX_RANDOM_BOX_PRIZE_ITEMS = 5;
const DEFAULT_MISS_MESSAGE = 'ยังไม่ได้รับรางวัลในครั้งนี้';
const MAX_MISS_MESSAGE_LENGTH = 300;
const POOL_HISTORY_LIMIT = 500;

function normalizeMissMessage(message) {
  return String(message ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_MISS_MESSAGE_LENGTH);
}

function getStockPrizeName(stock, fallback = '') {
  const name = [stock?.rewardName, stock?.displayName, stock?.name, stock?.title, stock?.username]
    .map(value => String(value ?? '').replace(/[\u0000-\u001f\u007f\r\n]+/g, ' ').trim())
    .find(Boolean);
  return (name || String(fallback || '').trim()).slice(0, 120);
}

function getMissMessage(product) {
  return normalizeMissMessage(product?.randomBox?.missMessage) || DEFAULT_MISS_MESSAGE;
}

function supportsRandomBox(req) {
  return !req?.tenantShop;
}

function normalizeRate(rate) {
  const value = Number(rate);
  if (!Number.isInteger(value) || value < RANDOM_BOX_MIN_RATE || value > RANDOM_BOX_MAX_RATE) return DEFAULT_RANDOM_BOX_RATE;
  return value;
}

function getRateConfig(rate) {
  const normalizedRate = normalizeRate(rate);
  // Keep the shop's established rate examples (1 => 85–110, 2 => 45–60,
  // 3 => 30–40) and scale the remaining supported rates from the same base.
  let minTarget;
  let maxTarget;
  if (normalizedRate === 1) [minTarget, maxTarget] = [85, 110];
  else if (normalizedRate === 2) [minTarget, maxTarget] = [45, 60];
  else if (normalizedRate === 3) [minTarget, maxTarget] = [30, 40];
  else {
    minTarget = Math.max(1, Math.ceil(RANDOM_BOX_MIN_TARGET / normalizedRate));
    maxTarget = Math.max(minTarget, Math.floor(RANDOM_BOX_MAX_TARGET / normalizedRate));
  }
  return { rate: normalizedRate, minTarget, maxTarget };
}

function randomIntInclusive(randomInt, min, max) {
  return randomInt(min, max + 1);
}

function randomTarget(randomInt = crypto.randomInt, rate = DEFAULT_RANDOM_BOX_RATE) {
  const { minTarget, maxTarget } = getRateConfig(rate);
  return randomIntInclusive(randomInt, minTarget, maxTarget);
}

function parseRate(body = {}) {
  return normalizeRate(body.randomBoxRate);
}

function validateRate(rate) {
  const raw = String(rate == null ? '' : rate).trim();
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < RANDOM_BOX_MIN_RATE || value > RANDOM_BOX_MAX_RATE) {
    return `เรทกล่องสุ่มต้องเป็นจำนวนเต็ม ${RANDOM_BOX_MIN_RATE}–${RANDOM_BOX_MAX_RATE}`;
  }
  return null;
}

function parsePrice(value) {
  const raw = String(value == null ? '' : value).trim();
  const price = Number(raw);
  if (!raw || !Number.isSafeInteger(price) || price < 1 || price > MAX_RANDOM_BOX_PRICE) return null;
  return price;
}

function validatePrice(value) {
  return parsePrice(value) === null
    ? `ราคาสุ่มต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${MAX_RANDOM_BOX_PRICE.toLocaleString('th-TH')} บาท`
    : null;
}

function configuredPrice(product) {
  return parsePrice(product?.price) ?? RANDOM_BOX_PRICE;
}

function stockItemsOldestFirst(stockItems = [], productId = null) {
  if (!Array.isArray(stockItems)) return [];
  return stockItems
    .map((item, index) => ({ item, index, addedAt: Date.parse(item?.addedAt) }))
    .filter(({ item }) => item && (productId === null || String(item.productId) === String(productId)))
    .sort((a, b) => {
      const aHasDate = Number.isFinite(a.addedAt);
      const bHasDate = Number.isFinite(b.addedAt);
      if (aHasDate && bHasDate && a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
      if (aHasDate !== bHasDate) return aHasDate ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function availableStockItems(stockItems = [], productId = null) {
  return stockItemsOldestFirst(stockItems, productId).filter(item => item.status === 'available');
}

function availableStockCount(stockItems = [], productId = null) {
  return availableStockItems(stockItems, productId).length;
}

function parseDrawCount(value = 1) {
  const raw = String(value == null ? '' : value).trim();
  const count = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(count) || count < 1 || count > MAX_RANDOM_BOX_DRAWS) {
    const error = new Error(`เลือกจำนวนเปิดกล่องได้ตั้งแต่ 1 ถึง ${MAX_RANDOM_BOX_DRAWS} ครั้ง`);
    error.code = 'INVALID_DRAW_COUNT';
    throw error;
  }
  return count;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function poolMap(data) {
  data.randomBoxPools ||= {};
  return data.randomBoxPools;
}

function getActivePool(data, productId) {
  return data?.randomBoxPools?.[String(productId)] || null;
}

function getDrawPrice(data, product) {
  return getActivePool(data, product?.id)?.price || configuredPrice(product);
}

function poolRemainingStock(data, pool) {
  const byId = new Map((data.stockItems || []).map(stock => [String(stock.id), stock]));
  return (pool?.remainingStockIds || [])
    .map(id => byId.get(String(id)))
    .filter(stock => stock && stock.status === 'reserved' && String(stock.randomBoxPoolId) === String(pool.id));
}

function availablePrizeStockCount(data, boxProduct) {
  if (!boxProduct) return 0;
  const active = getActivePool(data, boxProduct.id);
  const activeCount = active ? poolRemainingStock(data, active).length : 0;
  const pendingCount = availableStockCount(data.stockItems, boxProduct.id);
  const legacyCount = !active && data.randomBoxRounds?.[String(boxProduct.id)]
    ? (data.stockItems || []).filter(stock => stock.status === 'reserved'
      && String(stock.productId) === String(boxProduct.id)
      && String(stock.randomBoxReservedFor) === String(boxProduct.id)).length
    : 0;
  return activeCount + pendingCount + legacyCount;
}

function hasAvailablePrizeBundle(data, boxProduct) {
  return availablePrizeStockCount(data, boxProduct) > 0;
}

function getPoolSummary(data, product) {
  const pool = getActivePool(data, product?.id);
  if (!pool) return null;
  return {
    initialCount: Number(pool.initialCount) || 0,
    remainingCount: poolRemainingStock(data, pool).length,
    phase: pool.phase === 'recovery' ? 'recovery' : 'entry',
  };
}

function releaseRoundPrizeReservation(data, productId, round) {
  const reservedIds = new Set((round?.reservedPrizeItems || []).map(item => String(item.stockItemId || item.id || '')));
  (data.stockItems || []).forEach(stock => {
    if (stock.status === 'reserved' && String(stock.randomBoxReservedFor) === String(productId)
      && (!reservedIds.size || reservedIds.has(String(stock.id)))) {
      stock.status = 'available';
      delete stock.randomBoxReservedFor;
      delete stock.randomBoxPoolId;
    }
  });
}

function randomAwardCount(remainingCount, randomInt) {
  const maximum = Math.min(MAX_RANDOM_BOX_PRIZE_ITEMS, remainingCount);
  if (maximum <= 1) return maximum;
  const roll = randomInt(1, 101);
  const weighted = roll <= 20 ? 1 : roll <= 45 ? 2 : roll <= 70 ? 3 : roll <= 90 ? 4 : 5;
  return Math.min(maximum, weighted);
}

function buildRecoveryAwardCounts(remainingCount, randomInt) {
  const minGroups = Math.ceil(remainingCount / MAX_RANDOM_BOX_PRIZE_ITEMS);
  const maxGroups = Math.min(remainingCount, Math.max(minGroups, Math.ceil(remainingCount / 2)));
  const groupCount = randomIntInclusive(randomInt, minGroups, maxGroups);
  const counts = [];
  let left = remainingCount;
  for (let index = 0; index < groupCount; index += 1) {
    const slotsAfter = groupCount - index - 1;
    const minSize = Math.max(1, left - (slotsAfter * MAX_RANDOM_BOX_PRIZE_ITEMS));
    const maxSize = Math.min(MAX_RANDOM_BOX_PRIZE_ITEMS, left - slotsAfter);
    const size = randomIntInclusive(randomInt, minSize, maxSize);
    counts.push(size);
    left -= size;
  }
  if (left !== 0 || counts.some(count => count < 1 || count > MAX_RANDOM_BOX_PRIZE_ITEMS)) {
    fail('POOL_PLAN_INVALID', 'จัดรอบสุ่มไม่สำเร็จ กรุณาลองใหม่');
  }
  return counts;
}

function buildRecoveryMilestones(totalDraws, awardCounts, randomInt) {
  if (!awardCounts.length || totalDraws < awardCounts.length) {
    fail('POOL_PLAN_INVALID', 'จำนวนรอบสุ่มไม่เพียงพอสำหรับสต็อกรางวัล');
  }
  const milestones = [];
  let drawsLeft = totalDraws;
  let cumulativeDraws = 0;
  awardCounts.forEach((count, index) => {
    const slotsLeft = awardCounts.length - index;
    let segment;
    if (slotsLeft === 1) segment = drawsLeft;
    else {
      const ideal = Math.floor(drawsLeft / slotsLeft);
      const spread = Math.max(1, Math.floor(ideal * 0.6));
      const minSegment = Math.max(1, ideal - spread);
      const maxSegment = Math.min(drawsLeft - (slotsLeft - 1), ideal + spread);
      segment = randomIntInclusive(randomInt, minSegment, maxSegment);
    }
    cumulativeDraws += segment;
    drawsLeft -= segment;
    milestones.push({ atDraws: cumulativeDraws, count });
  });
  if (drawsLeft !== 0 || milestones[milestones.length - 1].atDraws !== totalDraws) {
    fail('POOL_PLAN_INVALID', 'กำหนดรอบสะสมไม่สำเร็จ กรุณาลองใหม่');
  }
  return milestones;
}

function cleanupLegacyRound(data, productId) {
  const rounds = data.randomBoxRounds;
  const oldRound = rounds?.[String(productId)];
  releaseRoundPrizeReservation(data, productId, oldRound || null);
  if (rounds) delete rounds[String(productId)];
}

function createPool(data, product, now, randomInt, genId) {
  const productId = String(product.id);
  cleanupLegacyRound(data, productId);
  const items = availableStockItems(data.stockItems, productId);
  if (!items.length) return null;
  if (items.length > MAX_RANDOM_BOX_STOCK) fail('STOCK_LIMIT', 'สต็อกรางวัลเกินจำนวนที่ระบบรองรับ');
  const rate = normalizeRate(product.randomBox?.rate);
  const price = configuredPrice(product);
  const { minTarget, maxTarget } = getRateConfig(rate);
  const id = genId(12);
  const initialCount = items.length;
  const pool = {
    id,
    productId,
    initialCount,
    initialStockIds: items.map(stock => String(stock.id)),
    remainingStockIds: items.map(stock => String(stock.id)),
    rate,
    price,
    phase: 'entry',
    entryTargetDraws: randomIntInclusive(randomInt, minTarget, maxTarget),
    entryProgressDraws: 0,
    recoveryTargetDraws: 0,
    recoveryProgressDraws: 0,
    recoveryMilestones: [],
    recoveryMilestoneIndex: 0,
    totalDraws: 0,
    totalCollected: 0,
    totalAwards: 0,
    totalPrizeItems: 0,
    entryPrizeCount: 0,
    cancelledPrizeCount: 0,
    createdAt: new Date(now).toISOString(),
  };
  items.forEach(stock => {
    stock.status = 'reserved';
    stock.randomBoxReservedFor = productId;
    stock.randomBoxPoolId = id;
  });
  poolMap(data)[productId] = pool;
  return pool;
}

function beginRecovery(pool, remainingCount, randomInt) {
  const { minTarget, maxTarget } = getRateConfig(pool.rate);
  // This deliberately uses the original stock batch size, as specified:
  // 15 initial items means an additional 15 × 85–110 base draw budget at rate 1.
  const minDraws = pool.initialCount * minTarget;
  const maxDraws = pool.initialCount * maxTarget;
  pool.recoveryTargetDraws = randomIntInclusive(randomInt, minDraws, maxDraws);
  pool.recoveryProgressDraws = 0;
  pool.recoveryMilestones = buildRecoveryMilestones(
    pool.recoveryTargetDraws,
    buildRecoveryAwardCounts(remainingCount, randomInt),
    randomInt,
  );
  pool.recoveryMilestoneIndex = 0;
  pool.phase = 'recovery';
}

function stockPrize(stock, product, orderId) {
  stock.status = 'sold';
  stock.soldOrderId = orderId;
  delete stock.randomBoxReservedFor;
  delete stock.randomBoxPoolId;
  return {
    productId: product.id,
    productTitle: getStockPrizeName(stock, 'รางวัลกล่องสุ่ม'),
    productImage: '',
    stockItemId: stock.id,
  };
}

function takePrizeItems(data, pool, count, product, orderId) {
  const remaining = poolRemainingStock(data, pool);
  const takeCount = Math.min(count, remaining.length);
  const chosen = [];
  for (let index = 0; index < takeCount; index += 1) {
    // Admin stock rows are displayed oldest-first, so the newest item sits at
    // the bottom. Consume that last item first to keep payouts bottom-to-top.
    const stock = remaining.pop();
    chosen.push(stockPrize(stock, product, orderId));
    pool.remainingStockIds = pool.remainingStockIds.filter(id => String(id) !== String(stock.id));
  }
  return chosen;
}

function recordPoolHistory(data, pool, finishedAt) {
  data.randomBoxPoolHistory ||= [];
  data.randomBoxPoolHistory.push({
    poolId: pool.id,
    productId: pool.productId,
    initialCount: pool.initialCount,
    rate: pool.rate,
    price: pool.price,
    entryTargetDraws: pool.entryTargetDraws,
    entryProgressDraws: pool.entryProgressDraws,
    recoveryTargetDraws: pool.recoveryTargetDraws,
    recoveryProgressDraws: pool.recoveryProgressDraws,
    recoveryMilestones: pool.recoveryMilestones.map(milestone => ({ ...milestone })),
    totalDraws: pool.totalDraws,
    totalCollected: pool.totalCollected,
    totalAwards: pool.totalAwards,
    totalPrizeItems: pool.totalPrizeItems,
    entryPrizeCount: pool.entryPrizeCount,
    cancelledPrizeCount: Number(pool.cancelledPrizeCount) || 0,
    createdAt: pool.createdAt,
    finishedAt,
  });
  if (data.randomBoxPoolHistory.length > POOL_HISTORY_LIMIT) {
    data.randomBoxPoolHistory.splice(0, data.randomBoxPoolHistory.length - POOL_HISTORY_LIMIT);
  }
}

function replanRecoveryAfterPrizeRemoval(data, pool, removedCount, randomInt) {
  if (!pool || pool.phase !== 'recovery' || removedCount < 1) return;
  const remainingCount = poolRemainingStock(data, pool).length;
  const progress = Math.max(0, Number(pool.recoveryProgressDraws) || 0);
  const previousTarget = Math.max(progress, Number(pool.recoveryTargetDraws) || 0);
  const { minTarget, maxTarget } = getRateConfig(pool.rate);
  const targetReduction = randomIntInclusive(randomInt, removedCount * minTarget, removedCount * maxTarget);
  const nextTarget = Math.max(progress, previousTarget - targetReduction);
  pool.recoveryTargetDraws = nextTarget;

  if (!remainingCount) {
    pool.recoveryMilestones = [];
    pool.recoveryMilestoneIndex = 0;
    return;
  }

  const awardCounts = buildRecoveryAwardCounts(remainingCount, randomInt);
  const minimumTarget = progress + awardCounts.length;
  pool.recoveryTargetDraws = Math.max(nextTarget, minimumTarget);
  pool.recoveryMilestones = buildRecoveryMilestones(
    pool.recoveryTargetDraws - progress,
    awardCounts,
    randomInt,
  ).map(milestone => ({ ...milestone, atDraws: milestone.atDraws + progress }));
  pool.recoveryMilestoneIndex = 0;
}

function deletePrizeStock(data, product, {
  stockIds = null,
  now = Date.now(),
  randomInt = crypto.randomInt,
} = {}) {
  if (!data || !product || product.specialType !== RANDOM_BOX_KIND) {
    return { deletedCount: 0, removedReservedCount: 0, resetPool: false, stockEmpty: false };
  }

  data.stockItems ||= [];
  const productId = String(product.id);
  const pools = poolMap(data);
  const pool = getActivePool(data, productId);
  const activePoolIds = new Set((pool?.remainingStockIds || []).map(String));
  const requestedIds = stockIds == null ? null : new Set(stockIds.map(String));
  const isActiveReservedPrize = stock => Boolean(pool
    && stock.status === 'reserved'
    && activePoolIds.has(String(stock.id))
    && String(stock.randomBoxPoolId) === String(pool.id));
  const isLegacyReservedPrize = stock => stock.status === 'reserved'
    && String(stock.randomBoxReservedFor) === productId
    && !isActiveReservedPrize(stock);

  const targets = data.stockItems.filter(stock => String(stock.productId) === productId
    && (!requestedIds || requestedIds.has(String(stock.id)))
    && (stock.status === 'available' || isActiveReservedPrize(stock) || isLegacyReservedPrize(stock)));
  if (!targets.length) return { deletedCount: 0, removedReservedCount: 0, resetPool: false, stockEmpty: availablePrizeStockCount(data, product) < 1 };

  const removedIds = new Set(targets.map(stock => String(stock.id)));
  const removedPoolIds = new Set(targets.filter(isActiveReservedPrize).map(stock => String(stock.id)));
  const removedReservedCount = removedPoolIds.size;
  const removedLegacyCount = targets.filter(isLegacyReservedPrize).length;

  if (removedLegacyCount) cleanupLegacyRound(data, productId);
  data.stockItems = data.stockItems.filter(stock => !removedIds.has(String(stock.id)));

  let resetPool = false;
  if (pool && removedReservedCount) {
    pool.initialStockIds = (pool.initialStockIds || []).filter(id => !removedPoolIds.has(String(id)));
    pool.remainingStockIds = (pool.remainingStockIds || []).filter(id => !removedPoolIds.has(String(id)));
    const remainingCount = poolRemainingStock(data, pool).length;
    pool.initialCount = Math.max(
      (Number(pool.totalPrizeItems) || 0) + remainingCount,
      (Number(pool.initialCount) || 0) - removedReservedCount,
    );
    pool.cancelledPrizeCount = (Number(pool.cancelledPrizeCount) || 0) + removedReservedCount;
    replanRecoveryAfterPrizeRemoval(data, pool, removedReservedCount, randomInt);
    if (!remainingCount) {
      recordPoolHistory(data, pool, new Date(now).toISOString());
      delete pools[productId];
      resetPool = true;
    }
  }

  const stockEmpty = availablePrizeStockCount(data, product) < 1;
  if (stockEmpty) {
    const remainingPool = getActivePool(data, productId);
    if (remainingPool && !poolRemainingStock(data, remainingPool).length) {
      recordPoolHistory(data, remainingPool, new Date(now).toISOString());
      delete pools[productId];
      resetPool = true;
    }
    if (data.randomBoxRounds) delete data.randomBoxRounds[productId];
  }

  return { deletedCount: targets.length, removedReservedCount, resetPool, stockEmpty };
}

function isPublished(product, now) {
  if (!product || product.status !== 'active') return false;
  if (!product.publishAt) return true;
  const value = String(product.publishAt);
  const time = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}:00+07:00`);
  return Number.isFinite(time) && time <= now;
}

function drawRandomBox(data, {
  productId,
  userId,
  idempotencyKey,
  drawCount = 1,
  now = Date.now(),
  randomInt = crypto.randomInt,
  genId = length => crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length),
}) {
  const requestedDrawCount = parseDrawCount(drawCount);
  data.orders ||= [];
  data.walletTransactions ||= [];
  data.stockItems ||= [];
  data.products ||= [];
  const pools = poolMap(data);
  const previous = data.walletTransactions.find(transaction => transaction.type === 'random_box_draw'
    && String(transaction.userId) === String(userId)
    && String(transaction.productId) === String(productId)
    && transaction.idempotencyKey === idempotencyKey);
  if (previous?.orderId) return { orderId: previous.orderId, result: previous.randomBoxResult, replay: true };

  const product = data.products.find(item => String(item.id) === String(productId));
  if (!isPublished(product, now)) fail('PRODUCT_UNAVAILABLE', 'กล่องสุ่มนี้ยังไม่เปิดขายหรือปิดการขายแล้ว');
  if (product.specialType !== RANDOM_BOX_KIND) fail('NOT_RANDOM_BOX', 'สินค้านี้ไม่ใช่กล่องสุ่ม');
  const user = data.users.find(item => String(item.id) === String(userId));
  if (!user || user.status === 'disabled' || user.status === 'banned') fail('USER_UNAVAILABLE', 'ไม่พบบัญชีผู้ใช้หรือบัญชีถูกระงับ');

  product.fulfillmentMode = 'automatic';
  product.fulfillmentInstructions = '';
  const orderId = genId(10);
  const createdAt = new Date(now).toISOString();
  const drawResults = [];
  const orderItems = [];
  let balance = Number(user.walletBalance);
  balance = Number.isFinite(balance) ? Math.max(0, Math.round(balance * 100) / 100) : 0;
  let total = 0;
  let balanceLimited = false;
  let priceChanged = false;
  let orderPrice = null;

  for (let index = 0; index < requestedDrawCount; index += 1) {
    let pool = pools[String(product.id)];
    if (pool && !poolRemainingStock(data, pool).length) {
      recordPoolHistory(data, pool, new Date(now).toISOString());
      delete pools[String(product.id)];
      pool = null;
    }
    if (!pool && availablePrizeStockCount(data, product) < 1) break;
    const nextPrice = pool?.price || configuredPrice(product);
    if (drawResults.length && orderPrice !== null && nextPrice !== orderPrice) {
      priceChanged = true;
      break;
    }
    if (balance < nextPrice) {
      if (!drawResults.length) fail('INSUFFICIENT_BALANCE', `ยอดเงินในกระเป๋าไม่เพียงพอ ต้องมีอย่างน้อย ฿${nextPrice.toLocaleString('th-TH')}`);
      balanceLimited = true;
      break;
    }
    if (!pool) {
      pool = createPool(data, product, now, randomInt, genId);
    }
    if (!pool) break;
    const price = pool.price;

    balance = Math.round((balance - price) * 100) / 100;
    total = Math.round((total + price) * 100) / 100;
    if (orderPrice === null) orderPrice = price;
    pool.totalDraws += 1;
    pool.totalCollected += price;
    let prizeItems = [];

    if (pool.phase === 'entry') {
      pool.entryProgressDraws += 1;
      if (pool.entryProgressDraws >= pool.entryTargetDraws) {
        const available = poolRemainingStock(data, pool).length;
        const awardCount = available <= 1 ? available : randomAwardCount(Math.min(available - 1, MAX_RANDOM_BOX_PRIZE_ITEMS), randomInt);
        prizeItems = takePrizeItems(data, pool, awardCount, product, orderId);
        pool.entryPrizeCount = prizeItems.length;
        pool.totalAwards += 1;
        pool.totalPrizeItems += prizeItems.length;
        if (poolRemainingStock(data, pool).length) beginRecovery(pool, poolRemainingStock(data, pool).length, randomInt);
      }
    } else {
      pool.recoveryProgressDraws += 1;
      const milestone = pool.recoveryMilestones[pool.recoveryMilestoneIndex];
      if (milestone && pool.recoveryProgressDraws >= milestone.atDraws) {
        prizeItems = takePrizeItems(data, pool, milestone.count, product, orderId);
        pool.recoveryMilestoneIndex += 1;
        pool.totalAwards += 1;
        pool.totalPrizeItems += prizeItems.length;
      }
    }

    const isWin = prizeItems.length > 0;
    const prizeName = isWin ? (prizeItems.length === 1 ? 'รางวัลกล่องสุ่ม 1 ชิ้น' : `รางวัลกล่องสุ่ม ${prizeItems.length} ชิ้น`) : null;
    const drawResult = {
      isWin,
      boxProductId: product.id,
      boxTitle: product.title,
      boxSlug: product.slug,
      prizeName,
      prizeItems,
      prizeCount: prizeItems.length,
      missMessage: isWin ? null : getMissMessage(product),
    };
    drawResults.push(drawResult);
    orderItems.push({
      productId: product.id,
      title: product.title,
      price,
      productImage: product.images?.[0] || '',
      stockItemId: prizeItems[0]?.stockItemId || null,
      fulfillmentMode: 'automatic',
      randomBoxDraw: drawResult,
    });

    if (!poolRemainingStock(data, pool).length) {
      recordPoolHistory(data, pool, new Date(now).toISOString());
      delete pools[String(product.id)];
    }
  }

  if (!drawResults.length) fail('NO_PRIZES', 'สต็อกรางวัลหมดชั่วคราว กรุณาลองใหม่ภายหลัง');
  user.walletBalance = balance;
  drawResults.forEach(draw => { draw.walletBalance = user.walletBalance; });
  const winResults = drawResults.filter(draw => draw.isWin);
  const missResults = drawResults.filter(draw => !draw.isWin);
  const prizeCount = winResults.reduce((sum, draw) => sum + draw.prizeCount, 0);
  const stockExhausted = drawResults.length < requestedDrawCount && !hasAvailablePrizeBundle(data, product);
  const result = {
    ...(drawResults.length === 1 ? drawResults[0] : {}),
    isWin: winResults.length > 0,
    drawCount: drawResults.length,
    requestedDrawCount,
    winCount: winResults.length,
    prizeCount,
    missCount: missResults.length,
    missMessage: missResults[0]?.missMessage || null,
    stockExhausted,
    balanceLimited,
    priceChanged,
    total,
    prizeName: winResults[0]?.prizeName || null,
    prizeNames: winResults.map(draw => draw.prizeName),
    walletBalance: user.walletBalance,
  };
  const order = {
    id: orderId,
    userId: user.id,
    items: orderItems,
    subtotal: total,
    discount: 0,
    total,
    couponCode: null,
    status: 'completed',
    paymentMethod: 'wallet',
    createdAt,
    salesChannel: 'direct',
    federatedTenantIds: [],
    randomBoxOrder: true,
    randomBoxRequestedDrawCount: requestedDrawCount,
    randomBoxRequestId: idempotencyKey,
  };
  data.orders.push(order);
  data.walletTransactions.push({
    id: genId(10),
    userId: user.id,
    type: 'random_box_draw',
    amount: -total,
    note: `เปิดกล่องสุ่ม ${product.title} ${drawResults.length} ครั้ง · คำสั่งซื้อ #${orderId}`,
    orderId,
    productId: product.id,
    idempotencyKey,
    randomBoxResult: result,
    createdAt,
  });
  return { orderId, result, replay: false };
}

module.exports = {
  RANDOM_BOX_KIND,
  RANDOM_BOX_PRICE,
  RANDOM_BOX_MIN_TARGET,
  RANDOM_BOX_MAX_TARGET,
  MAX_RANDOM_BOX_PRIZE_ITEMS,
  RANDOM_BOX_MIN_RATE,
  RANDOM_BOX_MAX_RATE,
  MAX_RANDOM_BOX_DRAWS,
  MAX_RANDOM_BOX_PRICE,
  MAX_RANDOM_BOX_STOCK,
  DEFAULT_RANDOM_BOX_RATE,
  DEFAULT_MISS_MESSAGE,
  MAX_MISS_MESSAGE_LENGTH,
  supportsRandomBox,
  randomTarget,
  normalizeRate,
  getRateConfig,
  parseRate,
  parsePrice,
  validatePrice,
  configuredPrice,
  normalizeMissMessage,
  getStockPrizeName,
  validateRate,
  parseDrawCount,
  stockItemsOldestFirst,
  availableStockItems,
  availableStockCount,
  getActivePool,
  getDrawPrice,
  getPoolSummary,
  availablePrizeStockCount,
  hasAvailablePrizeBundle,
  deletePrizeStock,
  releaseRoundPrizeReservation,
  buildRecoveryAwardCounts,
  buildRecoveryMilestones,
  isPublished,
  drawRandomBox,
};
