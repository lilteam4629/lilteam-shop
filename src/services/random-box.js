const crypto = require('crypto');
const gacha = require('./gacha');
const RANDOM_BOX_KIND = 'random-box';
const RANDOM_BOX_PRICE = 1;
const RANDOM_BOX_MIN_RATE = 1;
const RANDOM_BOX_MAX_RATE = 1;
const MAX_RANDOM_BOX_DRAWS = 500;
const MAX_RANDOM_BOX_PRICE = 1;
const MAX_RANDOM_BOX_STOCK = 50000;
const DEFAULT_RANDOM_BOX_RATE = 1;
const RANDOM_BOX_MIN_TARGET = 85;
const RANDOM_BOX_MAX_TARGET = 110;
const MAX_RANDOM_BOX_PRIZE_ITEMS = 5;
const DEFAULT_MISS_MESSAGE = 'ยังไม่ได้รับรางวัลในครั้งนี้';
const MAX_MISS_MESSAGE_LENGTH = 300;
const PENDING_SYSTEM_MESSAGE = 'รอทำระบบเพิ่ม';

function normalizeRate() { return 1; }
function getRateConfig() { return { rate: 1, minTarget: 85, maxTarget: 110, targetRevenue: 97.50, pityLimit: 110 }; }
function parseRate() { return 1; }
function validateRate(value) { return String(value ?? '').trim() && Number(value) === 1 ? null : 'การตั้งค่ากล่องสุ่มไม่ถูกต้อง'; }
function parsePrice(value) { return String(value ?? '').trim() && Number(value) === 1 ? 1 : null; }
function validatePrice(value) { return parsePrice(value) === 1 ? null : 'ราคากล่องสุ่มต้องเป็น 1 บาทเท่านั้น · รอทำระบบเพิ่ม'; }
function configuredPrice() { return 1; }
function getDrawPrice() { return 1; }
function randomTarget(rng = crypto.randomInt) { return rng(85, 111); }
function randomAwardCount(remaining, rng = crypto.randomInt) {
  let count = Math.min(1, Math.max(0, remaining));
  while (count < Math.min(5, remaining) && rng(0, 5) < 2) count++;
  return count;
}

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

function supportsRandomBox() {
  // Request-scoped store.data is resolved to the current tenant by
  // tenantResolver. Random-box products, stock, draws, and orders therefore
  // stay inside that shop's own database just like regular products.
  return true;
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


function isPublished(product, now) {
  if (!product || product.status !== 'active') return false;
  if (!product.publishAt) return true;
  const value = String(product.publishAt);
  const time = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}:00+07:00`);
  return Number.isFinite(time) && time <= now;
}


function getActivePool(data, productId) { return data.randomBoxPools?.[String(productId)] || null; }
function availablePrizeStockCount(data, product) {
  if (!product) return 0;
  const legacy = getActivePool(data, product.id);
  return (data.stockItems || []).filter(stock => String(stock.productId) === String(product.id)
    && (stock.status === 'available' || (stock.status === 'reserved'
      && (String(stock.randomBoxReservedFor) === String(product.id)
        || (legacy && String(stock.randomBoxPoolId) === String(legacy.id)))))).length;
}
function hasAvailablePrizeBundle(data, product) { return availablePrizeStockCount(data, product) > 0; }
function getPoolSummary(data, product) {
  const state = data.randomBoxGachaStates?.[String(product?.id)];
  if (!state) return null;
  return { phase: 'random', remainingCount: availablePrizeStockCount(data, product),
    totalCollected: state.totalCollectedCents / 100, totalPrizeItems: state.totalPrizeItems,
    drySpend: state.drySpendCents / 100, targetRevenue: 97.50 };
}

// Read-only readiness check: expose a bounded code, never accounting/credentials.
function getDrawHealth(data, product) {
  try {
    gacha.quote({ poolId: String(product.id), state: data.randomBoxGachaStates?.[String(product.id)],
      stock: availableStockItems(data.stockItems, product.id).map(item => ({ stockId: String(item.id), status: 'available' })) });
    return 'READY';
  } catch (error) {
    if (['NO_STOCK', 'INVALID_POOL_STATE', 'ACCOUNTING_LIMIT'].includes(error.message)) return error.message;
    if (/totalCollectedCents|totalPrizeItems|drySpendCents/.test(error.message)) return 'INVALID_POOL_STATE';
    return 'INVALID_STOCK';
  }
}

const readinessCache = new WeakMap();
async function getPersistedDrawHealth(store, product) {
  const target = store.data;
  let entries = readinessCache.get(target);
  if (!entries) { entries = new Map(); readinessCache.set(target, entries); }
  const key = String(product.id);
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const result = inspectPersistedDrawHealth(store, product);
  entries.set(key, { expiresAt: Date.now() + 60000, result });
  return result;
}

async function inspectPersistedDrawHealth(store, product) {
  try {
    return await store.previewTransaction((data, metadata) => {
      const savedProduct = data.products.find(item => String(item.id) === String(product.id));
      if (!savedProduct) return 'PRODUCT_UNAVAILABLE';
      const readiness = getDrawHealth(data, savedProduct);
      if (readiness !== 'READY') return readiness;
      // Synthetic buyer and deterministic rolls operate only on the discarded snapshot.
      const buyerId = 'random-box-readiness-preview';
      data.users.push({ id: buyerId, status: 'active', walletBalance: MAX_RANDOM_BOX_DRAWS });
      drawRandomBox(data, { productId: savedProduct.id, userId: buyerId,
        idempotencyKey: 'random-box-readiness-preview', drawCount: MAX_RANDOM_BOX_DRAWS,
        randomInt: (min, max) => max - 1, genId: () => buyerId });
      return metadata.legacyRevision ? 'READY_LEGACY_REVISION' : 'READY';
    });
  } catch (error) {
    const codes = ['STORE_UNAVAILABLE', 'INVALID_STORE_REVISION', 'STORE_SIZE_LIMIT', 'INVALID_POOL_STATE', 'ACCOUNTING_LIMIT'];
    if (codes.includes(error.message)) return error.message;
    if (error.code && ['PRODUCT_UNAVAILABLE', 'NO_PRIZES'].includes(error.code)) return error.code;
    console.error('[random-box] readiness failed:', error.name, error.message);
    return 'DRAW_EXECUTION_ERROR';
  }
}

// Runs through the common store schema migration on main and every tenant.
// Archive old reservations/schedules; preserve orders, sold IDs and paid totals.
function migrateData(data, now = Date.now()) {
  let changed = false;
  if (!data.randomBoxGachaStates || typeof data.randomBoxGachaStates !== 'object' || Array.isArray(data.randomBoxGachaStates)) {
    data.randomBoxGachaStates = {}; changed = true;
  }
  for (const product of data.products || []) {
    if (product.specialType !== RANDOM_BOX_KIND) continue;
    const id = String(product.id);
    if (product.price !== 1 || product.randomBox?.rate !== 1 || Number(product.originalPrice) !== 0 || product.priceOptions?.length) {
      product.price = 1; product.originalPrice = 0; product.priceOptions = [];
      product.randomBox = { ...(product.randomBox || {}), rate: 1 }; changed = true;
    }
    if (data.randomBoxGachaStates[id]) continue;
    const pool = data.randomBoxPools?.[id];
    const round = data.randomBoxRounds?.[id];
    const history = (data.randomBoxPoolHistory || []).filter(item => String(item.productId) === id);
    const accounting = [...history, ...(pool ? [pool] : [])];
    const legacyCollected = accounting.reduce((sum, item) => sum + Math.max(0, Number(item.totalCollected) || 0) * 100, 0);
    const legacyPrizes = accounting.reduce((sum, item) => sum + Math.max(0, Number(item.totalPrizeItems) || 0), 0);
    const txCollected = (data.walletTransactions || []).filter(item => item.type === 'random_box_draw' && String(item.productId) === id)
      .reduce((sum, item) => sum + Math.max(0, -Number(item.amount) || 0) * 100, 0);
    const orders = (data.orders || []).filter(order => order.randomBoxOrder)
      .slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    let orderCollected = 0, orderPrizes = 0, dryCents = 0, hasDrawHistory = false;
    for (const order of orders) {
      for (const item of order.items || []) {
        if (String(item.productId) !== id || !item.randomBoxDraw) continue;
        const draw = item.randomBoxDraw;
        const count = Array.isArray(draw.prizeItems) ? draw.prizeItems.length : Math.max(0, Number(draw.prizeCount) || (draw.isWin ? 1 : 0));
        const cost = Math.round(Math.max(0, Number(item.price) || 0) * 100);
        orderCollected += cost; orderPrizes += count;
        dryCents = count ? 0 : dryCents + cost; hasDrawHistory = true;
      }
    }
    if (!hasDrawHistory && pool) {
      const progress = pool.phase === 'entry' ? pool.entryProgressDraws : pool.recoveryProgressDraws;
      dryCents = Math.max(0, Number(progress) || 0) * Math.max(1, Number(pool.price) || 1) * 100;
    }
    if (!hasDrawHistory && !pool && round) dryCents = Math.max(0, Number(round.progressDraws || round.progress) || 0) * 100;
    const state = gacha.createState(id);
    state.totalCollectedCents = Math.round(Math.max(txCollected, legacyCollected, orderCollected));
    state.totalPrizeItems = Math.round(Math.max(legacyPrizes, orderPrizes));
    state.drySpendCents = Math.min(10900, Math.floor(Math.min(dryCents, state.totalCollectedCents) / 100) * 100);
    data.randomBoxGachaStates[id] = state;
    if (pool || round) {
      data.randomBoxMigrationBackup ||= {};
      data.randomBoxMigrationBackup[id] ||= { migratedAt: new Date(now).toISOString(),
        pool: pool ? structuredClone(pool) : null, round: round ? structuredClone(round) : null };
      for (const stock of data.stockItems || []) {
        if (String(stock.productId) !== id || stock.status !== 'reserved') continue;
        if (String(stock.randomBoxReservedFor) === id || (pool && String(stock.randomBoxPoolId) === String(pool.id))) {
          stock.status = 'available'; delete stock.randomBoxReservedFor; delete stock.randomBoxPoolId;
        }
      }
      if (data.randomBoxPools) delete data.randomBoxPools[id];
      if (data.randomBoxRounds) delete data.randomBoxRounds[id];
    }
    changed = true;
  }
  return changed;
}
function deletePrizeStock(data, product, { stockIds = null, now = Date.now() } = {}) {
  if (!data || product?.specialType !== RANDOM_BOX_KIND) {
    return { deletedCount: 0, removedReservedCount: 0, resetPool: false, stockEmpty: false };
  }
  migrateData(data, now);
  const selected = stockIds == null ? null : new Set(stockIds.map(String));
  const removed = (data.stockItems || []).filter(item => String(item.productId) === String(product.id)
    && item.status === 'available' && (!selected || selected.has(String(item.id))));
  const ids = new Set(removed.map(item => String(item.id)));
  data.stockItems = (data.stockItems || []).filter(item => !ids.has(String(item.id)));
  // Keep the shared accounting and pity even through delete-all and refill.
  return { deletedCount: removed.length, removedReservedCount: 0, resetPool: false,
    stockEmpty: availablePrizeStockCount(data, product) === 0 };
}
function drawRandomBox(data, { productId, userId, idempotencyKey, drawCount = 1, now = Date.now(),
  randomInt = crypto.randomInt, genId = length => crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length) }) {
  const requestedDrawCount = parseDrawCount(drawCount);
  data.orders ||= []; data.walletTransactions ||= []; data.stockItems ||= [];
  const previous = data.walletTransactions.find(tx => tx.type === 'random_box_draw'
    && String(tx.userId) === String(userId) && String(tx.productId) === String(productId) && tx.idempotencyKey === idempotencyKey);
  if (previous?.orderId) return { orderId: previous.orderId, result: previous.randomBoxResult, replay: true };
  const product = (data.products || []).find(item => String(item.id) === String(productId));
  if (!isPublished(product, now)) fail('PRODUCT_UNAVAILABLE', 'กล่องสุ่มนี้ยังไม่เปิดขายหรือปิดการขายแล้ว');
  if (product.specialType !== RANDOM_BOX_KIND) fail('NOT_RANDOM_BOX', 'สินค้านี้ไม่ใช่กล่องสุ่ม');
  const user = (data.users || []).find(item => String(item.id) === String(userId));
  if (!user || ['disabled', 'banned'].includes(user.status)) fail('USER_UNAVAILABLE', 'ไม่พบบัญชีผู้ใช้หรือบัญชีถูกระงับ');
  const balance = Math.max(0, Math.round((Number(user.walletBalance) || 0) * 100));
  if (balance < 100) fail('INSUFFICIENT_BALANCE', 'ยอดเงินในกระเป๋าไม่เพียงพอ ต้องมีอย่างน้อย ฿1');
  migrateData(data, now);
  const available = availableStockItems(data.stockItems, product.id);
  if (!available.length) fail('NO_PRIZES', 'สต็อกรางวัลหมดชั่วคราว กรุณาลองใหม่ภายหลัง');
  const affordableCount = Math.min(requestedDrawCount, Math.floor(balance / 100));
  const drawn = gacha.draw({ stock: available.map(item => ({ stockId: String(item.id), rewardId: product.id,
    title: getStockPrizeName(item, 'รางวัลกล่องสุ่ม'), status: 'available' })),
    poolId: String(product.id), state: data.randomBoxGachaStates[String(product.id)], ticketCount: affordableCount }, { rng: randomInt });
  const orderId = genId(10), createdAt = new Date(now).toISOString();
  const byId = new Map(available.map(item => [String(item.id), item]));
  const newBalance = (balance - drawn.paymentCents) / 100;
  const orderItems = drawn.drawResults.map(event => {
    const prizeItems = event.stockIds.map(id => stockPrize(byId.get(id), product, orderId));
    return { productId: product.id, title: product.title, price: 1, productImage: product.images?.[0] || '',
      stockItemId: prizeItems[0]?.stockItemId || null, fulfillmentMode: 'automatic',
      randomBoxDraw: { isWin: prizeItems.length > 0, boxProductId: product.id, boxTitle: product.title, boxSlug: product.slug,
        prizeName: prizeItems.length ? `รางวัลกล่องสุ่ม ${prizeItems.length} ชิ้น` : null,
        prizeItems, prizeCount: prizeItems.length, missMessage: prizeItems.length ? null : getMissMessage(product),
        pityApplied: event.pityApplied, walletBalance: newBalance } };
  });
  const wins = orderItems.filter(item => item.randomBoxDraw.isWin);
  const misses = orderItems.filter(item => !item.randomBoxDraw.isWin);
  const total = drawn.paymentCents / 100;
  const result = { ...(orderItems.length === 1 ? orderItems[0].randomBoxDraw : {}),
    isWin: wins.length > 0, drawCount: drawn.ticketCount, requestedDrawCount, winCount: wins.length,
    prizeCount: drawn.prizeCount, missCount: misses.length, missMessage: misses.length ? getMissMessage(product) : null,
    stockExhausted: drawn.stockExhausted, balanceLimited: affordableCount < requestedDrawCount && drawn.ticketCount === affordableCount && !drawn.stockExhausted,
    priceChanged: false, total, prizeName: wins[0]?.randomBoxDraw.prizeName || null,
    prizeNames: wins.map(item => item.randomBoxDraw.prizeName), walletBalance: newBalance };
  product.price = 1; product.randomBox.rate = 1; product.fulfillmentMode = 'automatic'; product.fulfillmentInstructions = '';
  user.walletBalance = newBalance;
  data.randomBoxGachaStates[String(product.id)] = drawn.nextState;
  data.orders.push({ id: orderId, userId: user.id, items: orderItems, subtotal: total, discount: 0,
    total, couponCode: null, status: 'completed', paymentMethod: 'wallet', createdAt,
    salesChannel: 'direct', federatedTenantIds: [], randomBoxOrder: true,
    randomBoxRequestedDrawCount: requestedDrawCount, randomBoxRequestId: idempotencyKey });
  data.walletTransactions.push({ id: genId(10), userId: user.id, type: 'random_box_draw', amount: -total,
    note: `เปิดกล่องสุ่ม ${product.title} ${drawn.ticketCount} ครั้ง · คำสั่งซื้อ #${orderId}`,
    orderId, productId: product.id, idempotencyKey, randomBoxResult: result, createdAt });
  return { orderId, result, replay: false };
}

module.exports = {
  getDrawHealth,
  getPersistedDrawHealth,
  migrateData,
  PENDING_SYSTEM_MESSAGE,
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
  randomAwardCount,
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
  isPublished,
  drawRandomBox,
};
