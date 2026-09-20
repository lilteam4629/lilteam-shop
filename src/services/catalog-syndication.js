const crypto = require('crypto');

const TOKEN_TTL_SECONDS = 10 * 60;

function normalizeConfig(settings = {}) {
  const raw = settings.catalogApi && typeof settings.catalogApi === 'object' ? settings.catalogApi : {};
  const markupMode = raw.markupMode === 'fixed' ? 'fixed' : 'percent';
  const max = markupMode === 'percent' ? 1000 : 100000;
  const markupValue = Math.min(max, Math.max(0, Number.isFinite(Number(raw.markupValue)) ? Number(raw.markupValue) : 0));
  return {
    enabled: raw.enabled === true,
    source: 'main-store',
    markupMode,
    markupValue,
    featuredProductIds: [...new Set((Array.isArray(raw.featuredProductIds) ? raw.featuredProductIds : []).map(String))].slice(0, 5),
    featuredProductIdsConfigured: Array.isArray(raw.featuredProductIds),
    ownerRevenue: Math.max(0, Number(raw.ownerRevenue) || 0),
    tenantRevenue: Math.max(0, Number(raw.tenantRevenue) || 0),
    transactions: Array.isArray(raw.transactions) ? raw.transactions.slice(-100) : [],
    // Payouts are kept separately from sales transactions so paying a
    // partner never changes the immutable sales ledger.  The admin page can
    // therefore show an exact pending balance and remain idempotent after a
    // restart or a repeated form submission.
    payouts: Array.isArray(raw.payouts) ? raw.payouts.slice(-200) : [],
    syncedAt: raw.syncedAt || null,
  };
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Return the partner margin ledger grouped by tenant shop id.
 *
 * `transactions` contains the sales-side margin, while `payouts` contains
 * amounts already transferred to a tenant.  Payout entries are intentionally
 * ignored when accruing revenue, which prevents a transfer from being counted
 * as a new margin when this function is called again.
 */
function calculatePayoutLedger(settingsOrConfig = {}) {
  // Read the raw arrays for accounting. normalizeConfig intentionally keeps a
  // bounded view for storefront payloads, but an old sale must never vanish
  // from the amount owed just because more than 100 newer sales exist.
  const config = settingsOrConfig && settingsOrConfig.catalogApi
    ? settingsOrConfig.catalogApi
    : settingsOrConfig;
  const accrued = {};
  const paid = {};
  const add = (target, tenantId, amount) => {
    const id = String(tenantId || '').trim();
    const value = Number(amount) || 0;
    if (!id || value <= 0) return;
    target[id] = roundMoney((target[id] || 0) + value);
  };
  (config.transactions || []).forEach(transaction => {
    if (!transaction || transaction.type === 'payout') return;
    const breakdown = transaction.tenantRevenueByTenant;
    if (breakdown && typeof breakdown === 'object') {
      Object.entries(breakdown).forEach(([tenantId, amount]) => add(accrued, tenantId, amount));
    } else if (transaction.tenantId && transaction.tenantRevenue) {
      add(accrued, transaction.tenantId, transaction.tenantRevenue);
    }
  });
  (config.payouts || []).forEach(payout => add(paid, payout.tenantShopId || payout.tenantId, payout.amount));
  const pending = {};
  new Set([...Object.keys(accrued), ...Object.keys(paid)]).forEach(tenantId => {
    pending[tenantId] = Math.max(0, roundMoney((accrued[tenantId] || 0) - (paid[tenantId] || 0)));
  });
  return { accrued, paid, pending };
}

// Resolve the five Partner products for a tenant storefront. A tenant's
// explicit selection must win over the platform default; otherwise the
// tenant admin can tick different products but the homepage keeps rendering
// the platform list. An explicitly empty selection is intentional and hides
// the Partner shelf instead of silently restoring the first five products.
function selectFeaturedProducts(products, tenantConfig = {}, platformConfig = {}, limit = 5) {
  const tenant = tenantConfig && typeof tenantConfig === 'object' ? tenantConfig : {};
  const platform = platformConfig && typeof platformConfig === 'object' ? platformConfig : {};
  let selectedIds = null;
  if (tenant.featuredProductIdsConfigured) selectedIds = tenant.featuredProductIds || [];
  else if (platform.featuredProductIdsConfigured) selectedIds = platform.featuredProductIds || [];
  if (selectedIds === null) return products.slice(0, limit);
  const allowed = new Set(selectedIds.map(String));
  return products.filter(product => allowed.has(String(product.sourceProductId))).slice(0, limit);
}

function availableCounts(db) {
  const counts = new Map();
  (db.stockItems || []).forEach(item => {
    if (item.status === 'available') {
      const productId = String(item.productId);
      counts.set(productId, (counts.get(productId) || 0) + 1);
    }
  });
  return counts;
}

function applyMarkup(price, config) {
  const base = Math.max(0, Number(price) || 0);
  const extra = config.markupMode === 'fixed'
    ? config.markupValue
    : base * (config.markupValue / 100);
  return Math.round((base + extra) * 100) / 100;
}

function remoteSlug(product) {
  return `api-${String(product.id)}-${String(product.slug || 'item').replace(/[^a-zA-Z0-9ก-๙-]+/g, '-').replace(/^-|-$/g, '')}`;
}

function sanitizeProduct(product, mainDb, config, mainSiteUrl, tenantShop = null) {
  const counts = availableCounts(mainDb);
  const basePrice = Math.max(0, Number(product.price) || 0);
  const price = applyMarkup(basePrice, config);
  const stockCount = counts.get(String(product.id)) || 0;
  return {
    id: remoteSlug(product),
    sourceProductId: String(product.id),
    sourceSlug: product.slug,
    slug: remoteSlug(product),
    title: product.title,
    type: product.type || 'game',
    genres: Array.isArray(product.genres) ? product.genres : [],
    filterTagIds: Array.isArray(product.filterTagIds) ? product.filterTagIds : [],
    price,
    sourcePrice: basePrice,
    originalPrice: Number(product.originalPrice) || 0,
    regularPrice: Number(product.regularPrice) || basePrice,
    description: product.description || '',
    aboutText: product.aboutText || '',
    images: Array.isArray(product.images) ? product.images.slice(0, 3) : [],
    stockCount,
    status: product.status,
    createdAt: product.createdAt,
    isSyndicated: true,
    sourceLabel: mainDb.settings?.shopName || 'ร้านหลัก',
    sourceUrl: mainSiteUrl && product.slug ? (tenantShop?.id ? `${mainSiteUrl}/federated/checkout?token=${encodeURIComponent(createCheckoutToken({ tenantId: tenantShop.id, tenantSlug: tenantShop.slug, productId: product.id, returnUrl: tenantShop.slug || '' }))}` : `${mainSiteUrl}/game/${encodeURIComponent(product.slug)}`) : '',
    markupMode: config.markupMode,
    markupValue: config.markupValue,
    priceOptions: [],
    purchaseApprovalEnabled: false,
    fulfillmentMode: 'automatic',
  };
}

function getTenantProducts(mainDb, tenantDb, mainSiteUrl = '', tenantShop = null) {
  const config = normalizeConfig(tenantDb?.settings || {});
  if (!config.enabled) return { config, products: [] };
  const products = (mainDb.products || [])
    .filter(product => product && product.status === 'active')
    .filter(product => !product.publishAt || Date.parse(String(product.publishAt).includes('T') ? product.publishAt : `${product.publishAt}:00+07:00`) <= Date.now())
    .map(product => sanitizeProduct(product, mainDb, config, mainSiteUrl, tenantShop))
    // A Partner listing represents an actually purchasable account. Do not
    // advertise an active product after its last available stock item was sold.
    .filter(product => product.stockCount > 0);
  return { config, products };
}

function findTenantProduct(mainDb, tenantDb, slug, mainSiteUrl = '', tenantShop = null) {
  const result = getTenantProducts(mainDb, tenantDb, mainSiteUrl, tenantShop);
  return result.products.find(product => product.slug === slug) || null;
}

function tokenSecret() {
  return String(process.env.CATALOG_SYNC_SECRET || process.env.INTERNAL_API_SECRET || process.env.SESSION_SECRET || 'catalog-sync-development-secret');
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', tokenSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', tokenSecret()).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) { return null; }
}

function createCheckoutToken({ tenantId, tenantSlug, productId, returnUrl = '' }) {
  const now = Math.floor(Date.now() / 1000);
  return signPayload({ v: 1, tenantId: String(tenantId || ''), tenantSlug: String(tenantSlug || ''), productId: String(productId || ''), returnUrl: String(returnUrl || '').slice(0, 500), iat: now, exp: now + TOKEN_TTL_SECONDS });
}

module.exports = {
  normalizeConfig,
  calculatePayoutLedger,
  selectFeaturedProducts,
  applyMarkup,
  getTenantProducts,
  findTenantProduct,
  createCheckoutToken,
  verifyToken,
  TOKEN_TTL_SECONDS,
};
