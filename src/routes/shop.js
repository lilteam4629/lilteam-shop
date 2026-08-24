const express = require('express');
const router = express.Router();
const store = require('../data/store');

function withStock(product) {
  const stock = store.data.stockItems.filter(s => s.productId === product.id && s.status === 'available');
  return { ...product, stockCount: stock.length };
}

function shopStats() {
  return {
    orderCount: store.data.orders.length,
    customerCount: store.data.users.filter(u => u.role === 'customer').length,
    reviewCount: store.data.reviews.length,
    gameCount: store.data.products.filter(p => p.status === 'active').length,
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

router.get('/', (req, res) => {
  const active = store.data.products.filter(p => p.status === 'active').map(withStock);
  const newest = [...active].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const rental = active.filter(p => p.type === 'rental').slice(0, 5);
  const offline = active.filter(p => p.type === 'offline');
  res.render('shop/home', {
    title: 'หน้าแรก',
    stats: shopStats(),
    newest,
    rental,
    rentalTotal: active.filter(p => p.type === 'rental').length,
    offline: offline.slice(0, 24),
    offlineTotal: offline.length,
    announcements: store.data.announcements.filter(a => a.active),
    filterTags: store.data.filterTags,
  });
});

router.get('/offline', (req, res) => {
  let products = store.data.products.filter(p => p.status === 'active' && p.type === 'offline').map(withStock);
  products = sortProducts(products, req.query.sort);
  res.render('shop/listing', { title: 'ไอดีออฟไลน์', products, listType: 'offline', sort: req.query.sort || '', filterTags: store.data.filterTags });
});

router.get('/rental', (req, res) => {
  let products = store.data.products.filter(p => p.status === 'active' && p.type === 'rental').map(withStock);
  products = sortProducts(products, req.query.sort);
  res.render('shop/listing', { title: 'ไอดีเช่ารายวัน', products, listType: 'rental', sort: req.query.sort || '', filterTags: store.data.filterTags });
});

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const products = store.data.products
    .filter(p => p.status === 'active' && p.title.toLowerCase().includes(q))
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
  if (!product) return res.status(404).render('shop/404', { title: 'ไม่พบสินค้า' });
  const reviews = store.data.reviews.filter(r => r.productId === product.id);
  res.render('shop/product-detail', {
    title: product.title,
    product: withStock(product),
    genreNames: (product.genres || []).map(g => store.data.settings.genres[g] || g),
    reviews,
  });
});

module.exports = router;
