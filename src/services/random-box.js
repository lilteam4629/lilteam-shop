const crypto = require('crypto');
const { effectivePrice } = require('./pricing');

const RANDOM_BOX_KIND = 'random-box';
const RANDOM_BOX_PRICE = 1;
const RANDOM_BOX_MIN_RATE = 0.01;
const RANDOM_BOX_MAX_RATE = 100;
const MAX_RANDOM_BOX_DRAWS = 500;
const DEFAULT_RANDOM_BOX_RATE = 1;
const RANDOM_BOX_MIN_TARGET = 85;
const RANDOM_BOX_MAX_TARGET = 110;
const RANDOM_BOX_MIN_PRIZE_VALUE = 85;
const RANDOM_BOX_MAX_PRIZE_VALUE = 110;
const MAX_RANDOM_BOX_PRIZE_ITEMS = 5;
const RANDOM_BOX_VALUE_CENTS = RANDOM_BOX_MAX_PRIZE_VALUE * 100;
const DEFAULT_MISS_MESSAGE = 'ยังไม่ได้รับรางวัลในครั้งนี้';
const MAX_MISS_MESSAGE_LENGTH = 300;

function normalizeMissMessage(message) {
  return String(message ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_MISS_MESSAGE_LENGTH);
}

function getMissMessage(product) {
  return normalizeMissMessage(product?.randomBox?.missMessage) || DEFAULT_MISS_MESSAGE;
}

function getStockPrizeName(stockItem) {
  return [stockItem?.username, stockItem?.password, stockItem?.extra]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join(':') || 'คีย์/ไอดี 1 ชิ้น';
}

function supportsRandomBox(req) {
  if (!req || !req.tenantShop) return true;
  return false;
}

function normalizeRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value < RANDOM_BOX_MIN_RATE || value > RANDOM_BOX_MAX_RATE) return DEFAULT_RANDOM_BOX_RATE;
  return Math.round(value * 100) / 100;
}

function getRateConfig(rate) {
  const normalizedRate = normalizeRate(rate);
  const minTarget = normalizedRate === 100 ? 1 : Math.max(1, Math.ceil((85 / normalizedRate) / 5) * 5);
  const maxTarget = normalizedRate === 100 ? 1 : Math.max(minTarget, Math.ceil((110 / normalizedRate) / 10) * 10);
  return {
    rate: normalizedRate,
    missPercent: Math.round((100 - normalizedRate) * 100) / 100,
    minTarget,
    maxTarget,
  };
}

function randomTarget(randomInt = crypto.randomInt, rate = DEFAULT_RANDOM_BOX_RATE) {
  const config = getRateConfig(rate);
  return randomInt(config.minTarget, config.maxTarget + 1);
}

function parseRate(body = {}) {
  return normalizeRate(body.randomBoxRate);
}

function validateRate(rate) {
  const raw = String(rate == null ? '' : rate).trim();
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < RANDOM_BOX_MIN_RATE || value > RANDOM_BOX_MAX_RATE) {
    return `เรทการออกรางวัลต้องอยู่ระหว่าง ${RANDOM_BOX_MIN_RATE}–${RANDOM_BOX_MAX_RATE}%`;
  }
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) return 'เรทการออกรางวัลใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง';
  return null;
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

function shuffle(items, randomInt = crypto.randomInt) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function isPublished(product, now) {
  if (!product || product.status !== 'active') return false;
  if (!product.publishAt) return true;
  const value = String(product.publishAt);
  const time = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}:00+07:00`);
  return Number.isFinite(time) && time <= now;
}

function eligiblePrizeInventory(data, boxProduct, now = Date.now(), randomInt = crypto.randomInt) {
  const productsById = new Map((Array.isArray(data?.products) ? data.products : [])
    .map(product => [String(product?.id), product]));
  const priceGroups = new Map();
  const legacyItems = [];
  let eligibleStockCount = 0;

  for (const stockItem of Array.isArray(data?.stockItems) ? data.stockItems : []) {
    if (!stockItem || stockItem.status !== 'available' || stockItem.fulfillmentMode === 'contact') continue;
    const productId = String(stockItem.productId || '');
    if (productId === String(boxProduct?.id)) {
      // Older boxes may still have keys entered directly in their own stock.
      // Keep each as a standalone legacy award while new awards use priced products.
      legacyItems.push({
        productId,
        productTitle: getStockPrizeName(stockItem),
        productImage: '',
        price: 100,
        priceCents: 100 * 100,
        stockItem,
        legacy: true,
      });
      eligibleStockCount += 1;
      continue;
    }

    const product = productsById.get(productId);
    if (!product || product.specialType === RANDOM_BOX_KIND || product.fulfillmentMode === 'contact'
      || !isPublished(product, now)) continue;
    const price = effectivePrice(product, now);
    if (!Number.isFinite(price) || price <= 0) continue;
    const priceCents = Math.round(price * 100);
    if (priceCents > RANDOM_BOX_VALUE_CENTS) continue;

    eligibleStockCount += 1;
    if (!priceGroups.has(priceCents)) priceGroups.set(priceCents, []);
    priceGroups.get(priceCents).push({
      productId: product.id,
      productTitle: product.title || 'สินค้า',
      productImage: product.images?.find(Boolean) || '',
      price: Math.round(priceCents) / 100,
      priceCents,
      stockItem,
      legacy: false,
    });
  }

  const legacyById = new Map(legacyItems.map(item => [String(item.stockItem?.id), item]));
  const newestLegacyFirst = availableStockItems(data?.stockItems, boxProduct?.id).reverse()
    .map(item => legacyById.get(String(item.id))).filter(Boolean);

  // A bundle can contain at most five items, so retaining five random stock
  // rows per identical price keeps the search bounded without changing which
  // bundle sizes or totals are possible.
  const candidates = [];
  for (const rows of priceGroups.values()) candidates.push(...shuffle(rows, randomInt).slice(0, MAX_RANDOM_BOX_PRIZE_ITEMS));
  return {
    candidates: shuffle(candidates, randomInt),
    legacyItems: newestLegacyFirst,
    eligibleStockCount,
  };
}

function buildPrizeBundle(candidates, legacyItems = [], randomInt = crypto.randomInt) {
  const maxCents = RANDOM_BOX_VALUE_CENTS;
  const dp = Array.from({ length: MAX_RANDOM_BOX_PRIZE_ITEMS + 1 }, () => Array(maxCents + 1).fill(null));
  dp[0][0] = [];

  for (const candidate of candidates) {
    const value = candidate.priceCents;
    if (!Number.isInteger(value) || value < 1 || value > maxCents) continue;
    for (let count = MAX_RANDOM_BOX_PRIZE_ITEMS; count >= 1; count -= 1) {
      for (let total = maxCents; total >= value; total -= 1) {
        if (dp[count][total] === null && dp[count - 1][total - value] !== null) {
          dp[count][total] = [...dp[count - 1][total - value], candidate];
        }
      }
    }
  }

  const feasibleByCount = Array.from({ length: MAX_RANDOM_BOX_PRIZE_ITEMS + 1 }, () => []);
  for (let count = 1; count <= MAX_RANDOM_BOX_PRIZE_ITEMS; count += 1) {
    for (let total = RANDOM_BOX_MIN_PRIZE_VALUE * 100; total <= maxCents; total += 1) {
      if (dp[count][total] !== null) feasibleByCount[count].push({ count, total, items: dp[count][total] });
    }
  }
  // Keep existing manually entered box stock usable as a single-item award.
  // It has no catalog price, so it must not be combined with priced stock.
  legacyItems.forEach(item => feasibleByCount[1].push({ count: 1, total: item.priceCents, items: [item] }));
  const availableCounts = feasibleByCount.map((items, count) => items.length ? count : null).filter(count => count !== null);
  if (!availableCounts.length) return null;
  const count = availableCounts[randomInt(0, availableCounts.length)];
  const options = feasibleByCount[count];
  return options[randomInt(0, options.length)];
}

function availablePrizeStockCount(data, boxProduct, now = Date.now()) {
  return eligiblePrizeInventory(data, boxProduct, now).eligibleStockCount;
}

function hasAvailablePrizeBundle(data, boxProduct, now = Date.now()) {
  if (!boxProduct) return false;
  const deterministicRandom = min => min;
  const inventory = eligiblePrizeInventory(data, boxProduct, now, deterministicRandom);
  return Boolean(buildPrizeBundle(inventory.candidates, inventory.legacyItems, deterministicRandom));
}

function selectPrizeBundle(data, boxProduct, now = Date.now(), randomInt = crypto.randomInt) {
  const inventory = eligiblePrizeInventory(data, boxProduct, now, randomInt);
  return buildPrizeBundle(inventory.candidates, inventory.legacyItems, randomInt);
}

function formatPrizeName(prizeItems) {
  const counts = new Map();
  prizeItems.forEach(item => {
    const key = `${item.productId}\u0000${item.productTitle}`;
    const current = counts.get(key) || { title: item.productTitle, count: 0 };
    current.count += 1;
    counts.set(key, current);
  });
  return [...counts.values()].map(item => item.count > 1 ? `${item.title} ×${item.count}` : item.title).join(' · ');
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseDrawCount(value = 1) {
  const raw = String(value == null ? '' : value).trim();
  const count = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(count) || count < 1 || count > MAX_RANDOM_BOX_DRAWS) {
    fail('INVALID_DRAW_COUNT', `เลือกจำนวนเปิดกล่องได้ตั้งแต่ 1 ถึง ${MAX_RANDOM_BOX_DRAWS} ครั้ง`);
  }
  return count;
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
  data.randomBoxRounds ||= {};

  const previous = data.walletTransactions.find(transaction => transaction.type === 'random_box_draw'
    && String(transaction.userId) === String(userId)
    && String(transaction.productId) === String(productId)
    && transaction.idempotencyKey === idempotencyKey);
  if (previous?.orderId) return { orderId: previous.orderId, result: previous.randomBoxResult, replay: true };

  const product = data.products.find(item => String(item.id) === String(productId));
  if (!isPublished(product, now)) fail('PRODUCT_UNAVAILABLE', 'กล่องสุ่มนี้ยังไม่เปิดขายหรือปิดการขายแล้ว');
  if (product.specialType !== RANDOM_BOX_KIND) fail('NOT_RANDOM_BOX', 'สินค้านี้ไม่ใช่กล่องสุ่ม');
  product.fulfillmentMode = 'automatic';
  product.fulfillmentInstructions = '';
  let nextPrizeBundle = selectPrizeBundle(data, product, now, randomInt);
  if (!nextPrizeBundle) fail('NO_PRIZES', 'สต็อกของรางวัลยังไม่พร้อม กรุณาลองใหม่ภายหลัง');

  const user = data.users.find(item => String(item.id) === String(userId));
  if (!user || user.status === 'disabled' || user.status === 'banned') fail('USER_UNAVAILABLE', 'ไม่พบบัญชีผู้ใช้หรือบัญชีถูกระงับ');
  const storedBalance = Number(user.walletBalance);
  const balance = Number.isFinite(storedBalance) ? Math.round(storedBalance * 100) / 100 : 0;
  const requestedTotal = requestedDrawCount * RANDOM_BOX_PRICE;
  if (balance < requestedTotal) {
    fail('INSUFFICIENT_BALANCE', `ยอดเงินในกระเป๋าไม่เพียงพอ ต้องมีอย่างน้อย ${requestedTotal.toLocaleString('th-TH')} บาท`);
  }

  const rounds = data.randomBoxRounds;
  const rateConfig = getRateConfig(product.randomBox?.rate);
  const rate = rateConfig.rate;
  let round = rounds[String(product.id)];
  const roundRate = normalizeRate(round?.rate);
  if (!round || !Number.isInteger(Number(round.target)) || roundRate !== rate
    || Number(round.target) < rateConfig.minTarget || Number(round.target) > rateConfig.maxTarget) {
    round = rounds[String(product.id)] = {
      progress: 0,
      target: randomTarget(randomInt, rate),
      rate,
      roundNumber: Math.max(1, Number(round?.roundNumber) || 1),
      totalDraws: Math.max(0, Number(round?.totalDraws) || 0),
      totalAwards: Math.max(0, Number(round?.totalAwards) || 0),
    };
  }

  const orderId = genId(10);
  const createdAt = new Date(now).toISOString();
  const drawResults = [];
  const orderItems = [];

  for (let index = 0; index < requestedDrawCount; index += 1) {
    if (!nextPrizeBundle) break;

    const progressBefore = Math.max(0, Math.floor(Number(round.progress) || 0));
    const progressAfter = progressBefore + 1;
    const roundNumber = Math.max(1, Math.floor(Number(round.roundNumber) || 1));
    const target = Number(round.target);
    const isWin = progressAfter >= target;
    let prizeName = null;
    let prizeBundle = null;
    let prizeItems = [];

    if (isWin) {
      prizeBundle = nextPrizeBundle;
      if (!prizeBundle) fail('NO_PRIZES', 'สต็อกของรางวัลยังไม่พร้อม กรุณาลองใหม่ภายหลัง');
      prizeItems = prizeBundle.items.map(item => {
        item.stockItem.status = 'sold';
        item.stockItem.soldOrderId = orderId;
        return {
          productId: item.productId,
          productTitle: item.productTitle,
          productImage: item.productImage,
          price: item.price,
          stockItemId: item.stockItem.id,
        };
      });
      prizeName = formatPrizeName(prizeItems);
      round.progress = 0;
      round.target = randomTarget(randomInt, rate);
      round.rate = rate;
      round.roundNumber = roundNumber + 1;
      round.totalAwards = (Number(round.totalAwards) || 0) + 1;
      nextPrizeBundle = selectPrizeBundle(data, product, now, randomInt);
    } else {
      round.progress = progressAfter;
    }
    round.totalDraws = (Number(round.totalDraws) || 0) + 1;

    const drawResult = {
      isWin,
      boxProductId: product.id,
      boxTitle: product.title,
      boxSlug: product.slug,
      roundNumber,
      roundProgress: progressAfter,
      roundTarget: target,
      nextRoundProgress: Number(round.progress) || 0,
      nextRoundTarget: Number(round.target),
      prizeName,
      prizeItems: isWin ? prizeItems : [],
      prizeCount: prizeItems.length,
      prizeValue: prizeBundle ? prizeBundle.total / 100 : 0,
      missMessage: isWin ? null : getMissMessage(product),
    };
    drawResults.push(drawResult);
    orderItems.push({
      productId: product.id,
      title: product.title,
      price: RANDOM_BOX_PRICE,
      productImage: product.images?.[0] || '',
      stockItemId: prizeItems[0]?.stockItemId || null,
      fulfillmentMode: 'automatic',
      randomBoxDraw: drawResult,
    });
  }

  if (!drawResults.length) fail('NO_PRIZES', 'สต็อกของรางวัลหมดชั่วคราว กรุณาลองใหม่ภายหลัง');
  const drawTotal = drawResults.length * RANDOM_BOX_PRICE;
  user.walletBalance = Math.round((balance - drawTotal) * 100) / 100;
  drawResults.forEach(draw => { draw.walletBalance = user.walletBalance; });
  const winResults = drawResults.filter(draw => draw.isWin);
  const missResults = drawResults.filter(draw => !draw.isWin);
  const prizeCount = winResults.reduce((sum, draw) => sum + (Number(draw.prizeCount) || 0), 0);
  const result = {
    ...(drawResults.length === 1 ? drawResults[0] : {}),
    isWin: winResults.length > 0,
    drawCount: drawResults.length,
    requestedDrawCount,
    winCount: winResults.length,
    prizeCount,
    missCount: missResults.length,
    missMessage: missResults[0]?.missMessage || null,
    stockExhausted: drawResults.length < requestedDrawCount,
    total: drawTotal,
    prizeName: winResults[0]?.prizeName || null,
    prizeNames: winResults.map(draw => draw.prizeName),
    walletBalance: user.walletBalance,
  };
  const order = {
    id: orderId,
    userId: user.id,
    items: orderItems,
    subtotal: drawTotal,
    discount: 0,
    total: drawTotal,
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
    amount: -drawTotal,
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
  RANDOM_BOX_MIN_PRIZE_VALUE,
  RANDOM_BOX_MAX_PRIZE_VALUE,
  MAX_RANDOM_BOX_PRIZE_ITEMS,
  RANDOM_BOX_MIN_RATE,
  RANDOM_BOX_MAX_RATE,
  MAX_RANDOM_BOX_DRAWS,
  DEFAULT_RANDOM_BOX_RATE,
  DEFAULT_MISS_MESSAGE,
  MAX_MISS_MESSAGE_LENGTH,
  supportsRandomBox,
  randomTarget,
  normalizeRate,
  getRateConfig,
  parseRate,
  normalizeMissMessage,
  validateRate,
  parseDrawCount,
  stockItemsOldestFirst,
  availableStockItems,
  availableStockCount,
  eligiblePrizeInventory,
  availablePrizeStockCount,
  buildPrizeBundle,
  hasAvailablePrizeBundle,
  selectPrizeBundle,
  isPublished,
  drawRandomBox,
};
