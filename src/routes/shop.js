const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { withEffectivePrice } = require('../services/pricing');
const { requireAdmin } = require('../middleware/auth');
const rangersSource = require('../services/rangers-catalog');
const catalogSyndication = require('../services/catalog-syndication');
const { MAIN_SITE_URL } = require('../middleware/tenant');

function publishTime(product) {
  if (!product.publishAt) return 0;
  const value = String(product.publishAt);
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}:00+07:00`);
}

function isProductVisible(product) {
  return product.status === 'active' && (!product.publishAt || publishTime(product) <= Date.now());
}

function availableStockCounts() {
  const counts = new Map();
  store.data.stockItems.forEach(item => {
    if (item.status === 'available') counts.set(item.productId, (counts.get(item.productId) || 0) + 1);
  });
  return counts;
}

function withStock(product, counts) {
  const stockCount = counts
    ? (counts.get(product.id) || 0)
    : store.data.stockItems.filter(s => s.productId === product.id && s.status === 'available').length;
  return { ...withEffectivePrice(product), stockCount };
}

function shopStats(extraProductCount = 0) {
  return {
    orderCount: store.data.orders.length,
    customerCount: store.data.users.filter(u => u.role === 'customer').length,
    reviewCount: store.data.reviews.length,
    gameCount: store.data.products.filter(isProductVisible).length + extraProductCount,
  };
}

function mainSiteUrlFor(req) {
  if (MAIN_SITE_URL) return MAIN_SITE_URL;
  const host = String(req?.get('host') || '').split(':')[0].toLowerCase();
  if (host.endsWith('.localhost') || host.endsWith('.lvh.me') || host.endsWith('.127.0.0.1.nip.io')) {
    const port = String(req?.get('host') || '').includes(':') ? String(req.get('host')).split(':').slice(1).join(':') : (process.env.PORT || '3000');
    return `http://localhost${port && port !== '80' ? `:${port}` : ''}`;
  }
  return `${req?.protocol || 'https'}://${req?.get('host') || 'localhost'}`;
}

function syndicatedProducts(req) {
  if (!req?.tenantShop) return [];
  return catalogSyndication.getTenantProducts(store.platformData, store.data, mainSiteUrlFor(req), req.tenantShop).products;
}

function sortProducts(products, sort) {
  const list = [...products];
  switch (sort) {
    case 'price_asc': return list.sort((a, b) => a.price - b.price);
    case 'price_desc': return list.sort((a, b) => b.price - a.price);
    case 'discount': return list.sort((a, b) => (b.originalPrice - b.price) - (a.originalPrice - a.price));
    case 'name': return list.sort((a, b) => a.title.localeCompare(b.title, 'th'));
    case 'newest': return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    default: return list;
  }
}

function maskUsername(username) {
  const value = String(username || 'ลูกค้า');
  if (value.length <= 2) return `${value.charAt(0) || 'ล'}***`;
  return `${value.slice(0, 2)}***${value.slice(-1)}`;
}

function latestOrderCards() {
  const productsById = new Map(store.data.products.map(product => [product.id, product]));
  const usersById = new Map(store.data.users.map(user => [user.id, user]));
  return [...store.data.orders]
    .filter(order => order.status !== 'cancelled' && order.items && order.items.length)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)
    .map(order => {
      const firstItem = order.items[0];
      const product = productsById.get(firstItem.productId);
      const buyer = usersById.get(order.userId);
      return {
        title: firstItem.title,
        extraItems: Math.max(0, order.items.length - 1),
        amount: order.total,
        image: product && product.images && product.images[0],
        slug: product && product.slug,
        buyer: maskUsername(buyer && buyer.username),
        createdAt: order.createdAt,
      };
    });
}

const HOME_PAGE_SIZE = 24;
const UNPAGINATED_HOME_TENANTS = new Set(['moopee-shop']);

function homeViewData(heroPreviewV2 = false, requestedPage = 1, showAllProducts = false, req = null) {
  const stockCounts = availableStockCounts();
  const remote = syndicatedProducts(req);
  const active = store.data.products.filter(isProductVisible).map(product => withStock(product, stockCounts)).concat(remote);
  const scheduledProducts = store.data.products
    .filter(product => product.status === 'active' && product.publishAt && publishTime(product) > Date.now())
    .sort((a, b) => publishTime(a) - publishTime(b))
    .slice(0, 8);
  const newestProducts = [...active].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const newest = newestProducts.slice(0, 5);
  const byId = new Map(active.map(p => [p.id, p]));
  const homeSections = (store.data.homeSections || []).filter(section => section.enabled !== false).map(section => {
    const products = section.mode === 'manual'
      ? (section.productIds || []).map(id => byId.get(id)).filter(Boolean)
      : newestProducts.slice(0, section.limit || 5);
    return { id: section.id, title: section.title, products };
  }).filter(section => section.products.length);
  const recommendedCategories = (store.data.recommendedCategories || []).filter(category => category.enabled !== false);
  // Every product is still reachable (nothing is silently capped) — just
  // paginated instead of rendering the entire catalog in one page load,
  // which was ballooning page weight/DOM size once a shop had 50+ products.
  const totalPages = showAllProducts ? 1 : Math.max(1, Math.ceil(active.length / HOME_PAGE_SIZE));
  const page = showAllProducts ? 1 : Math.min(totalPages, Math.max(1, Number(requestedPage) || 1));
  const pageProducts = showAllProducts
    ? active
    : active.slice((page - 1) * HOME_PAGE_SIZE, page * HOME_PAGE_SIZE);
  return {
    title: 'หน้าแรก',
    stats: shopStats(remote.length),
    newest,
    homeSections,
    recommendedCategories,
    products: pageProducts,
    productTotal: active.length,
    productPage: page,
    productTotalPages: totalPages,
    announcements: store.data.announcements.filter(a => a.active),
    latestOrders: latestOrderCards(),
    scheduledProducts,
    filterTags: store.data.filterTags,
    activeFilterTags: [],
    filterProductCount: active.length,
    miniGamePrizes: store.data.miniGamePrizes.filter(p => p.active),
    heroPreviewV2,
    rangersCatalog: store.data.settings.rangersCatalog || { enabled: false, items: [] },
    rangersProductAssignments: Object.fromEntries(Object.entries(store.data.settings.rangersCatalog?.productAssignments || {})
      .map(([productId, codes]) => [productId, rangersSource.resolveCodes(codes)])),
    // Keep the hero lineup in sync with the refreshed Top 100 source. The
    // first five records are always labelled Top 1–5 for a predictable card
    // layout, even while the source is using its local fallback data.
    rangersFeatured: rangersSource.queryCatalog({ view: 'top100', limit: 12 }).items.slice(0, 5)
      .map((item, index) => ({ ...item, rank: Number(item.rank) || index + 1 })),
  };
}

router.get('/', (req, res) => {
  const model = store.data.settings.storefrontModel;
  const view = req.tenantShop?.isSystemLab && model === 'rangers-market'
    ? 'shop/home-rangers-market'
    : 'shop/home';
  const tenantSlug = String(req.tenantShop?.slug || '').toLowerCase();
  const showAllProducts = UNPAGINATED_HOME_TENANTS.has(tenantSlug);
  res.render(view, homeViewData(false, req.query.page, showAllProducts, req));
});

router.get('/api/rangers-catalog', (req, res) => {
  if (!req.tenantShop?.isSystemLab || !store.data.settings.rangersCatalog?.enabled) {
    return res.status(404).json({ error: 'not_found' });
  }
  const query = { ...req.query };
  if (query.view === 'available') {
    query.view = 'all';
    query.codes = Object.values(store.data.settings.rangersCatalog.productAssignments || {}).flat().map(String);
  }
  const result = rangersSource.queryCatalog(query);
  result.view = req.query.view || 'all';
  res.json(result);
});

router.get('/preview/rangers-market', requireAdmin, (req, res) => {
  if (!req.tenantShop?.isSystemLab) return res.status(404).send('ไม่พบหน้าที่คุณต้องการ');
  res.render('shop/home-rangers-market', {
    ...homeViewData(false, req.query.page),
    title: 'ตัวอย่างโมเดล Rangers Market',
    publicPreview: true,
  });
});

router.get('/preview/locker-home', requireAdmin, (req, res) => {
  res.render('shop/home', { ...homeViewData(false, req.query.page), title: 'หน้าแรกแบบเดิม' });
});

router.get('/preview/mobile-cinematic-7f4c2a', (req, res) => {
  res.render('shop/home', {
    ...homeViewData(false, req.query.page),
    title: 'หน้าแรกแบบเดิม',
    publicPreview: true,
  });
});

router.get('/products', (req, res) => {
  const stockCounts = availableStockCounts();
  let products = store.data.products.filter(isProductVisible).map(product => withStock(product, stockCounts)).concat(syndicatedProducts(req));
  const recommendedId = String(req.query.recommended || '').trim();
  const recommendedCategory = recommendedId
    ? (store.data.recommendedCategories || []).find(category => String(category.id) === recommendedId)
    : null;
  if (recommendedId && !recommendedCategory) return res.status(404).render('shop/404', { title: 'ไม่พบหมวดหมู่' });
  if (recommendedCategory) {
    const productIds = new Set((recommendedCategory.productIds || []).map(String));
    products = products.filter(product => productIds.has(String(product.id)));
  }
  const requestedIds = String(req.query.tags || req.query.tag || '').split(',').map(s => s.trim()).filter(Boolean);
  const activeFilterTags = requestedIds
    .map(id => store.data.filterTags.find(tag => tag.id === id))
    .filter(Boolean);
  // AND match: a product must carry every selected tag (it can have MORE
  // tags beyond those selected — extra tags on the product don't exclude
  // it, only a MISSING selected tag does).
  if (activeFilterTags.length) {
    products = products.filter(product => {
      const productTagIds = product.filterTagIds || [];
      return activeFilterTags.every(tag => productTagIds.includes(tag.id));
    });
  }
  products = sortProducts(products, req.query.sort);
  res.render('shop/listing', {
    title: recommendedCategory
      ? `หมวดหมู่: ${recommendedCategory.title}`
      : (activeFilterTags.length ? `สินค้า: ${activeFilterTags.map(t => t.name).join(' + ')}` : 'สินค้าเกมทั้งหมด'),
    products,
    listType: 'products',
    sort: req.query.sort || '',
    filterTags: store.data.filterTags,
    activeFilterTags,
    filterProductCount: products.length,
  });
});

router.get('/offline', (req, res) => res.redirect('/products'));
router.get('/rental', (req, res) => res.redirect('/products'));

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const stockCounts = availableStockCounts();
  const products = store.data.products
    .filter(p => isProductVisible(p) && p.title.toLowerCase().includes(q))
    .map(product => withStock(product, stockCounts))
    .concat(syndicatedProducts(req).filter(p => String(p.title || '').toLowerCase().includes(q)));
  res.render('shop/listing', { title: `ผลการค้นหา: ${q}`, products, listType: null, sort: '', q, filterTags: null });
});

router.get('/help', (req, res) => {
  res.render('shop/help', { title: 'วิธีใช้งาน' });
});

router.get('/contact', (req, res) => {
  if (req.tenantShop) return res.render('shop/contact', { title: 'ติดต่อร้านหลักหลังสั่งซื้อ', postPurchaseOnly: true });
  res.render('shop/contact', { title: 'ติดต่อร้าน' });
});

router.get('/cookie-policy', (req, res) => {
  res.render('shop/cookie-policy', { title: 'นโยบายคุกกี้' });
});

router.get('/federated/checkout', async (req, res) => {
  if (req.tenantShop) return res.status(404).render('shop/404', { title: 'ไม่พบสินค้า' });
  const payload = catalogSyndication.verifyToken(req.query.token);
  if (!payload?.tenantId || !payload.productId) return res.status(400).send('ลิงก์สั่งซื้อหมดอายุหรือไม่ถูกต้อง');
  const tenant = store.platformData.shops.find(shop => String(shop.id) === String(payload.tenantId));
  if (!tenant) return res.status(404).send('ไม่พบร้านต้นทาง');
  const tenantDb = await store.loadTenantDb(tenant.id);
  const source = catalogSyndication.getTenantProducts(store.platformData, tenantDb, MAIN_SITE_URL || `${req.protocol}://${req.get('host')}`, tenant).products
    .find(product => String(product.sourceProductId) === String(payload.productId));
  if (!source || source.stockCount < 1) return res.status(409).send('สินค้านี้หมดสต็อกหรือปิดการขายแล้ว');
  req.session.federatedCatalog = {
    sourceProductId: source.sourceProductId,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    price: source.price,
    sourcePrice: source.sourcePrice,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  res.redirect(`/game/${encodeURIComponent(source.sourceSlug)}?federated=1`);
});

router.get('/game/:slug', (req, res) => {
  const remoteProduct = catalogSyndication.findTenantProduct(store.platformData, store.data, req.params.slug, mainSiteUrlFor(req), req.tenantShop);
  const product = remoteProduct || store.data.products.find(p => p.slug === req.params.slug);
  if (!product || !isProductVisible(product)) return res.status(404).render('shop/404', { title: 'ไม่พบสินค้า' });
  const federated = !remoteProduct && req.session.federatedCatalog &&
    String(req.session.federatedCatalog.sourceProductId) === String(product.id) &&
    Number(req.session.federatedCatalog.expiresAt) > Date.now();
  const displayProduct = remoteProduct ? remoteProduct : (() => {
    const local = withStock(product);
    if (!federated) return local;
    return { ...local, price: Number(req.session.federatedCatalog.price), sourcePrice: Number(req.session.federatedCatalog.sourcePrice), federatedCheckout: true };
  })();
  const reviews = remoteProduct ? [] : store.data.reviews.filter(r => r.productId === product.id);
  const selectedFilterTagIds = new Set((product.filterTagIds || []).map(String));
  const productFilterTags = store.data.filterTags.filter(tag => selectedFilterTagIds.has(String(tag.id)));
  const productRangers = rangersSource.resolveCodes(
    remoteProduct ? [] : store.data.settings.rangersCatalog?.productAssignments?.[product.id] || [],
  );
  res.render('shop/product-detail', {
    title: product.title,
    product: displayProduct,
    genreNames: (product.genres || []).map(g => store.data.settings.genres[g] || g),
    productFilterTags,
    productRangers,
    reviews,
    ogTitle: `${product.title} | ${store.data.settings.shopName}`,
    ogDescription: `฿${product.price.toLocaleString()} — ${product.description || store.data.settings.tagline || ''}`.trim(),
    ogImage: product.images && product.images[0] ? product.images[0] : undefined,
    ogType: 'product',
  });
});

module.exports = router;
