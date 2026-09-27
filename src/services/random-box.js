const crypto = require('crypto');

const RANDOM_BOX_KIND = 'random-box';
const RANDOM_BOX_PRICE = 1;
const RANDOM_BOX_RATE_CONFIGS = Object.freeze({
  1: Object.freeze({ rate: 1, missPercent: 99, minTarget: 85, maxTarget: 110 }),
  2: Object.freeze({ rate: 2, missPercent: 98, minTarget: 45, maxTarget: 60 }),
});
const DEFAULT_RANDOM_BOX_RATE = 1;
const RANDOM_BOX_MIN_TARGET = RANDOM_BOX_RATE_CONFIGS[DEFAULT_RANDOM_BOX_RATE].minTarget;
const RANDOM_BOX_MAX_TARGET = RANDOM_BOX_RATE_CONFIGS[DEFAULT_RANDOM_BOX_RATE].maxTarget;
const RANDOM_BOX_MAX_PRIZES = 30;

function supportsRandomBox(req) {
  if (!req || !req.tenantShop) return true;
  return String(req.tenantShop.slug || '').trim().toLowerCase() === 'bank-shop';
}

function normalizeRate(rate) {
  const value = Number(rate);
  return RANDOM_BOX_RATE_CONFIGS[value] ? value : DEFAULT_RANDOM_BOX_RATE;
}

function getRateConfig(rate) {
  return RANDOM_BOX_RATE_CONFIGS[normalizeRate(rate)];
}

function randomTarget(randomInt = crypto.randomInt, rate = DEFAULT_RANDOM_BOX_RATE) {
  const config = getRateConfig(rate);
  return randomInt(config.minTarget, config.maxTarget + 1);
}

function formValues(value) {
  return Array.isArray(value) ? value : (value === undefined ? [] : [value]);
}

function parsePrizeRows(body = {}, genId = () => crypto.randomBytes(5).toString('hex')) {
  const ids = formValues(body.randomBoxPrizeId);
  const names = formValues(body.randomBoxPrizeName);
  const percents = formValues(body.randomBoxPrizePercent);
  return names.map((rawName, index) => {
    const name = String(rawName || '').trim();
    const percent = Number(String(percents[index] ?? '').trim());
    return {
      id: String(ids[index] || genId()).slice(0, 40),
      name: name.slice(0, 120),
      percent,
      active: true,
    };
  }).filter(prize => prize.name || prize.percent);
}

function validatePrizeRows(prizes) {
  if (!Array.isArray(prizes) || prizes.length < 1) return 'เพิ่มรายการรางวัลอย่างน้อย 1 รายการ';
  if (prizes.length > RANDOM_BOX_MAX_PRIZES) return `กล่องสุ่มเพิ่มรางวัลได้ไม่เกิน ${RANDOM_BOX_MAX_PRIZES} รายการ`;
  for (const prize of prizes) {
    if (!prize.name) return 'กรอกชื่อรางวัลให้ครบทุกแถว';
    if (!Number.isFinite(prize.percent) || prize.percent <= 0 || prize.percent > 100) return 'โอกาสของรางวัลต้องมากกว่า 0 และไม่เกิน 100%';
    if (Math.abs(prize.percent * 100 - Math.round(prize.percent * 100)) > 1e-8) return 'เปอร์เซ็นต์ของรางวัลใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง';
  }
  const percentHundredths = prizes.reduce((sum, prize) => sum + Math.round(prize.percent * 100), 0);
  if (percentHundredths !== 10000) return 'เปอร์เซ็นต์รางวัลรวมกันต้องเท่ากับ 100%';
  return null;
}

function parseRate(body = {}) {
  return normalizeRate(body.randomBoxRate);
}

function availablePrizePool(randomBox, stockItems = [], productId = null) {
  const stockCounts = new Map();
  stockItems.filter(item => item && item.status === 'available'
    && (productId === null || String(item.productId) === String(productId))
    && item.randomBoxPrizeId)
    .forEach(item => stockCounts.set(String(item.randomBoxPrizeId), (stockCounts.get(String(item.randomBoxPrizeId)) || 0) + 1));
  const prizes = (Array.isArray(randomBox?.prizes) ? randomBox.prizes : [])
    .filter(prize => prize && prize.active !== false && String(prize.name || '').trim()
      && Number.isFinite(Number(prize.percent)) && Number(prize.percent) > 0
      && (stockCounts.get(String(prize.id)) || 0) > 0)
    .map(prize => ({ ...prize, stockCount: stockCounts.get(String(prize.id)) || 0 }));
  const total = prizes.reduce((sum, prize) => sum + Math.round(Number(prize.percent) * 100), 0);
  if (!total) return [];
  return prizes.map(prize => ({
    ...prize,
    publicPercent: (Math.round(Number(prize.percent) * 100) / total) * 100,
  }));
}

function pickPrize(prizes, randomInt = crypto.randomInt) {
  const pool = Array.isArray(prizes) ? prizes : [];
  const total = pool.reduce((sum, prize) => sum + Math.round(Number(prize.percent) * 100), 0);
  if (!total) return null;
  let roll = randomInt(0, total);
  for (const prize of pool) {
    roll -= Math.round(Number(prize.percent) * 100);
    if (roll < 0) return prize;
  }
  return pool[pool.length - 1] || null;
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
  const prizePool = availablePrizePool(product.randomBox, data.stockItems, product.id);
  if (!prizePool.length) fail('NO_PRIZES', 'รางวัลหมดชั่วคราว กรุณาลองใหม่ภายหลัง');

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
  let prize = null;
  let prizeStockItem = null;

  if (isWin) {
    prize = pickPrize(prizePool, randomInt);
    if (!prize) fail('NO_PRIZES', 'รางวัลหมดชั่วคราว กรุณาลองใหม่ภายหลัง');
    prizeStockItem = data.stockItems.find(item => item.productId === product.id
      && String(item.randomBoxPrizeId) === String(prize.id) && item.status === 'available');
    if (!prizeStockItem) fail('NO_PRIZES', 'คีย์/ไอดีของรางวัลหมดแล้ว กรุณาลองใหม่ภายหลัง');
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
    rate,
    missPercent: rateConfig.missPercent,
    nextRoundProgress: Number(round.progress) || 0,
    nextRoundTarget: Number(round.target),
    prizeName: prize?.name || null,
    prizePercent: prize ? Number(prize.publicPercent.toFixed(2)) : null,
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
  RANDOM_BOX_RATE_CONFIGS,
  DEFAULT_RANDOM_BOX_RATE,
  RANDOM_BOX_MAX_PRIZES,
  supportsRandomBox,
  randomTarget,
  normalizeRate,
  getRateConfig,
  parseRate,
  parsePrizeRows,
  validatePrizeRows,
  availablePrizePool,
  pickPrize,
  isPublished,
  drawRandomBox,
};
