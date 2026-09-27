const crypto = require('crypto');

const RANDOM_BOX_KIND = 'random-box';
const RANDOM_BOX_PRICE = 1;
const RANDOM_BOX_MIN_RATE = 0.01;
const RANDOM_BOX_MAX_RATE = 100;
const DEFAULT_RANDOM_BOX_RATE = 1;
const RANDOM_BOX_MIN_TARGET = 85;
const RANDOM_BOX_MAX_TARGET = 110;

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

function drawRandomBox(data, {
  productId,
  userId,
  idempotencyKey,
  now = Date.now(),
  randomInt = crypto.randomInt,
  genId = length => crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length),
}) {
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
  if (balance < RANDOM_BOX_PRICE) fail('INSUFFICIENT_BALANCE', 'ยอดเงินในกระเป๋าไม่เพียงพอ ต้องมีอย่างน้อย 1 บาท');

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

  const progressBefore = Math.max(0, Math.floor(Number(round.progress) || 0));
  const progressAfter = progressBefore + 1;
  const roundNumber = Math.max(1, Math.floor(Number(round.roundNumber) || 1));
  const target = Number(round.target);
  const isWin = progressAfter >= target;
  const orderId = genId(10);
  const createdAt = new Date(now).toISOString();
  let prizeName = null;
  let prizeStockItem = null;

  if (isWin) {
    const selectedIndex = randomInt(0, prizeStockItems.length);
    const safeIndex = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < prizeStockItems.length
      ? selectedIndex
      : 0;
    prizeStockItem = prizeStockItems[safeIndex];
    const legacyPrize = (product.randomBox?.prizes || []).find(item => String(item.id) === String(prizeStockItem.randomBoxPrizeId));
    prizeName = String(legacyPrize?.name || 'คีย์/ไอดี 1 ชิ้น').trim().slice(0, 120);
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

  user.walletBalance = Math.round((balance - RANDOM_BOX_PRICE) * 100) / 100;
  const result = {
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
    walletBalance: user.walletBalance,
  };

  const orderItems = [{
    productId: product.id,
    title: product.title,
    price: RANDOM_BOX_PRICE,
    productImage: product.images?.[0] || '',
    stockItemId: prizeStockItem?.id || null,
    fulfillmentMode: 'automatic',
    randomBoxDraw: result,
  }];
  const order = {
    id: orderId,
    userId: user.id,
    items: orderItems,
    subtotal: RANDOM_BOX_PRICE,
    discount: 0,
    total: RANDOM_BOX_PRICE,
    couponCode: null,
    status: 'completed',
    paymentMethod: 'wallet',
    createdAt,
    salesChannel: 'direct',
    federatedTenantIds: [],
    randomBoxOrder: true,
    randomBoxRequestId: idempotencyKey,
  };
  data.orders.push(order);
  data.walletTransactions.push({
    id: genId(10),
    userId: user.id,
    type: 'random_box_draw',
    amount: -RANDOM_BOX_PRICE,
    note: `เปิดกล่องสุ่ม ${product.title} · คำสั่งซื้อ #${orderId}`,
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
  DEFAULT_RANDOM_BOX_RATE,
  supportsRandomBox,
  randomTarget,
  normalizeRate,
  getRateConfig,
  parseRate,
  validateRate,
  availableStockItems,
  availableStockCount,
  isPublished,
  drawRandomBox,
};
