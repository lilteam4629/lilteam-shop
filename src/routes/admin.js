const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const store = require('../data/store');
const { pickPrize } = require('../services/minigame');
const license = require('../services/license');
const railway = require('../services/railway');
const github = require('../services/github');
const { requireAdmin } = require('../middleware/auth');

const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const qrImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const prizeImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

router.use(requireAdmin);
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  res.locals.pendingTopupCount = store.data.topupRequests.filter(t => t.status === 'pending').length;
  res.locals.persistentStorageEnabled = store.isPersistent();
  next();
});

function slugify(str) {
  return str.toString().toLowerCase().trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function persistUploadedFiles(files) {
  return Promise.all((files || []).map(file => store.saveMedia(file.buffer, file.originalname, file.mimetype)));
}

// ---------- Dashboard ----------
router.get('/', (req, res) => {
  const { orders, users, products, stockItems } = store.data;
  const paidOrders = orders.filter(order => order.status !== 'cancelled');
  const revenue = paidOrders.reduce((sum, o) => sum + o.total, 0);
  const now = new Date();
  const bangkokKey = date => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const todayKey = bangkokKey(now);
  const revenueToday = paidOrders.filter(order => bangkokKey(new Date(order.createdAt)) === todayKey).reduce((sum, order) => sum + order.total, 0);
  const since7Days = now.getTime() - (7 * 86400000);
  const since30Days = now.getTime() - (30 * 86400000);
  const revenue7Days = paidOrders.filter(order => new Date(order.createdAt).getTime() >= since7Days).reduce((sum, order) => sum + order.total, 0);
  const revenue30Days = paidOrders.filter(order => new Date(order.createdAt).getTime() >= since30Days).reduce((sum, order) => sum + order.total, 0);
  const newCustomers30Days = users.filter(user => user.role === 'customer' && new Date(user.createdAt).getTime() >= since30Days).length;
  const dailySales = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getTime() - ((6 - index) * 86400000));
    const key = bangkokKey(date);
    const amount = paidOrders.filter(order => bangkokKey(new Date(order.createdAt)) === key).reduce((sum, order) => sum + order.total, 0);
    return { key, label: date.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short' }), amount };
  });
  const maxDailyRevenue = Math.max(1, ...dailySales.map(day => day.amount));
  const productSales = new Map();
  paidOrders.forEach(order => order.items.forEach(item => {
    const current = productSales.get(item.productId) || { id: item.productId, title: item.title, units: 0, revenue: 0 };
    current.units += 1;
    current.revenue += item.price;
    productSales.set(item.productId, current);
  }));
  const topProducts = [...productSales.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue).slice(0, 5);
  const reviewedTopups = store.data.topupRequests.filter(request => request.status === 'approved' || request.status === 'rejected');
  const approvedTopups = reviewedTopups.filter(request => request.status === 'approved').length;
  const topupSuccessRate = reviewedTopups.length ? Math.round((approvedTopups / reviewedTopups.length) * 100) : 0;
  const availableStock = stockItems.filter(s => s.status === 'available').length;
  const lowStockProducts = store.data.products.filter(p => {
    const count = stockItems.filter(s => s.productId === p.id && s.status === 'available').length;
    return count <= 1;
  });
  const recentOrders = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  const pendingTopups = store.data.topupRequests.filter(t => t.status === 'pending').length;
  res.render('admin/dashboard', {
    title: 'แดชบอร์ด', active: 'dashboard',
    stats: {
      revenue,
      orderCount: orders.length,
      userCount: users.length,
      productCount: products.length,
      availableStock,
      pendingTopups,
      revenueToday,
      revenue7Days,
      revenue30Days,
      newCustomers30Days,
      topupSuccessRate,
      reviewedTopups: reviewedTopups.length,
    },
    lowStockProducts,
    recentOrders,
    dailySales,
    maxDailyRevenue,
    topProducts,
    licenseGateOn: license.isGateOn(),
    licenseExpiresAt: license.isGateOn() ? store.data.settings.license.expiresAt : null,
  });
});

// ---------- Products ----------
function parseProductBody(body, uploadedImages = [], existingImages = []) {
  const removedImages = new Set(Array.isArray(body.removeImages) ? body.removeImages : (body.removeImages ? [body.removeImages] : []));
  const keptImages = existingImages.filter(image => !removedImages.has(image));
  const urlImages = (body.images || '').split('\n').map(s => s.trim()).filter(Boolean);
  const addedImages = body.newImagesFirst === 'on' ? [...uploadedImages, ...urlImages] : [...urlImages, ...uploadedImages];
  const images = body.newImagesFirst === 'on' ? [...addedImages, ...keptImages] : [...keptImages, ...addedImages];
  const genres = Array.isArray(body.genres) ? body.genres : (body.genres ? [body.genres] : []);
  const filterTagIds = Array.isArray(body.filterTagIds) ? body.filterTagIds : (body.filterTagIds ? [body.filterTagIds] : []);
  return {
    title: body.title,
    type: 'game',
    genres,
    filterTagIds,
    price: parseInt(body.price, 10) || 0,
    originalPrice: parseInt(body.originalPrice, 10) || 0,
    flashSalePrice: body.flashSalePrice === '' ? null : Math.max(0, parseInt(body.flashSalePrice, 10) || 0),
    flashSaleStartAt: (body.flashSaleStartAt || '').trim(),
    flashSaleEndAt: (body.flashSaleEndAt || '').trim(),
    description: body.description || '',
    aboutText: body.aboutText || '',
    publishAt: (body.publishAt || '').trim(),
    eventBadge: (body.eventBadge || '').trim(),
    eventDescription: (body.eventDescription || '').trim(),
    images: images.length ? images : ['https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800'],
  };
}

router.get('/products', (req, res) => {
  const products = store.data.products.map(p => {
    const stockCount = store.data.stockItems.filter(s => s.productId === p.id && s.status === 'available').length;
    return { ...p, stockCount };
  });
  res.render('admin/products', { title: 'สินค้า', active: 'products', products });
});

router.get('/products/new', (req, res) => {
  res.render('admin/product-form', { title: 'เพิ่มสินค้าใหม่', active: 'products', product: null, genres: store.data.settings.genres, filterTags: store.data.filterTags });
});

router.post('/products/new', (req, res) => {
  productImageUpload.array('productImages', 10)(req, res, async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูปสินค้าไม่สำเร็จ (สูงสุด 10 รูป รูปละไม่เกิน 8MB)');
      return res.redirect('/admin/products/new');
    }
    try {
      const uploadedImages = await persistUploadedFiles(req.files);
      const fields = parseProductBody(req.body, uploadedImages);
      const product = {
        id: store.genId(8), slug: slugify(fields.title) + '-' + store.genId(4),
        ...fields, status: 'active', createdAt: new Date().toISOString(),
      };
      store.data.products.push(product);
      store.save();
      req.flash('success', 'เพิ่มสินค้าแล้ว');
      res.redirect('/admin/products');
    } catch (saveError) {
      req.flash('error', 'บันทึกรูปสินค้าไม่สำเร็จ กรุณาลองใหม่');
      res.redirect('/admin/products/new');
    }
  });
});

router.get('/products/:id/edit', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  res.render('admin/product-form', { title: 'แก้ไขสินค้า', active: 'products', product, genres: store.data.settings.genres, filterTags: store.data.filterTags });
});

router.post('/products/:id/edit', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  productImageUpload.array('productImages', 10)(req, res, async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูปสินค้าไม่สำเร็จ (สูงสุด 10 รูป รูปละไม่เกิน 8MB)');
      return res.redirect(`/admin/products/${product.id}/edit`);
    }
    try {
      const uploadedImages = await persistUploadedFiles(req.files);
      const fields = parseProductBody(req.body, uploadedImages, product.images || []);
      Object.assign(product, fields, { status: req.body.status || 'active' });
      store.save();
      req.flash('success', 'บันทึกการแก้ไขและรูปสินค้าแล้ว');
      res.redirect('/admin/products');
    } catch (saveError) {
      req.flash('error', 'บันทึกรูปสินค้าไม่สำเร็จ กรุณาลองใหม่');
      res.redirect(`/admin/products/${product.id}/edit`);
    }
  });
});

router.post('/products/:id/delete', (req, res) => {
  store.data.products = store.data.products.filter(p => p.id !== req.params.id);
  store.data.stockItems = store.data.stockItems.filter(s => s.productId !== req.params.id);
  store.save();
  req.flash('success', 'ลบสินค้าแล้ว');
  res.redirect('/admin/products');
});

router.post('/products/:id/copy', (req, res) => {
  const source = store.data.products.find(p => p.id === req.params.id);
  if (!source) {
    req.flash('error', 'ไม่พบสินค้าที่ต้องการคัดลอก');
    return res.redirect('/admin/products');
  }

  // Clone product details and image references, but never duplicate stock
  // credentials. Keep the copy hidden until the admin has reviewed it.
  const copiedFields = JSON.parse(JSON.stringify(source));
  delete copiedFields.id;
  delete copiedFields.slug;
  delete copiedFields.createdAt;
  const product = {
    ...copiedFields,
    id: store.genId(8),
    slug: slugify(`${source.title}-copy`) + '-' + store.genId(4),
    title: `${source.title} (สำเนา)`,
    status: 'hidden',
    createdAt: new Date().toISOString(),
  };
  store.data.products.push(product);
  store.save();
  req.flash('success', 'คัดลอกสินค้าแล้ว กรุณาตรวจสอบข้อมูลก่อนเปิดขาย');
  res.redirect(`/admin/products/${product.id}/edit`);
});

// ---------- Filter Tags ----------
router.get('/filter-tags', (req, res) => {
  const filterTags = store.data.filterTags.map(t => ({
    ...t, productCount: store.data.products.filter(p => (p.filterTagIds || []).includes(t.id)).length,
  }));
  res.render('admin/filter-tags', { title: 'ตัวกรองสินค้า', active: 'filter-tags', filterTags });
});

router.post('/filter-tags', (req, res) => {
  productImageUpload.single('filterImage')(req, res, async (err) => {
    if (err || !req.file) {
      req.flash('error', 'กรุณาแนบรูปตัวกรอง (ไฟล์รูปไม่เกิน 8MB)');
      return res.redirect('/admin/filter-tags');
    }
    const name = (req.body.name || '').trim();
    if (!name) {
      req.flash('error', 'กรุณากรอกชื่อตัวกรอง');
      return res.redirect('/admin/filter-tags');
    }
    try {
      const image = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      store.data.filterTags.push({ id: store.genId(8), name, image, createdAt: new Date().toISOString() });
      store.save();
      req.flash('success', 'เพิ่มตัวกรองและอัปโหลดรูปแล้ว');
    } catch (saveError) {
      req.flash('error', 'บันทึกรูปตัวกรองไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/filter-tags');
  });
});

router.post('/filter-tags/:id/delete', (req, res) => {
  store.data.filterTags = store.data.filterTags.filter(t => t.id !== req.params.id);
  store.data.products.forEach(p => {
    if (p.filterTagIds) p.filterTagIds = p.filterTagIds.filter(id => id !== req.params.id);
  });
  store.save();
  req.flash('success', 'ลบตัวกรองสินค้าแล้ว');
  res.redirect('/admin/filter-tags');
});

// ---------- Stock management ----------
router.get('/products/:id/stock', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  const stockItems = store.data.stockItems.filter(s => s.productId === product.id)
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  res.render('admin/product-stock', { title: `สต๊อกสินค้า: ${product.title}`, active: 'products', product, stockItems });
});

router.get('/scheduled-products', (req, res) => {
  const products = store.data.products
    .filter(product => product.publishAt)
    .sort((a, b) => String(a.publishAt).localeCompare(String(b.publishAt)));
  res.render('admin/scheduled-products', { title: 'ตั้งเวลาเปิดขาย', active: 'scheduled-products', products });
});

router.post('/products/:id/stock/settings', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  product.fulfillmentMode = req.body.fulfillmentMode === 'contact' ? 'contact' : 'automatic';
  product.fulfillmentInstructions = (req.body.fulfillmentInstructions || '').trim();
  store.save();
  req.flash('success', 'บันทึกวิธีรับสินค้าแล้ว');
  res.redirect(`/admin/products/${product.id}/stock`);
});

router.post('/products/:id/stock/add', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  if (product.fulfillmentMode === 'contact') {
    const quantity = Math.min(1000, Math.max(0, parseInt(req.body.quantity, 10) || 0));
    for (let i = 0; i < quantity; i++) {
      store.data.stockItems.push({
        id: store.genId(10), productId: product.id, username: '', password: '', extra: '',
        fulfillmentMode: 'contact', status: 'available', soldOrderId: null, addedAt: new Date().toISOString(),
      });
    }
    store.save();
    req.flash(quantity ? 'success' : 'error', quantity ? `เพิ่มจำนวนพร้อมขายแล้ว ${quantity} รายการ` : 'กรุณาระบุจำนวนที่ต้องการเพิ่ม');
    return res.redirect(`/admin/products/${product.id}/stock`);
  }
  const lines = (req.body.bulk || '').split('\n').map(l => l.trim()).filter(Boolean);
  let added = 0;
  lines.forEach(line => {
    const [username, password, ...rest] = line.split(':').map(s => s.trim());
    if (!username || !password) return;
    store.data.stockItems.push({
      id: store.genId(10), productId: product.id, username, password,
      extra: rest.join(':') || '', fulfillmentMode: 'automatic', status: 'available', soldOrderId: null,
      addedAt: new Date().toISOString(),
    });
    added++;
  });
  store.save();
  req.flash('success', `เพิ่มสต๊อกสินค้าแล้ว ${added} รายการ`);
  res.redirect(`/admin/products/${product.id}/stock`);
});

router.post('/products/:id/stock/:stockId/delete', (req, res) => {
  store.data.stockItems = store.data.stockItems.filter(s => s.id !== req.params.stockId);
  store.save();
  req.flash('success', 'ลบไอดีออกจากสต๊อกแล้ว');
  res.redirect(`/admin/products/${req.params.id}/stock`);
});

// ---------- Orders ----------
router.get('/orders', (req, res) => {
  const orders = [...store.data.orders]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(o => ({ ...o, buyer: store.data.users.find(u => u.id === o.userId) }));
  res.render('admin/orders', { title: 'คำสั่งซื้อ', active: 'orders', orders });
});

router.get('/orders/:id', (req, res) => {
  const order = store.data.orders.find(o => o.id === req.params.id);
  if (!order) { req.flash('error', 'ไม่พบคำสั่งซื้อ'); return res.redirect('/admin/orders'); }
  const buyer = store.data.users.find(u => u.id === order.userId);
  const itemsWithCreds = order.items.map(oi => ({
    ...oi, credentials: store.data.stockItems.find(s => s.id === oi.stockItemId),
  }));
  res.render('admin/order-detail', { title: `คำสั่งซื้อ #${order.id}`, active: 'orders', order, buyer, itemsWithCreds });
});

router.post('/orders/:id/status', (req, res) => {
  const order = store.data.orders.find(o => o.id === req.params.id);
  if (order) {
    order.status = req.body.status;
    store.save();
    req.flash('success', 'อัปเดตสถานะคำสั่งซื้อแล้ว');
  }
  res.redirect(`/admin/orders/${req.params.id}`);
});

// ---------- Users ----------
router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const needle = q.toLocaleLowerCase('th-TH');
  const users = [...store.data.users]
    .filter(user => !needle
      || String(user.username || '').toLocaleLowerCase('th-TH').includes(needle)
      || String(user.email || '').toLocaleLowerCase('th-TH').includes(needle))
    .sort((a, b) => String(a.username || '').localeCompare(String(b.username || ''), 'th'));
  res.render('admin/users', { title: 'สมาชิก', active: 'users', users, q, totalUsers: store.data.users.length });
});

router.post('/users/:id/wallet', (req, res) => {
  const user = store.data.users.find(u => u.id === req.params.id);
  const amount = parseInt(req.body.amount, 10);
  if (user && amount) {
    user.walletBalance += amount;
    store.data.walletTransactions.push({
      id: store.genId(10), userId: user.id, type: 'adjust', amount,
      note: `ผู้ดูแลระบบปรับยอด (${req.body.note || 'ไม่มีหมายเหตุ'})`, createdAt: new Date().toISOString(),
    });
    store.save();
    req.flash('success', 'ปรับยอดเงินสำเร็จ');
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/toggle-ban', (req, res) => {
  const user = store.data.users.find(u => u.id === req.params.id);
  if (user && user.role !== 'admin') {
    user.status = user.status === 'banned' ? 'active' : 'banned';
    store.save();
    req.flash('success', user.status === 'banned' ? 'ระงับบัญชีแล้ว' : 'ปลดระงับบัญชีแล้ว');
  }
  res.redirect('/admin/users');
});

router.post('/users/new', (req, res) => {
  const { username, email, password, role } = req.body;
  if (store.data.users.some(u => u.username === username)) {
    req.flash('error', 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
    return res.redirect('/admin/users');
  }
  store.data.users.push({
    id: store.genId(8), username, email, passwordHash: bcrypt.hashSync(password || '123456', 10),
    role: role === 'admin' ? 'admin' : 'customer', walletBalance: 0, status: 'active', createdAt: new Date().toISOString(),
  });
  store.save();
  req.flash('success', 'เพิ่มสมาชิกแล้ว');
  res.redirect('/admin/users');
});

// ---------- Top-up requests ----------
router.get('/topups', (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
  const needle = q.toLocaleLowerCase('th-TH');
  const requests = [...store.data.topupRequests]
    .map(t => ({ ...t, buyer: store.data.users.find(u => u.id === t.userId) }))
    .filter(request => {
      if (status && request.status !== status) return false;
      if (!needle) return true;
      return String(request.refCode || '').toLocaleLowerCase('th-TH').includes(needle)
        || String(request.buyer && request.buyer.username || '').toLocaleLowerCase('th-TH').includes(needle)
        || String(request.buyer && request.buyer.email || '').toLocaleLowerCase('th-TH').includes(needle);
    })
    .sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  const pendingCount = store.data.topupRequests.filter(t => t.status === 'pending').length;
  res.render('admin/topups', { title: 'บัญชี', active: 'topups', requests, pendingCount, payment: store.data.settings.payment, q, status });
});

router.post('/topups/payment-settings', (req, res) => {
  qrImageUpload.fields([
    { name: 'promptpayQrImage', maxCount: 1 },
    { name: 'bankQrImage', maxCount: 1 },
  ])(req, res, async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูป QR ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/topups');
    }
    const { promptpayId, promptpayName, bankName, bankAccountNumber, bankAccountName } = req.body;
    Object.assign(store.data.settings.payment, { promptpayId, promptpayName, bankName, bankAccountNumber, bankAccountName });

    if (req.body.removePromptpayQrImage === 'on') store.data.settings.payment.promptpayQrImage = null;
    if (req.body.removeBankQrImage === 'on') store.data.settings.payment.bankQrImage = null;
    try {
      const promptpayFile = req.files && req.files.promptpayQrImage && req.files.promptpayQrImage[0];
      const bankFile = req.files && req.files.bankQrImage && req.files.bankQrImage[0];
      if (promptpayFile) {
        store.data.settings.payment.promptpayQrImage = await store.saveMedia(promptpayFile.buffer, promptpayFile.originalname, promptpayFile.mimetype);
      }
      if (bankFile) {
        store.data.settings.payment.bankQrImage = await store.saveMedia(bankFile.buffer, bankFile.originalname, bankFile.mimetype);
      }
    } catch (saveError) {
      req.flash('error', 'บันทึกรูป QR ไม่สำเร็จ กรุณาลองใหม่');
      return res.redirect('/admin/topups');
    }

    store.save();
    req.flash('success', 'บันทึกข้อมูลบัญชีรับเงินแล้ว');
    res.redirect('/admin/topups');
  });
});

router.post('/topups/:id/approve', (req, res) => {
  const request = store.data.topupRequests.find(t => t.id === req.params.id);
  if (!request) { req.flash('error', 'ไม่พบคำขอ'); return res.redirect('/admin/topups'); }
  if (request.status !== 'pending') { req.flash('error', 'คำขอนี้ถูกตรวจสอบไปแล้ว'); return res.redirect('/admin/topups'); }
  const user = store.data.users.find(u => u.id === request.userId);
  if (!user) { req.flash('error', 'ไม่พบผู้ใช้'); return res.redirect('/admin/topups'); }

  user.walletBalance += request.amount;
  store.data.walletTransactions.push({
    id: store.genId(10), userId: user.id, type: 'topup', amount: request.amount,
    note: `เติมเงินสำเร็จ (อ้างอิง ${request.refCode})`, createdAt: new Date().toISOString(),
  });
  request.status = 'approved';
  request.reviewedAt = new Date().toISOString();
  store.save();
  req.flash('success', `อนุมัติคำขอเติมเงิน ${request.amount.toLocaleString()} บาท ให้ ${user.username} แล้ว`);
  res.redirect('/admin/topups');
});

router.post('/topups/:id/reject', (req, res) => {
  const request = store.data.topupRequests.find(t => t.id === req.params.id);
  if (!request) { req.flash('error', 'ไม่พบคำขอ'); return res.redirect('/admin/topups'); }
  if (request.status !== 'pending') { req.flash('error', 'คำขอนี้ถูกตรวจสอบไปแล้ว'); return res.redirect('/admin/topups'); }
  request.status = 'rejected';
  request.reviewedAt = new Date().toISOString();
  request.reviewNote = req.body.reviewNote || '';
  store.save();
  req.flash('success', 'ปฏิเสธคำขอเติมเงินแล้ว');
  res.redirect('/admin/topups');
});

// ---------- Coupons ----------
router.get('/coupons', (req, res) => {
  res.render('admin/coupons', { title: 'คูปองส่วนลด', active: 'coupons', coupons: store.data.coupons });
});

router.post('/coupons', (req, res) => {
  const { code, type, value, usageLimit } = req.body;
  store.data.coupons.push({
    id: store.genId(8), code: code.toUpperCase(), type: type === 'fixed' ? 'fixed' : 'percent',
    value: parseInt(value, 10) || 0, active: true, usageLimit: parseInt(usageLimit, 10) || 0,
    usedCount: 0, expiresAt: null, createdAt: new Date().toISOString(),
  });
  store.save();
  req.flash('success', 'เพิ่มคูปองแล้ว');
  res.redirect('/admin/coupons');
});

router.post('/coupons/:id/toggle', (req, res) => {
  const coupon = store.data.coupons.find(c => c.id === req.params.id);
  if (coupon) { coupon.active = !coupon.active; store.save(); }
  res.redirect('/admin/coupons');
});

router.post('/coupons/:id/delete', (req, res) => {
  store.data.coupons = store.data.coupons.filter(c => c.id !== req.params.id);
  store.save();
  req.flash('success', 'ลบคูปองแล้ว');
  res.redirect('/admin/coupons');
});

// ---------- Mini game ----------
router.get('/minigame', (req, res) => {
  const totalPercent = store.data.miniGamePrizes
    .filter(p => p.active)
    .reduce((sum, p) => sum + Number(p.percent), 0);
  res.render('admin/minigame', {
    title: 'มินิเกม', active: 'minigame',
    game: store.data.settings.miniGame,
    prizes: store.data.miniGamePrizes,
    totalPercent,
    recentPlays: store.data.miniGamePlays.slice(0, 30),
  });
});

router.post('/minigame/settings', (req, res) => {
  const { title, description, costPerPlay } = req.body;
  Object.assign(store.data.settings.miniGame, {
    title: title || store.data.settings.miniGame.title,
    description: description || '',
    costPerPlay: Math.max(0, parseInt(costPerPlay, 10) || 0),
  });
  store.save();
  req.flash('success', 'บันทึกการตั้งค่ามินิเกมแล้ว');
  res.redirect('/admin/minigame');
});

router.post('/minigame/toggle', (req, res) => {
  store.data.settings.miniGame.enabled = !store.data.settings.miniGame.enabled;
  store.save();
  req.flash('success', store.data.settings.miniGame.enabled ? 'เปิดใช้งานมินิเกมแล้ว' : 'ปิดใช้งานมินิเกมแล้ว');
  res.redirect('/admin/minigame');
});

router.post('/minigame/prizes', (req, res) => {
  prizeImageUpload.single('image')(req, res, async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูปไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/minigame');
    }
    const { name, percent, stock } = req.body;
    if (!name || !name.trim()) {
      req.flash('error', 'กรุณากรอกชื่อรางวัล');
      return res.redirect('/admin/minigame');
    }
    let image = null;
    if (req.file) {
      try {
        image = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      } catch (saveError) {
        req.flash('error', 'บันทึกรูปไม่สำเร็จ กรุณาลองใหม่');
        return res.redirect('/admin/minigame');
      }
    }
    store.data.miniGamePrizes.push({
      id: store.genId(8), name: name.trim(),
      percent: Math.max(0, Math.min(100, Number(percent) || 0)),
      stock: stock === '' || stock === undefined ? null : Math.max(0, parseInt(stock, 10) || 0),
      isPrize: req.body.isPrize === 'on',
      image, active: true, createdAt: new Date().toISOString(),
    });
    store.save();
    req.flash('success', 'เพิ่มของรางวัลแล้ว');
    res.redirect('/admin/minigame');
  });
});

router.post('/minigame/prizes/:id/image', (req, res) => {
  prizeImageUpload.single('image')(req, res, async (err) => {
    const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
    if (err || !req.file || !prize) {
      req.flash('error', 'อัปโหลดรูปไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/minigame');
    }
    try {
      prize.image = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      store.save();
      req.flash('success', `เปลี่ยนรูป "${prize.name}" แล้ว`);
    } catch (saveError) {
      req.flash('error', 'บันทึกรูปไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/minigame');
  });
});

router.post('/minigame/prizes/:id/image/remove', (req, res) => {
  const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
  if (prize) { prize.image = null; store.save(); }
  res.redirect('/admin/minigame');
});

router.post('/minigame/preview', (req, res) => {
  const prize = pickPrize(store.data.miniGamePrizes);
  if (!prize) {
    return res.status(400).json({ error: 'ของรางวัลหมดชั่วคราวหรือยังไม่ได้ตั้งค่าอัตราออก' });
  }
  res.json({
    ok: true,
    prizeName: prize.name,
    image: prize.image || null,
    isWin: Boolean(prize.isPrize),
    claimCode: prize.isPrize ? 'PREVIEW' : null,
  });
});

router.post('/minigame/prizes/:id', (req, res) => {
  const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
  if (!prize) { req.flash('error', 'ไม่พบของรางวัลนี้'); return res.redirect('/admin/minigame'); }
  const { name, percent, stock } = req.body;
  Object.assign(prize, {
    name: name && name.trim() ? name.trim() : prize.name,
    percent: Math.max(0, Math.min(100, Number(percent) || 0)),
    stock: stock === '' || stock === undefined ? null : Math.max(0, parseInt(stock, 10) || 0),
    isPrize: req.body.isPrize === 'on',
  });
  store.save();
  req.flash('success', 'บันทึกของรางวัลแล้ว');
  res.redirect('/admin/minigame');
});

router.post('/minigame/prizes/:id/restock', (req, res) => {
  const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
  const addAmount = Math.max(0, parseInt(req.body.addStock, 10) || 0);
  if (prize && prize.stock !== null) {
    prize.stock += addAmount;
    store.save();
    req.flash('success', `เติมสต็อก "${prize.name}" อีก ${addAmount} ชิ้นแล้ว`);
  }
  res.redirect('/admin/minigame');
});

router.post('/minigame/prizes/:id/toggle', (req, res) => {
  const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
  if (prize) { prize.active = !prize.active; store.save(); }
  res.redirect('/admin/minigame');
});

router.post('/minigame/prizes/:id/delete', (req, res) => {
  store.data.miniGamePrizes = store.data.miniGamePrizes.filter(p => p.id !== req.params.id);
  store.save();
  req.flash('success', 'ลบของรางวัลแล้ว');
  res.redirect('/admin/minigame');
});

router.post('/minigame/plays/:id/deliver', (req, res) => {
  const play = store.data.miniGamePlays.find(pl => pl.id === req.params.id);
  if (play && play.isWin) {
    play.status = play.status === 'delivered' ? 'pending' : 'delivered';
    store.save();
  }
  res.redirect('/admin/minigame');
});

// ---------- License plans (sell rental keys) ----------
// Only exists on the seller's own shop, never on a rented deployment
// (LICENSE_GATE=on) — a customer must not be able to resell this system.
router.use('/license-plans', (req, res, next) => {
  if (license.isGateOn()) return res.status(404).render('shop/404', { layout: 'layouts/main', title: 'ไม่พบหน้านี้' });
  next();
});

router.get('/license-plans', (req, res) => {
  const sales = store.data.licenseSales.slice(0, 50).map(sale => {
    const verified = license.isEnabled() ? license.verifyKey(sale.key) : {};
    return { ...sale, exp: verified.exp || null };
  });
  res.render('admin/license-plans', {
    title: 'ขายคีย์เช่าเว็บ', active: 'license-plans',
    plans: store.data.licensePlans,
    sales,
    licenseEnabled: license.isEnabled(),
    releaseEnabled: github.isEnabled(),
  });
});

// Admin picks a specific rented site and updates just that one, on demand —
// uses the scoped per-project token captured at provisioning time (never
// the customer's real account token), so no need to involve the customer.
router.post('/license-plans/sale/:id/sync', async (req, res) => {
  const sale = store.data.licenseSales.find(s => s.id === req.params.id);
  const p = sale && sale.provisioning;
  if (!p || !p.projectToken || !p.serviceId || !p.environmentId) {
    req.flash('error', 'เว็บนี้ยังไม่มีโทเค็นสำหรับอัพเดตอัตโนมัติ (อาจเป็นเว็บเก่าก่อนมีฟีเจอร์นี้) ให้ลูกค้ากดปุ่ม "ซิงค์ตอนนี้" ที่หน้าใบเสร็จของเขาแทน');
    return res.redirect('/admin/license-plans');
  }
  const result = await railway.redeployService({
    railwayToken: p.projectToken, serviceId: p.serviceId, environmentId: p.environmentId,
  });
  req.flash(result.ok ? 'success' : 'error', result.ok
    ? `สั่งอัพเดตเว็บของ ${sale.username} แล้ว รอสักครู่`
    : `อัพเดตไม่สำเร็จ: ${result.error}`);
  res.redirect('/admin/license-plans');
});

// Update EVERY rented site in one click — no key entry needed, since it
// reuses each site's own scoped token captured at provisioning time. This
// only re-pulls whatever is currently on the release branch; it does NOT
// merge your latest code into that branch (see /release-update below for
// that optional, separate step).
router.post('/license-plans/update-all', async (req, res) => {
  const targets = store.data.licenseSales.filter(s => s.type === 'new_site' && s.provisioning && s.provisioning.projectToken);
  if (!targets.length) {
    req.flash('error', 'ยังไม่มีเว็บลูกค้าที่อัพเดตอัตโนมัติได้ (ต้องเป็นเว็บที่สร้างหลังมีฟีเจอร์นี้)');
    return res.redirect('/admin/license-plans');
  }
  const results = await Promise.all(targets.map(sale => railway.redeployService({
    railwayToken: sale.provisioning.projectToken,
    serviceId: sale.provisioning.serviceId,
    environmentId: sale.provisioning.environmentId,
  }).then(r => ({ sale, r }))));
  const okCount = results.filter(x => x.r.ok).length;
  req.flash(okCount === results.length ? 'success' : 'error',
    `สั่งอัพเดตเว็บลูกค้าสำเร็จ ${okCount}/${results.length} เว็บ`);
  res.redirect('/admin/license-plans');
});

router.post('/license-plans/release-update', async (req, res) => {
  const result = await github.releaseUpdate();
  if (result.ok) {
    req.flash('success', result.note || 'ปล่อยอัพเดตให้เว็บลูกค้าแล้ว! บอกลูกค้าให้กดปุ่ม "ซิงค์ตอนนี้" ที่หน้าใบเสร็จของเขาเพื่อดึงอัพเดตเข้าเว็บตัวเอง');
  } else {
    req.flash('error', 'ปล่อยอัพเดตไม่สำเร็จ: ' + result.error);
  }
  res.redirect('/admin/license-plans');
});

router.post('/license-plans', (req, res) => {
  const days = Math.max(1, parseInt(req.body.days, 10) || 0);
  const price = Math.max(0, Number(req.body.price) || 0);
  if (!days || !price) {
    req.flash('error', 'กรุณากรอกจำนวนวันและราคาให้ถูกต้อง');
    return res.redirect('/admin/license-plans');
  }
  store.data.licensePlans.push({ id: store.genId(8), days, price, active: true, createdAt: new Date().toISOString() });
  store.save();
  req.flash('success', 'เพิ่มแพ็กเกจแล้ว');
  res.redirect('/admin/license-plans');
});

router.post('/license-plans/:id/edit', (req, res) => {
  const plan = store.data.licensePlans.find(p => p.id === req.params.id);
  if (!plan) {
    req.flash('error', 'ไม่พบแพ็กเกจนี้');
    return res.redirect('/admin/license-plans');
  }
  const days = Math.max(1, parseInt(req.body.days, 10) || 0);
  const price = Math.max(0, Number(req.body.price) || 0);
  if (!days || !price) {
    req.flash('error', 'กรุณากรอกจำนวนวันและราคาให้ถูกต้อง');
    return res.redirect('/admin/license-plans');
  }
  plan.days = days;
  plan.price = price;
  store.save();
  req.flash('success', 'แก้ไขแพ็กเกจแล้ว');
  res.redirect('/admin/license-plans');
});

router.post('/license-plans/:id/toggle', (req, res) => {
  const plan = store.data.licensePlans.find(p => p.id === req.params.id);
  if (plan) { plan.active = !plan.active; store.save(); }
  res.redirect('/admin/license-plans');
});

router.post('/license-plans/:id/delete', (req, res) => {
  store.data.licensePlans = store.data.licensePlans.filter(p => p.id !== req.params.id);
  store.save();
  req.flash('success', 'ลบแพ็กเกจแล้ว');
  res.redirect('/admin/license-plans');
});

// ---------- Announcements ----------
router.get('/announcements', (req, res) => {
  res.render('admin/announcements', { title: 'ประกาศ', active: 'announcements', announcements: store.data.announcements });
});

router.post('/announcements', (req, res) => {
  const { title, body } = req.body;
  store.data.announcements.push({
    id: store.genId(8), title, body, active: true, createdAt: new Date().toISOString(),
  });
  store.save();
  req.flash('success', 'เพิ่มประกาศแล้ว');
  res.redirect('/admin/announcements');
});

router.post('/announcements/:id/toggle', (req, res) => {
  const a = store.data.announcements.find(x => x.id === req.params.id);
  if (a) { a.active = !a.active; store.save(); }
  res.redirect('/admin/announcements');
});

router.post('/announcements/:id/delete', (req, res) => {
  store.data.announcements = store.data.announcements.filter(x => x.id !== req.params.id);
  store.save();
  req.flash('success', 'ลบประกาศแล้ว');
  res.redirect('/admin/announcements');
});

// ---------- Settings ----------
router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'ตั้งค่าร้าน', active: 'settings', licenseEnabled: license.isGateOn() });
});

router.get('/appearance', (req, res) => {
  res.render('admin/appearance', { title: 'รูปหน้าเว็บและโลโก้', active: 'appearance' });
});

router.post('/settings', (req, res) => {
  const { shopName, tagline, contactLine, contactFacebook, contactMessenger, contactFacebookName, contactResponseTime, openHours } = req.body;
  Object.assign(store.data.settings, { shopName, tagline, contactLine, contactFacebook, contactMessenger, contactFacebookName, contactResponseTime, openHours });
  store.save();
  req.flash('success', 'บันทึกการตั้งค่าแล้ว');
  res.redirect('/admin/settings');
});

// ---------- Music player ----------
function parseTimeToSeconds(str) {
  if (!str) return 0;
  const s = str.trim();
  if (!s) return 0;
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => parseInt(p, 10) || 0);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

function extractYouTubeVideoId(input) {
  const value = (input || '').trim();
  const validId = id => (/^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null);
  if (validId(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').replace(/^music\./, '');
    if (host === 'youtu.be') return validId(url.pathname.split('/').filter(Boolean)[0]);
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const queryId = url.searchParams.get('v');
      if (queryId) return validId(queryId);
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) return validId(parts[1]);
    }
  } catch (err) {
    return null;
  }
  return null;
}

router.post('/music-player', (req, res) => {
  const enabled = req.body.enabled === 'on';
  const youtubeUrl = (req.body.youtubeUrl || '').trim();
  let defaultVolume = parseInt(req.body.defaultVolume, 10);
  if (Number.isNaN(defaultVolume)) defaultVolume = 50;
  defaultVolume = Math.max(0, Math.min(100, defaultVolume));

  const startSeconds = Math.max(0, parseTimeToSeconds(req.body.startTime));
  const endSeconds = Math.max(0, parseTimeToSeconds(req.body.endTime));

  if (enabled && !youtubeUrl) {
    req.flash('error', 'กรุณาใส่ลิงก์ YouTube ก่อนเปิดใช้งานเพลง');
    return res.redirect('/admin/settings');
  }
  if (enabled && !extractYouTubeVideoId(youtubeUrl)) {
    req.flash('error', 'ลิงก์นี้ไม่ใช่วิดีโอ YouTube ที่รองรับ กรุณาใช้ลิงก์วิดีโอแบบ watch, youtu.be, Shorts หรือ Live (ไม่รองรับลิงก์ Playlist อย่างเดียว)');
    return res.redirect('/admin/settings');
  }
  if (endSeconds > 0 && endSeconds <= startSeconds) {
    req.flash('error', 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น');
    return res.redirect('/admin/settings');
  }

  store.data.settings.music = { enabled, youtubeUrl, defaultVolume, startSeconds, endSeconds };
  store.save();
  req.flash('success', 'บันทึกการตั้งค่าเพลงหน้าเว็บแล้ว');
  res.redirect('/admin/settings');
});

// ---------- Snow effect ----------
router.post('/snow-toggle', (req, res) => {
  store.data.settings.snow = { enabled: req.body.enabled === 'on' };
  store.save();
  req.flash('success', store.data.settings.snow.enabled ? 'เปิดใช้งานหิมะตกแล้ว' : 'ปิดใช้งานหิมะตกแล้ว');
  res.redirect('/admin/settings');
});

// ---------- Hero banner ----------
router.post('/site-logo/upload', (req, res) => {
  logoUpload.single('logoImage')(req, res, async (err) => {
    if (err || !req.file) {
      req.flash('error', 'อัปโหลดโลโก้ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/appearance');
    }
    try {
      store.data.settings.branding.logoImage = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      store.save();
      req.flash('success', 'อัปโหลดโลโก้เว็บไซต์แล้ว และจะไม่หายเมื่อ Deploy');
    } catch (saveError) {
      req.flash('error', 'บันทึกโลโก้ไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/appearance');
  });
});

router.post('/hero-banner/upload', (req, res) => {
  bannerUpload.single('bannerImage')(req, res, async (err) => {
    if (err || !req.file) {
      req.flash('error', 'อัปโหลดแบนเนอร์ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 8MB)');
      return res.redirect('/admin/appearance');
    }
    try {
      store.data.settings.hero.bannerImage = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      store.save();
      req.flash('success', 'อัปโหลดแบนเนอร์แล้ว และจะไม่หายเมื่อ Deploy');
    } catch (saveError) {
      req.flash('error', 'บันทึกแบนเนอร์ไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/appearance');
  });
});

router.post('/hero-banner/mode', (req, res) => {
  const mode = req.body.mode === 'banner' ? 'banner' : 'default';
  if (mode === 'banner' && !store.data.settings.hero.bannerImage) {
    req.flash('error', 'กรุณาอัปโหลดรูปแบนเนอร์ก่อนเปิดใช้งานโหมดแบนเนอร์');
    return res.redirect('/admin/appearance');
  }
  store.data.settings.hero.mode = mode;
  store.data.settings.hero.bannerLink = req.body.bannerLink || '';
  store.save();
  req.flash('success', mode === 'banner' ? 'เปิดใช้งานแบนเนอร์หน้าหลักแล้ว' : 'กลับไปใช้หน้าหลักแบบเดิมแล้ว');
  res.redirect('/admin/appearance');
});

module.exports = router;
