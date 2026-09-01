const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { withEffectivePrice } = require('../services/pricing');
const { requireAdmin } = require('../middleware/auth');

function publishTime(product) {
  if (!product.publishAt) return 0;
  const value = String(product.publishAt);
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}:00+07:00`);
}

function isProductVisible(product) {
  return product.status === 'active' && (!product.publishAt || publishTime(product) <= Date.now());
}

function withStock(product) {
  const stock = store.data.stockItems.filter(s => s.productId === product.id && s.status === 'available');
  return { ...withEffectivePrice(product), stockCount: stock.length };
}

function shopStats() {
  return {
    orderCount: store.data.orders.length,
    customerCount: store.data.users.filter(u => u.role === 'customer').length,
    reviewCount: store.data.reviews.length,
    gameCount: store.data.products.filter(isProductVisible).length,
  };
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
  return [...store.data.orders]
    .filter(order => order.status !== 'cancelled' && order.items && order.items.length)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)
    .map(order => {
      const firstItem = order.items[0];
      const product = store.data.products.find(item => item.id === firstItem.productId);
      const buyer = store.data.users.find(user => user.id === order.userId);
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

function homeViewData(heroPreviewV2 = false) {
  const active = store.data.products.filter(isProductVisible).map(withStock);
  const scheduledProducts = store.data.products
    .filter(product => product.status === 'active' && product.publishAt && publishTime(product) > Date.now())
    .sort((a, b) => publishTime(a) - publishTime(b))
    .slice(0, 8);
  const newest = [...active].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const byId = new Map(active.map(p => [p.id, p]));
  const homeSections = (store.data.homeSections || []).map(section => {
    const products = section.mode === 'manual'
      ? (section.productIds || []).map(id => byId.get(id)).filter(Boolean)
      : [...active].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, section.limit || 5);
    return { id: section.id, title: section.title, products };
  }).filter(section => section.products.length);
  return {
    title: 'หน้าแรก',
    stats: shopStats(),
    newest,
    homeSections,
    products: active.slice(0, 24),
    productTotal: active.length,
    announcements: store.data.announcements.filter(a => a.active),
    latestOrders: latestOrderCards(),
    scheduledProducts,
    filterTags: store.data.filterTags,
    activeFilterTags: [],
    filterProductCount: active.length,
    miniGamePrizes: store.data.miniGamePrizes.filter(p => p.active),
    heroPreviewV2,
  };
}

router.get('/', (req, res) => {
  res.render('shop/home', homeViewData(false));
});

router.get('/preview/locker-home', requireAdmin, (req, res) => {
  res.render('shop/home', { ...homeViewData(true), title: 'ทดลองหน้าแรกแบบ Game Lobby' });
});

router.get('/products', (req, res) => {
  let products = store.data.products.filter(isProductVisible).map(withStock);
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
    title: activeFilterTags.length ? `สินค้า: ${activeFilterTags.map(t => t.name).join(' + ')}` : 'สินค้าเกมทั้งหมด',
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
  const products = store.data.products
    .filter(p => isProductVisible(p) && p.title.toLowerCase().includes(q))
    .map(withStock);
  res.render('shop/listing', { title: `ผลการค้นหา: ${q}`, products, listType: null, sort: '', q, filterTags: null });
});

router.get('/help', (req, res) => {
  res.render('shop/help', { title: 'วิธีใช้งาน' });
});

router.get('/contact', (req, res) => {
  res.render('shop/contact', { title: 'ติดต่อร้าน' });
});

router.get('/game/:slug', (req, res) => {
  const product = store.data.products.find(p => p.slug === req.params.slug);
  if (!product || !isProductVisible(product)) return res.status(404).render('shop/404', { title: 'ไม่พบสินค้า' });
  const reviews = store.data.reviews.filter(r => r.productId === product.id);
  res.render('shop/product-detail', {
    title: product.title,
    product: withStock(product),
    genreNames: (product.genres || []).map(g => store.data.settings.genres[g] || g),
    reviews,
  });
});

module.exports = router;
