const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const store = require('../data/store');
const { requireAdmin } = require('../middleware/auth');

const bannerUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'public', 'uploads', 'banner'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `hero-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

router.use(requireAdmin);
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  res.locals.pendingTopupCount = store.data.topupRequests.filter(t => t.status === 'pending').length;
  next();
});

function slugify(str) {
  return str.toString().toLowerCase().trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// ---------- Dashboard ----------
router.get('/', (req, res) => {
  const { orders, users, products, stockItems } = store.data;
  const revenue = orders.reduce((sum, o) => sum + o.total, 0);
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
    },
    lowStockProducts,
    recentOrders,
  });
});

// ---------- Products ----------
function parseProductBody(body) {
  const images = (body.images || '').split('\n').map(s => s.trim()).filter(Boolean);
  const genres = Array.isArray(body.genres) ? body.genres : (body.genres ? [body.genres] : []);
  const filterTagIds = Array.isArray(body.filterTagIds) ? body.filterTagIds : (body.filterTagIds ? [body.filterTagIds] : []);
  return {
    title: body.title,
    type: body.type === 'rental' ? 'rental' : 'offline',
    platform: body.platform || 'Windows',
    genres,
    filterTagIds,
    price: parseInt(body.price, 10) || 0,
    originalPrice: parseInt(body.originalPrice, 10) || 0,
    description: body.description || '',
    aboutText: body.aboutText || '',
    images: images.length ? images : ['https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800'],
    sysReqMin: {
      os: body.minOs || 'Windows 10 / 11 (64-bit)', processor: body.minProcessor || '-',
      memory: body.minMemory || '-', graphics: body.minGraphics || '-',
      directx: body.minDirectx || 'Version 12', storage: body.minStorage || '-',
    },
    sysReqRec: {
      os: body.recOs || 'Windows 10 / 11 (64-bit)', processor: body.recProcessor || '-',
      memory: body.recMemory || '-', graphics: body.recGraphics || '-',
      directx: body.recDirectx || 'Version 12', storage: body.recStorage || '-',
    },
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
  const fields = parseProductBody(req.body);
  const product = {
    id: store.genId(8), slug: slugify(fields.title) + '-' + store.genId(4),
    ...fields, status: 'active', createdAt: new Date().toISOString(),
  };
  store.data.products.push(product);
  store.save();
  req.flash('success', 'เพิ่มสินค้าแล้ว');
  res.redirect('/admin/products');
});

router.get('/products/:id/edit', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  res.render('admin/product-form', { title: 'แก้ไขสินค้า', active: 'products', product, genres: store.data.settings.genres, filterTags: store.data.filterTags });
});

router.post('/products/:id/edit', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  const fields = parseProductBody(req.body);
  Object.assign(product, fields, { status: req.body.status || 'active' });
  store.save();
  req.flash('success', 'บันทึกการแก้ไขแล้ว');
  res.redirect('/admin/products');
});

router.post('/products/:id/delete', (req, res) => {
  store.data.products = store.data.products.filter(p => p.id !== req.params.id);
  store.data.stockItems = store.data.stockItems.filter(s => s.productId !== req.params.id);
  store.save();
  req.flash('success', 'ลบสินค้าแล้ว');
  res.redirect('/admin/products');
});

// ---------- Filter Tags ----------
router.get('/filter-tags', (req, res) => {
  const filterTags = store.data.filterTags.map(t => ({
    ...t, productCount: store.data.products.filter(p => (p.filterTagIds || []).includes(t.id)).length,
  }));
  res.render('admin/filter-tags', { title: 'ตัวกรองสินค้า', active: 'filter-tags', filterTags });
});

router.post('/filter-tags', (req, res) => {
  const { name, image } = req.body;
  if (!name || !image) {
    req.flash('error', 'กรุณากรอกชื่อและ URL รูปภาพ');
    return res.redirect('/admin/filter-tags');
  }
  store.data.filterTags.push({ id: store.genId(8), name, image, createdAt: new Date().toISOString() });
  store.save();
  req.flash('success', 'เพิ่มตัวกรองสินค้าแล้ว');
  res.redirect('/admin/filter-tags');
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
  res.render('admin/product-stock', { title: `สต๊อกไอดี: ${product.title}`, active: 'products', product, stockItems });
});

router.post('/products/:id/stock/add', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  const lines = (req.body.bulk || '').split('\n').map(l => l.trim()).filter(Boolean);
  let added = 0;
  lines.forEach(line => {
    const [username, password, ...rest] = line.split(':').map(s => s.trim());
    if (!username || !password) return;
    store.data.stockItems.push({
      id: store.genId(10), productId: product.id, username, password,
      extra: rest.join(':') || '', status: 'available', soldOrderId: null,
      steamGuardRequests: 0, steamGuardCode: null,
      addedAt: new Date().toISOString(),
    });
    added++;
  });
  store.save();
  req.flash('success', `เพิ่มสต๊อกไอดีแล้ว ${added} รายการ (รูปแบบ username:password:หมายเหตุ)`);
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
  res.render('admin/users', { title: 'สมาชิก', active: 'users', users: store.data.users });
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
  const requests = [...store.data.topupRequests]
    .sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .map(t => ({ ...t, buyer: store.data.users.find(u => u.id === t.userId) }));
  const pendingCount = store.data.topupRequests.filter(t => t.status === 'pending').length;
  res.render('admin/topups', { title: 'บัญชี', active: 'topups', requests, pendingCount, payment: store.data.settings.payment });
});

router.post('/topups/payment-settings', (req, res) => {
  const { promptpayId, promptpayName, bankName, bankAccountNumber, bankAccountName } = req.body;
  Object.assign(store.data.settings.payment, { promptpayId, promptpayName, bankName, bankAccountNumber, bankAccountName });
  store.save();
  req.flash('success', 'บันทึกข้อมูลบัญชีรับเงินแล้ว');
  res.redirect('/admin/topups');
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
  res.render('admin/settings', { title: 'ตั้งค่าร้าน', active: 'settings' });
});

router.post('/settings', (req, res) => {
  const { shopName, tagline, contactLine, contactFacebook, openHours } = req.body;
  Object.assign(store.data.settings, { shopName, tagline, contactLine, contactFacebook, openHours });
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
router.post('/hero-banner/upload', (req, res) => {
  bannerUpload.single('bannerImage')(req, res, (err) => {
    if (err || !req.file) {
      req.flash('error', 'อัปโหลดแบนเนอร์ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 8MB)');
      return res.redirect('/admin/settings');
    }
    store.data.settings.hero.bannerImage = `/uploads/banner/${req.file.filename}`;
    store.save();
    req.flash('success', 'อัปโหลดแบนเนอร์แล้ว');
    res.redirect('/admin/settings');
  });
});

router.post('/hero-banner/mode', (req, res) => {
  const mode = req.body.mode === 'banner' ? 'banner' : 'default';
  if (mode === 'banner' && !store.data.settings.hero.bannerImage) {
    req.flash('error', 'กรุณาอัปโหลดรูปแบนเนอร์ก่อนเปิดใช้งานโหมดแบนเนอร์');
    return res.redirect('/admin/settings');
  }
  store.data.settings.hero.mode = mode;
  store.data.settings.hero.bannerLink = req.body.bannerLink || '';
  store.save();
  req.flash('success', mode === 'banner' ? 'เปิดใช้งานแบนเนอร์หน้าหลักแล้ว' : 'กลับไปใช้หน้าหลักแบบเดิมแล้ว');
  res.redirect('/admin/settings');
});

module.exports = router;
