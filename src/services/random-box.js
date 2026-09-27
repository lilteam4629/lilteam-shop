const crypto = require('crypto');

const RANDOM_BOX_KIND = 'random-box';
const RANDOM_BOX_PRICE = 1;
const RANDOM_BOX_MIN_RATE = 0.01;
const RANDOM_BOX_MAX_RATE = 100;
const MAX_RANDOM_BOX_DRAWS = 100;
const DEFAULT_RANDOM_BOX_RATE = 1;
const RANDOM_BOX_MIN_TARGET = 85;
const RANDOM_BOX_MAX_TARGET = 110;
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

function availableStockItems(stockItems = [], productId = null) {
  if (!Array.isArray(stockItems)) return [];
  return stockItems.filter(item => item && item.status === 'available'
    && (productId === null || String(item.productId) === String(productId)));
}

function availableStockCount(stockItems = [], productId = null) {
  return availableStockItems(stockItems, productId).length;
}

function isPublished(product, now) {
  if (!product || product.status !== 'active') return false;
  if (!product.publishAt) return true;
  const value = String(product.publishAt);
  const time = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}:00+07:00`);
  return Number.isFinite(time) && time <= now;
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
  const prizeStockItems = availableStockItems(data.stockItems, product.id);
  if (!prizeStockItems.length) fail('NO_PRIZES', 'สต็อกของรางวัลหมดชั่วคราว กรุณาลองใหม่ภายหลัง');

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
    const availablePrizes = availableStockItems(data.stockItems, product.id);
    if (!availablePrizes.length) break;

    const progressBefore = Math.max(0, Math.floor(Number(round.progress) || 0));
    const progressAfter = progressBefore + 1;
    const roundNumber = Math.max(1, Math.floor(Number(round.roundNumber) || 1));
    const target = Number(round.target);
    const isWin = progressAfter >= target;
    let prizeName = null;
    let prizeStockItem = null;

    if (isWin) {
      const selectedIndex = randomInt(0, availablePrizes.length);
      const safeIndex = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < availablePrizes.length
        ? selectedIndex
        : 0;
      prizeStockItem = availablePrizes[safeIndex];
      prizeName = getStockPrizeName(prizeStockItem);
      prizeStockItem.status = 'sold';
      prizeStockItem.soldOrderId = orderId;
      round.progress = 0;
      round.target = randomTarget(randomInt, rate);
      round.rate = rate;
      round.roundNumber = roundNumber + 1;
      round.totalAwards = (Number(round.totalAwards) || 0) + 1;
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
      missMessage: isWin ? null : getMissMessage(product),
    };
    drawResults.push(drawResult);
    orderItems.push({
      productId: product.id,
      title: product.title,
      price: RANDOM_BOX_PRICE,
      productImage: product.images?.[0] || '',
      stockItemId: prizeStockItem?.id || null,
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
  const result = {
    ...(drawResults.length === 1 ? drawResults[0] : {}),
    isWin: winResults.length > 0,
    drawCount: drawResults.length,
    requestedDrawCount,
    winCount: winResults.length,
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
  availableStockItems,
  availableStockCount,
  isPublished,
  drawRandomBox,
};
