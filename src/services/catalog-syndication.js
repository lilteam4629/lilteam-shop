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
    syncedAt: raw.syncedAt || null,
  };
}

function availableCounts(db) {
  const counts = new Map();
  (db.stockItems || []).forEach(item => {
    if (item.status === 'available') counts.set(item.productId, (counts.get(item.productId) || 0) + 1);
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
  const stockCount = counts.get(product.id) || 0;
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
    .map(product => sanitizeProduct(product, mainDb, config, mainSiteUrl, tenantShop));
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
  applyMarkup,
  getTenantProducts,
  findTenantProduct,
  createCheckoutToken,
  verifyToken,
  TOKEN_TTL_SECONDS,
};
