const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const store = require('../data/store');
const { pickPrize } = require('../services/minigame');
const license = require('../services/license');
const easyslip = require('../services/easyslip');
const byshop = require('../services/byshop');
const slipok = require('../services/slipok');
const slip2go = require('../services/slip2go');
const theme = require('../services/theme');
const discordBot = require('../services/discord-bot');
const { MAIN_SITE_URL, MAIN_DOMAIN } = require('../middleware/tenant');
const { requireAdmin } = require('../middleware/auth');

const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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

// Folder-import: one product per image file, so the cap tracks how many
// products a single import can create rather than how many photos one
// product can have.
const bulkProductImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 60 },
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
  res.locals.pendingTopupCount = store.data.topupRequests.filter(t => t.status === 'pending' || t.status === 'verifying').length;
  res.locals.persistentStorageEnabled = store.isPersistent();
  next();
});

function slugify(str) {
  return String(str || '').toLowerCase().trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function safeExternalUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url.slice(0, 1000) : '';
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
    licenseLabel: license.isGateOn() ? store.data.settings.license.label : null,
    // Multi-tenant shop (see src/middleware/tenant.js) — expiresAt lives in
    // the main site's shops directory, stashed on req by that middleware.
    shopExpiresAt: req.tenantShop ? req.tenantShop.expiresAt : null,
    shopName: req.tenantShop ? req.tenantShop.name : null,
    shopRenewUrl: MAIN_SITE_URL ? `${MAIN_SITE_URL}/my-shops` : null,
  });
});

// Lets the owner of a rented site rename the label shown on their own
// /license page (independent of whatever name was baked into the key they
// redeemed) — purely cosmetic, no effect on the key's actual validity.
router.post('/license-label', async (req, res) => {
  if (!license.isGateOn() || !store.data.settings.license.key) {
    req.flash('error', 'เว็บนี้ยังไม่ได้ปลดล็อกด้วยคีย์');
    return res.redirect('/admin');
  }
  const label = String(req.body.label || '').trim().slice(0, 60);
  if (!label) {
    req.flash('error', 'กรุณากรอกชื่อ');
    return res.redirect('/admin');
  }
  store.data.settings.license.label = label;
  await store.save();
  req.flash('success', 'แก้ไขชื่อแล้ว');
  res.redirect('/admin');
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
  const toArr = v => Array.isArray(v) ? v : (v === undefined ? [] : [v]);
  const optionIds = toArr(body.priceOptionId);
  const optionMinQtys = toArr(body.priceOptionMinQty);
  const optionPrices = toArr(body.priceOptionPrice);
  const priceOptions = optionMinQtys
    .map((minQty, i) => {
      const qty = Math.max(1, parseInt(minQty, 10) || 0);
      const totalPrice = Math.max(0, parseInt(optionPrices[i], 10) || 0);
      // Admin types "buy N pieces, total price P" — store the per-unit
      // price (P/N) since that's what actually gets applied per unit once
      // a cart quantity crosses this threshold (see cart.js resolveUnitPrice).
      return { id: optionIds[i] || store.genId(8), minQty: qty, price: Math.round(totalPrice / qty) };
    })
    .filter(o => o.minQty > 1 && o.price > 0)
    .sort((a, b) => a.minQty - b.minQty);
  return {
    title: body.title,
    type: 'game',
    genres,
    filterTagIds,
    price: parseInt(body.price, 10) || 0,
    originalPrice: parseInt(body.originalPrice, 10) || 0,
    priceOptions,
    flashSalePrice: body.flashSalePrice === '' ? null : Math.max(0, parseInt(body.flashSalePrice, 10) || 0),
    flashSaleStartAt: (body.flashSaleStartAt || '').trim(),
    flashSaleEndAt: (body.flashSaleEndAt || '').trim(),
    description: body.description || '',
    aboutText: body.aboutText || '',
    publishAt: (body.publishAt || '').trim(),
    eventBadge: (body.eventBadge || '').trim(),
    eventDescription: (body.eventDescription || '').trim(),
    images: images.length ? images : ['https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800'],
    howToReceiveEnabled: body.howToReceiveEnabled === 'on',
    howToReceiveText: (body.howToReceiveText || '').trim(),
    termsBeforeOrderEnabled: body.termsBeforeOrderEnabled === 'on',
    termsBeforeOrderText: (body.termsBeforeOrderText || '').trim(),
    warrantyEnabled: body.warrantyEnabled === 'on',
    warrantyText: (body.warrantyText || '').trim(),
    contactMessageIntro: (body.contactMessageIntro || '').trim(),
    contactMessageOutro: (body.contactMessageOutro || '').trim(),
    purchaseApprovalEnabled: body.purchaseApprovalEnabled === 'on',
    purchaseConfirmationText: (body.purchaseConfirmationText || '').trim(),
    purchaseActionLabel: (body.purchaseActionLabel || '').trim().slice(0, 80),
    purchaseActionUrl: safeExternalUrl(body.purchaseActionUrl),
    apiProvider: body.apiProvider === 'byshop' ? 'byshop' : (body.apiProvider === 'custom' ? 'custom' : 'none'),
    apiProductId: (body.apiProductId || '').trim(),
  };
}

router.get('/products', (req, res) => {
  const products = store.data.products.map(p => {
    const stockCount = store.data.stockItems.filter(s => s.productId === p.id && s.status === 'available').length;
    return { ...p, stockCount };
  });
  res.render('admin/products', { title: 'สินค้า', active: 'products', products, productCardStyle: store.data.settings.productCardStyle || 'natural' });
});

router.post('/products/card-style', async (req, res) => {
  store.data.settings.productCardStyle = req.body.productCardStyle === 'natural' ? 'natural' : 'classic';
  await store.save();
  req.flash('success', 'เปลี่ยนรูปแบบการ์ดสินค้าแล้ว');
  res.redirect('/admin/products');
});

router.get('/products/new', (req, res) => {
  res.render('admin/product-form', { title: 'เพิ่มสินค้าใหม่', active: 'products', product: null, genres: store.data.settings.genres, filterTags: store.data.filterTags });
});

router.post('/products/new', (req, res) => {
  productImageUpload.array('productImages', 10)(req, res, store.bindTenantContext(async (err) => {
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
      await store.save();
      req.flash('success', 'เพิ่มสินค้าแล้ว');
      res.redirect('/admin/products');
    } catch (saveError) {
      req.flash('error', 'บันทึกรูปสินค้าไม่สำเร็จ กรุณาลองใหม่');
      res.redirect('/admin/products/new');
    }
  }));
});

router.get('/products/bulk-import', (req, res) => {
  res.render('admin/product-form', {
    title: 'นำเข้าสินค้าจากโฟลเดอร์', active: 'products', product: null, bulkMode: true,
    genres: store.data.settings.genres, filterTags: store.data.filterTags,
  });
});

router.post('/products/bulk-import', (req, res) => {
  bulkProductImageUpload.array('productImages', 60)(req, res, store.bindTenantContext(async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูปไม่สำเร็จ (สูงสุด 60 รูปต่อครั้ง รูปละไม่เกิน 8MB)');
      return res.redirect('/admin/products/bulk-import');
    }
    if (!req.files || !req.files.length) {
      req.flash('error', 'ไม่พบรูปในโฟลเดอร์ที่เลือก กรุณาเลือกโฟลเดอร์ที่มีไฟล์รูปอยู่ข้างใน');
      return res.redirect('/admin/products/bulk-import');
    }
    try {
      // Shared field values (price, genres, description, fulfillment, etc.)
      // apply to every product created from this batch — only title (from
      // the filename) and the image itself differ per product.
      const sharedFields = parseProductBody(req.body, [], []);
      delete sharedFields.title;
      delete sharedFields.images;

      const uploadedImages = await persistUploadedFiles(req.files);
      const now = new Date().toISOString();
      const created = req.files.map((file, i) => {
        const title = file.originalname.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'สินค้าใหม่';
        return {
          id: store.genId(8), slug: slugify(title) + '-' + store.genId(4),
          ...sharedFields, title, images: [uploadedImages[i]],
          status: 'active', createdAt: now,
        };
      });
      store.data.products.push(...created);
      await store.save();
      req.flash('success', `นำเข้าสินค้าแล้ว ${created.length} รายการ — แก้ไขแต่ละชิ้นแยกได้ตามปกติ`);
      res.redirect('/admin/products');
    } catch (saveError) {
      req.flash('error', 'บันทึกรูปสินค้าไม่สำเร็จ กรุณาลองใหม่');
      res.redirect('/admin/products/bulk-import');
    }
  }));
});

router.get('/products/:id/edit', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  res.render('admin/product-form', { title: 'แก้ไขสินค้า', active: 'products', product, genres: store.data.settings.genres, filterTags: store.data.filterTags });
});

router.post('/products/:id/edit', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  productImageUpload.array('productImages', 10)(req, res, store.bindTenantContext(async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูปสินค้าไม่สำเร็จ (สูงสุด 10 รูป รูปละไม่เกิน 8MB)');
      return res.redirect(`/admin/products/${product.id}/edit`);
    }
    try {
      const uploadedImages = await persistUploadedFiles(req.files);
      const fields = parseProductBody(req.body, uploadedImages, product.images || []);
      Object.assign(product, fields, { status: req.body.status || 'active' });
      await store.save();
      req.flash('success', 'บันทึกการแก้ไขและรูปสินค้าแล้ว');
      res.redirect('/admin/products');
    } catch (saveError) {
      req.flash('error', 'บันทึกรูปสินค้าไม่สำเร็จ กรุณาลองใหม่');
      res.redirect(`/admin/products/${product.id}/edit`);
    }
  }));
});

router.post('/products/:id/delete', async (req, res) => {
  store.data.products = store.data.products.filter(p => p.id !== req.params.id);
  store.data.stockItems = store.data.stockItems.filter(s => s.productId !== req.params.id);
  await store.save();
  req.flash('success', 'ลบสินค้าแล้ว');
  res.redirect('/admin/products');
});

router.post('/products/:id/copy', async (req, res) => {
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
  await store.save();
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
  productImageUpload.single('filterImage')(req, res, store.bindTenantContext(async (err) => {
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
      await store.save();
      req.flash('success', 'เพิ่มตัวกรองและอัปโหลดรูปแล้ว');
    } catch (saveError) {
      req.flash('error', 'บันทึกรูปตัวกรองไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/filter-tags');
  }));
});

router.post('/filter-tags/:id/delete', async (req, res) => {
  store.data.filterTags = store.data.filterTags.filter(t => t.id !== req.params.id);
  store.data.products.forEach(p => {
    if (p.filterTagIds) p.filterTagIds = p.filterTagIds.filter(id => id !== req.params.id);
  });
  await store.save();
  req.flash('success', 'ลบตัวกรองสินค้าแล้ว');
  res.redirect('/admin/filter-tags');
});

// ---------- Home page sections ----------
// Admin-configurable sections shown on the storefront homepage, each
// either auto-filled with the shop's newest products or a manually
// picked/ordered list — replaces the old hardcoded "เกมมาใหม่" block.
router.get('/home-sections', (req, res) => {
  const products = store.data.products.filter(p => p.status === 'active');
  res.render('admin/home-sections', {
    title: 'จัดหมวดหมู่หน้าแรก', active: 'home-sections',
    homeSections: store.data.homeSections, products,
  });
});

router.post('/home-sections', async (req, res) => {
  const title = (req.body.title || '').trim();
  const mode = req.body.mode === 'manual' ? 'manual' : 'newest';
  if (!title) {
    req.flash('error', 'กรุณากรอกชื่อหมวดหมู่');
    return res.redirect('/admin/home-sections');
  }
  const limit = Math.min(30, Math.max(1, parseInt(req.body.limit, 10) || 5));
  const productIds = mode === 'manual' ? [].concat(req.body.productIds || []).filter(Boolean) : [];
  store.data.homeSections.push({ id: store.genId(8), title, mode, limit, productIds });
  await store.save();
  req.flash('success', 'เพิ่มหมวดหมู่แล้ว');
  res.redirect('/admin/home-sections');
});

router.post('/home-sections/:id/edit', async (req, res) => {
  const section = store.data.homeSections.find(s => s.id === req.params.id);
  if (!section) { req.flash('error', 'ไม่พบหมวดหมู่นี้'); return res.redirect('/admin/home-sections'); }
  const title = (req.body.title || '').trim();
  if (!title) {
    req.flash('error', 'กรุณากรอกชื่อหมวดหมู่');
    return res.redirect('/admin/home-sections');
  }
  section.title = title;
  section.mode = req.body.mode === 'manual' ? 'manual' : 'newest';
  section.limit = Math.min(30, Math.max(1, parseInt(req.body.limit, 10) || 5));
  section.productIds = section.mode === 'manual' ? [].concat(req.body.productIds || []).filter(Boolean) : [];
  await store.save();
  req.flash('success', 'บันทึกหมวดหมู่แล้ว');
  res.redirect('/admin/home-sections');
});

router.post('/home-sections/:id/delete', async (req, res) => {
  store.data.homeSections = store.data.homeSections.filter(s => s.id !== req.params.id);
  await store.save();
  req.flash('success', 'ลบหมวดหมู่แล้ว');
  res.redirect('/admin/home-sections');
});

router.post('/home-sections/:id/move', async (req, res) => {
  const list = store.data.homeSections;
  const index = list.findIndex(s => s.id === req.params.id);
  if (index === -1) return res.redirect('/admin/home-sections');
  const direction = req.body.direction === 'down' ? 1 : -1;
  const target = index + direction;
  if (target < 0 || target >= list.length) return res.redirect('/admin/home-sections');
  [list[index], list[target]] = [list[target], list[index]];
  await store.save();
  res.redirect('/admin/home-sections');
});

// ---------- Storefront color theme ----------
router.get('/theme', (req, res) => {
  res.render('admin/theme', {
    title: 'ธีมสี', active: 'theme',
    currentTheme: store.data.settings.theme,
    accentPresets: theme.getAccentPresets(),
    bgPresets: theme.getBgPresets(),
    styles: theme.getStyles(),
  });
});

router.post('/theme', async (req, res) => {
  const accent = /^#[0-9a-fA-F]{6}$/.test(req.body.accent || '') ? req.body.accent : store.data.settings.theme.accent;
  const bgMode = req.body.bgMode === 'custom' ? 'custom' : 'preset';
  let bgPreset = store.data.settings.theme.bgPreset;
  let bgColor = null;
  if (bgMode === 'custom' && /^#[0-9a-fA-F]{6}$/.test(req.body.bgColor || '')) {
    bgColor = req.body.bgColor;
  } else {
    bgPreset = theme.getBgPresets().some(p => p.key === req.body.bgPreset) ? req.body.bgPreset : store.data.settings.theme.bgPreset;
  }
  const style = theme.getStyles().some(s => s.key === req.body.style) ? req.body.style : 'normal';
  store.data.settings.theme = { accent, bgPreset, bgColor, style };
  await store.save();
  req.flash('success', 'บันทึกธีมสีแล้ว');
  res.redirect('/admin/theme');
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

router.post('/products/:id/stock/settings', async (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) { req.flash('error', 'ไม่พบสินค้า'); return res.redirect('/admin/products'); }
  product.fulfillmentMode = req.body.fulfillmentMode === 'contact' ? 'contact' : 'automatic';
  product.fulfillmentInstructions = (req.body.fulfillmentInstructions || '').trim();
  await store.save();
  req.flash('success', 'บันทึกวิธีรับสินค้าแล้ว เพิ่มสต๊อกในขั้นตอนถัดไปได้เลย');
  // Continue directly to the stock-entry section. Previously this returned
  // to the top of the same page, which made a successful first click look as
  // if nothing had happened and led users to press the button twice.
  res.redirect(`/admin/products/${product.id}/stock#add-stock`);
});

router.post('/products/:id/stock/add', async (req, res) => {
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
    await store.save();
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
  await store.save();
  req.flash('success', `เพิ่มสต๊อกสินค้าแล้ว ${added} รายการ`);
  res.redirect(`/admin/products/${product.id}/stock`);
});

router.post('/products/:id/stock/:stockId/delete', async (req, res) => {
  store.data.stockItems = store.data.stockItems.filter(s => s.id !== req.params.stockId);
  await store.save();
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

router.post('/orders/:id/status', async (req, res) => {
  const order = store.data.orders.find(o => o.id === req.params.id);
  if (order) {
    order.status = req.body.status;
    await store.save();
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

router.post('/users/:id/wallet', async (req, res) => {
  const amount = parseInt(req.body.amount, 10);
  const user = store.data.users.find(u => u.id === req.params.id);
  if (!user) {
    req.flash('error', 'ไม่พบสมาชิก');
    return res.redirect('/admin/users');
  }
  if (!Number.isFinite(amount) || amount === 0) {
    req.flash('error', 'กรุณาระบุจำนวนเงินที่ถูกต้อง');
    return res.redirect('/admin/users');
  }
  await store.transact((data) => {
    const freshUser = data.users.find(u => u.id === req.params.id);
    if (!freshUser) throw new Error('ไม่พบสมาชิก');
    freshUser.walletBalance = Math.max(0, (Number(freshUser.walletBalance) || 0) + amount);
    data.walletTransactions.push({
      id: store.genId(10), userId: freshUser.id, type: 'adjust', amount,
      note: `ผู้ดูแลระบบปรับยอด (${req.body.note || 'ไม่มีหมายเหตุ'})`, createdAt: new Date().toISOString(),
    });
  });
  req.flash('success', 'ปรับยอดเงินสำเร็จ');
  res.redirect('/admin/users');
});

router.post('/users/:id/toggle-ban', async (req, res) => {
  const user = store.data.users.find(u => u.id === req.params.id);
  if (user && user.role !== 'admin') {
    user.status = user.status === 'banned' ? 'active' : 'banned';
    await store.save();
    req.flash('success', user.status === 'banned' ? 'ระงับบัญชีแล้ว' : 'ปลดระงับบัญชีแล้ว');
  }
  res.redirect('/admin/users');
});

router.post('/users/new', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '123456');
  const role = req.body.role;

  if (!username) {
    req.flash('error', 'กรุณาระบุชื่อผู้ใช้');
    return res.redirect('/admin/users');
  }

  if (store.data.users.some(u => (u.username || '').toLowerCase() === username.toLowerCase())) {
    req.flash('error', 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
    return res.redirect('/admin/users');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  store.data.users.push({
    id: store.genId(8), username, email, passwordHash,
    role: role === 'admin' ? 'admin' : 'customer', walletBalance: 0, status: 'active', createdAt: new Date().toISOString(),
  });
  await store.save();
  req.flash('success', 'เพิ่มสมาชิกแล้ว');
  res.redirect('/admin/users');
});

// ---------- Top-up requests ----------
router.get('/topups', async (req, res) => {
  const banks = await easyslip.getBanks();
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
  res.render('admin/topups', { title: 'บัญชี', active: 'topups', requests, pendingCount, payment: store.data.settings.payment, banks, q, status });
});

// Slip Verification Hub & Provider Management (/admin/easyslip-usage & /admin/slip-verification)
async function renderSlipVerificationHub(req, res) {
  if (req.tenantShop) { req.flash('error', 'หน้านี้ใช้ได้เฉพาะร้านหลักเท่านั้น'); return res.redirect('/admin'); }
  const payment = store.data.settings.payment || {};

  let easyslipInfo = { ok: false, message: 'ไม่ได้ตั้งค่า' };
  try {
    if (!req.tenantShop) easyslipInfo = await easyslip.getAccountInfo();
  } catch (e) {
    easyslipInfo = { ok: false, message: e.message };
  }

  let byshopInfo = null;
  if (payment.byshopApiKey) {
    try {
      byshopInfo = await byshop.checkBalance(payment.byshopApiKey, payment.byshopEndpoint);
    } catch (e) {
      byshopInfo = { ok: false, message: e.message };
    }
  }

  let slipokInfo = null;
  if (payment.slipokBranchId && payment.slipokApiKey) {
    try {
      slipokInfo = await slipok.testConnection({ branchId: payment.slipokBranchId, apiKey: payment.slipokApiKey });
    } catch (e) {
      slipokInfo = { ok: false, message: e.message };
    }
  }

  let slip2goInfo = null;
  if (payment.slip2goApiKey) {
    try {
      slip2goInfo = await slip2go.checkBalance(payment.slip2goApiKey, payment.slip2goEndpoint);
    } catch (e) {
      slip2goInfo = { ok: false, message: e.message };
    }
  }

  const banks = await easyslip.getBanks().catch(() => []);

  res.render('admin/easyslip-usage', {
    title: 'ระบบตรวจสอบสลิปด้วย API (Slip Provider Hub)',
    active: 'easyslip-usage',
    info: easyslipInfo,
    payment,
    byshopInfo,
    slipokInfo,
    slip2goInfo,
    banks
  });
}

router.get('/easyslip-usage', renderSlipVerificationHub);
router.get('/slip-verification', renderSlipVerificationHub);

router.post(['/slip-verification', '/easyslip-usage'], async (req, res) => {
  const payment = store.data.settings.payment;
  const slipProvider = req.body.slipProvider || payment.slipProvider || 'auto';
  if (!['auto', 'none', 'slipok', 'easyslip'].includes(slipProvider)) {
    req.flash('error', 'ผู้ให้บริการนี้ยังไม่เปิดใช้งานจริง กรุณาเลือก EasySlip, SlipOK หรือการตรวจด้วยแอดมิน');
    return res.redirect('/admin/easyslip-usage');
  }
  const byshopApiKey = (req.body.byshopApiKey !== undefined ? req.body.byshopApiKey : (payment.byshopApiKey || '')).trim();
  const byshopEndpoint = (req.body.byshopEndpoint !== undefined ? req.body.byshopEndpoint : (payment.byshopEndpoint || 'https://api.byshop.me/api')).trim();
  const slipokBranchId = (req.body.slipokBranchId !== undefined ? req.body.slipokBranchId : (payment.slipokBranchId || '')).trim();
  const slipokApiKey = (req.body.slipokApiKey !== undefined ? req.body.slipokApiKey : (payment.slipokApiKey || '')).trim();
  const slip2goApiKey = (req.body.slip2goApiKey !== undefined ? req.body.slip2goApiKey : (payment.slip2goApiKey || '')).trim();
  const slip2goEndpoint = (req.body.slip2goEndpoint !== undefined ? req.body.slip2goEndpoint : (payment.slip2goEndpoint || 'https://api.slip2go.com/api')).trim();
  const customSlipEndpoint = (req.body.customSlipEndpoint !== undefined ? req.body.customSlipEndpoint : (payment.customSlipEndpoint || '')).trim();
  const customSlipApiKey = (req.body.customSlipApiKey !== undefined ? req.body.customSlipApiKey : (payment.customSlipApiKey || '')).trim();

  Object.assign(payment, {
    slipProvider,
    byshopApiKey,
    byshopEndpoint,
    slipokBranchId,
    slipokApiKey,
    slip2goApiKey,
    slip2goEndpoint,
    customSlipEndpoint,
    customSlipApiKey,
    topupWebhookUrl: (req.body.topupWebhookUrl !== undefined ? req.body.topupWebhookUrl : (payment.topupWebhookUrl || '')).trim()
  });

  await store.save();
  req.flash('success', 'บันทึกการตั้งค่าระบบตรวจสอบสลิปด้วย API เรียบร้อยแล้ว');
  res.redirect('/admin/easyslip-usage');
});

router.post(['/slip-verification/test', '/easyslip-usage/test', '/api-providers/byshop/test'], async (req, res) => {
  const provider = (req.body.provider || 'byshop').toLowerCase();
  const apiKey = (req.body.apiKey || '').trim();
  const endpoint = (req.body.endpoint || '').trim();
  const branchId = (req.body.branchId || '').trim();

  try {
    if (provider === 'byshop') {
      if (!apiKey) return res.json({ ok: false, message: 'กรุณากรอก BYSHOP API Key ก่อนทดสอบ' });
      const result = await byshop.checkBalance(apiKey, endpoint || 'https://api.byshop.me/api');
      return res.json(result);
    }

    if (provider === 'slipok') {
      if (!branchId || !apiKey) return res.json({ ok: false, message: 'กรุณากรอก Branch ID และ API Key ก่อนทดสอบ' });
      const result = await slipok.testConnection({ branchId, apiKey });
      return res.json(result);
    }

    if (provider === 'easyslip') {
      if (req.tenantShop) return res.status(403).json({ ok: false, message: 'ข้อมูลบัญชีกลางดูได้เฉพาะผู้ดูแลเว็บหลัก' });
      const result = await easyslip.getAccountInfo();
      return res.json(result);
    }

    if (provider === 'slip2go') {
      if (!apiKey) return res.json({ ok: false, message: 'กรุณากรอก Slip2Go API Key ก่อนทดสอบ' });
      const result = await slip2go.checkBalance(apiKey, endpoint || 'https://api.slip2go.com/api');
      return res.json(result);
    }

    if (provider === 'custom') {
      if (!endpoint) return res.json({ ok: false, message: 'กรุณาระบุ Webhook/Endpoint URL ก่อนทดสอบ' });
      return res.json({ ok: false, message: 'Custom Slip Webhook ยังไม่เปิดใช้งานจริง' });
    }

    res.json({ ok: false, message: 'ไม่พบผู้ให้บริการที่ระบุ' });
  } catch (err) {
    res.json({ ok: false, message: err.message || 'เกิดข้อผิดพลาดในการทดสอบเชื่อมต่อ' });
  }
});

router.post('/topups/payment-settings', (req, res) => {
  qrImageUpload.fields([
    { name: 'promptpayQrImage', maxCount: 1 },
    { name: 'bankQrImage', maxCount: 1 },
  ])(req, res, store.bindTenantContext(async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูป QR ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/topups');
    }
    const {
      promptpayId, promptpayName, bankAccountNumber, bankAccountName,
    } = req.body;
    const bankCode = (req.body.easyslipBankCode || '').trim();
    const registerPromptpay = req.body.registerPromptpay === 'on';
    const promptpayEasyslipNumber = (req.body.promptpayEasyslipNumber || promptpayId || '').trim();

    const payment = store.data.settings.payment;
    const banks = await easyslip.getBanks();
    const primaryBank = banks.find(b => b.code === bankCode);
    const truemoneyPhone = (req.body.truemoneyPhone || '').trim().replace(/[^0-9]/g, '');
    const truemoneyEnabled = req.body.truemoneyEnabled === 'on';
    const slipProvider = req.body.slipProvider || payment.slipProvider || 'auto';
    if (!['auto', 'none', 'slipok', 'easyslip'].includes(slipProvider)) {
      req.flash('error', 'ผู้ให้บริการตรวจสลิปนี้ยังไม่พร้อมใช้งาน');
      return res.redirect('/admin/topups');
    }
    const byshopApiKey = (req.body.byshopApiKey !== undefined ? req.body.byshopApiKey : (payment.byshopApiKey || '')).trim();
    const byshopEndpoint = (req.body.byshopEndpoint !== undefined ? req.body.byshopEndpoint : (payment.byshopEndpoint || 'https://api.byshop.me/api')).trim();
    const slipokBranchId = (req.body.slipokBranchId !== undefined ? req.body.slipokBranchId : (payment.slipokBranchId || '')).trim();
    const slipokApiKey = (req.body.slipokApiKey !== undefined ? req.body.slipokApiKey : (payment.slipokApiKey || '')).trim();
    const slip2goApiKey = (req.body.slip2goApiKey !== undefined ? req.body.slip2goApiKey : (payment.slip2goApiKey || '')).trim();
    const slip2goEndpoint = (req.body.slip2goEndpoint !== undefined ? req.body.slip2goEndpoint : (payment.slip2goEndpoint || 'https://api.slip2go.com/api')).trim();
    const customSlipEndpoint = (req.body.customSlipEndpoint !== undefined ? req.body.customSlipEndpoint : (payment.customSlipEndpoint || '')).trim();
    const customSlipApiKey = (req.body.customSlipApiKey !== undefined ? req.body.customSlipApiKey : (payment.customSlipApiKey || '')).trim();

    Object.assign(payment, {
      promptpayId, promptpayName, bankAccountNumber, bankAccountName,
      bankName: primaryBank ? primaryBank.nameTh : payment.bankName,
      truemoneyPhone, truemoneyEnabled,
      slipProvider, byshopApiKey, byshopEndpoint, slipokBranchId, slipokApiKey,
      slip2goApiKey, slip2goEndpoint, customSlipEndpoint, customSlipApiKey,
      topupWebhookUrl: (req.body.topupWebhookUrl || '').trim(),
    });

    // Registered as its own bank (matches a normal transfer) AND, if
    // opted in, again under the PromptPay channel — an interbank
    // PromptPay transfer's slip can report the receiver's bank as the
    // generic "PromptPay" entry rather than the shop's real bank, and
    // PromptPay's own identifier (phone/ID) isn't the bank account
    // number, so it needs its own separate registration.
    const channels = [];
    if (bankCode && bankAccountNumber && bankAccountName) channels.push({ code: bankCode, number: bankAccountNumber, name: bankAccountName });
    if (registerPromptpay && promptpayBank && promptpayEasyslipNumber) {
      // A mobile-number PromptPay account needs extraVerify explicitly set to
      // MSISDN (EasySlip's own field name for phone numbers, per their QR
      // generation API's PromptPayRequest.msisdn) or the account is created
      // with no verification method at all, which silently breaks slip
      // matching for every PromptPay transfer registered this way.
      channels.push({ code: promptpayBank.code, number: promptpayEasyslipNumber, name: promptpayName || bankAccountName, extraVerify: 'MSISDN' });
    }

    if (easyslip.isConfigured() && channels.length) {
      const statuses = [];
      for (const channel of channels) {
        const already = payment.easyslipAccounts[channel.code];
        const targetExtraVerify = channel.extraVerify || null;
        if (already && already.accountId && already.bankNumber === channel.number && already.extraVerify === targetExtraVerify) continue;
        const bankLabel = (banks.find(b => b.code === channel.code) || {}).nameTh || channel.code;

        // Same account, already has an EasySlip id — just fix the
        // verification method in place rather than trying to create it
        // again (a duplicate bankNumber is rejected outright, not merged).
        if (already && already.accountId && already.bankNumber === channel.number) {
          const updateResult = await easyslip.updateBankAccount(already.accountId, { extraVerify: targetExtraVerify });
          if (updateResult.ok) {
            payment.easyslipAccounts[channel.code] = { accountId: already.accountId, status: 'ok', bankNumber: channel.number, extraVerify: targetExtraVerify };
            statuses.push(`${bankLabel}: แก้ไขวิธีตรวจสอบสำเร็จ`);
          } else {
            statuses.push(`${bankLabel}: แก้ไขวิธีตรวจสอบไม่สำเร็จ (${updateResult.message})`);
          }
          continue;
        }

        const result = await easyslip.createBankAccount({
          bankCode: channel.code, bankNumber: channel.number, nameTh: channel.name,
          nameEn: channel.name, type: 'NATURAL', extraVerify: channel.extraVerify,
        });
        if (result.ok) {
          payment.easyslipAccounts[channel.code] = { accountId: result.account.id, status: 'ok', bankNumber: channel.number, extraVerify: targetExtraVerify };
          statuses.push(`${bankLabel}: เชื่อมต่อสำเร็จ`);
        } else if (result.code === 'BANK_ACCOUNT_DUPLICATE') {
          // Registered before (not by us, or accountId wasn't saved) — we
          // have no id to patch it with, so this still needs a manual fix
          // in the EasySlip dashboard (ดู/แก้ไขบัญชี → เลือกประเภทพร้อมเพย์).
          payment.easyslipAccounts[channel.code] = { accountId: (already && already.accountId) || null, status: 'ok', bankNumber: channel.number, extraVerify: (already && already.extraVerify) || null };
          statuses.push(`${bankLabel}: เชื่อมต่อไว้แล้วแต่แก้วิธีตรวจสอบให้อัตโนมัติไม่ได้ (ไม่มี id บันทึกไว้) — ต้องแก้เองที่แดชบอร์ด EasySlip`);
        } else {
          statuses.push(`${bankLabel}: ไม่สำเร็จ (${result.message})`);
        }
      }
      const activeCodes = channels.map(c => c.code);
      Object.keys(payment.easyslipAccounts).forEach((code) => {
        if (!activeCodes.includes(code)) delete payment.easyslipAccounts[code];
      });
      if (statuses.length) payment.easyslipStatus = statuses.join(' · ');
    } else {
      payment.easyslipAccounts = {};
    }

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

    await store.save();
    req.flash('success', 'บันทึกข้อมูลบัญชีรับเงินแล้ว');
    res.redirect('/admin/topups');
  }));
});

router.post('/topups/:id/approve', async (req, res) => {
  const request = store.data.topupRequests.find(t => t.id === req.params.id);
  if (!request) { req.flash('error', 'ไม่พบคำขอ'); return res.redirect('/admin/topups'); }
  if (request.status === 'approved' || request.status === 'rejected') { req.flash('error', 'คำขอนี้ถูกตรวจสอบไปแล้ว'); return res.redirect('/admin/topups'); }
  const user = store.data.users.find(u => u.id === request.userId);
  if (!user) { req.flash('error', 'ไม่พบผู้ใช้'); return res.redirect('/admin/topups'); }

  const approved = await store.transact((data) => {
    const freshRequest = data.topupRequests.find(t => t.id === req.params.id);
    if (!freshRequest || freshRequest.status === 'approved' || freshRequest.status === 'rejected') return false;
    const freshUser = data.users.find(u => u.id === freshRequest.userId);
    if (!freshUser) return false;
    freshUser.walletBalance = Math.round(((Number(freshUser.walletBalance) || 0) + Number(freshRequest.amount)) * 100) / 100;
    data.walletTransactions.push({
      id: store.genId(10), userId: freshUser.id, type: 'topup', amount: freshRequest.amount,
      note: `เติมเงินสำเร็จ (อ้างอิง ${freshRequest.refCode})`, createdAt: new Date().toISOString(),
    });
    freshRequest.status = 'approved';
    freshRequest.reviewedAt = new Date().toISOString();
    return true;
  });
  if (!approved) { req.flash('error', 'คำขอนี้ถูกตรวจสอบไปแล้ว'); return res.redirect('/admin/topups'); }
  req.flash('success', `อนุมัติคำขอเติมเงิน ${request.amount.toLocaleString()} บาท ให้ ${user.username} แล้ว`);
  res.redirect('/admin/topups');
});

router.post('/topups/:id/reject', async (req, res) => {
  const request = store.data.topupRequests.find(t => t.id === req.params.id);
  if (!request) { req.flash('error', 'ไม่พบคำขอ'); return res.redirect('/admin/topups'); }
  if (request.status === 'approved' || request.status === 'rejected') { req.flash('error', 'คำขอนี้ถูกตรวจสอบไปแล้ว'); return res.redirect('/admin/topups'); }
  const rejected = await store.transact((data) => {
    const freshRequest = data.topupRequests.find(t => t.id === req.params.id);
    if (!freshRequest || freshRequest.status === 'approved' || freshRequest.status === 'rejected') return false;
    freshRequest.status = 'rejected';
    freshRequest.reviewedAt = new Date().toISOString();
    freshRequest.reviewNote = req.body.reviewNote || '';
    return true;
  });
  if (!rejected) { req.flash('error', 'คำขอนี้ถูกตรวจสอบไปแล้ว'); return res.redirect('/admin/topups'); }
  req.flash('success', 'ปฏิเสธคำขอเติมเงินแล้ว');
  res.redirect('/admin/topups');
});

// ---------- Coupons ----------
router.get('/coupons', (req, res) => {
  res.render('admin/coupons', { title: 'คูปองส่วนลด', active: 'coupons', coupons: store.data.coupons });
});

router.post('/coupons', async (req, res) => {
  const { code, type, value, usageLimit } = req.body;
  store.data.coupons.push({
    id: store.genId(8), code: code.toUpperCase(), type: type === 'fixed' ? 'fixed' : 'percent',
    value: parseInt(value, 10) || 0, active: true, usageLimit: parseInt(usageLimit, 10) || 0,
    usedCount: 0, expiresAt: null, createdAt: new Date().toISOString(),
  });
  await store.save();
  req.flash('success', 'เพิ่มคูปองแล้ว');
  res.redirect('/admin/coupons');
});

router.post('/coupons/:id/toggle', async (req, res) => {
  const coupon = store.data.coupons.find(c => c.id === req.params.id);
  if (coupon) { coupon.active = !coupon.active; await store.save(); }
  res.redirect('/admin/coupons');
});

router.post('/coupons/:id/delete', async (req, res) => {
  store.data.coupons = store.data.coupons.filter(c => c.id !== req.params.id);
  await store.save();
  req.flash('success', 'ลบคูปองแล้ว');
  res.redirect('/admin/coupons');
});

// ---------- Mini game ----------
router.get('/minigame', (req, res) => {
  const totalPercent = type => store.data.miniGamePrizes
    .filter(p => p.active && (p.gameType || 'box') === type)
    .reduce((sum, p) => sum + Number(p.percent), 0);
  const searchQuery = (req.query.q || '').trim();
  let plays = store.data.miniGamePlays;
  if (searchQuery) {
    const needle = searchQuery.toLowerCase();
    plays = plays.filter(p =>
      (p.username || '').toLowerCase().includes(needle) ||
      (p.claimCode || '').toLowerCase().includes(needle)
    );
  }
  res.render('admin/minigame', {
    title: 'มินิเกม', active: 'minigame',
    game: store.data.settings.miniGame,
    prizes: store.data.miniGamePrizes,
    totalPercent: totalPercent('box'),
    railTotalPercent: totalPercent('rail'),
    recentPlays: plays.slice(0, searchQuery ? 100 : 30),
    searchQuery,
  });
});

router.post('/minigame/settings', async (req, res) => {
  const { title, description, costPerPlay, railTitle, railDescription, railCostPerPlay } = req.body;
  Object.assign(store.data.settings.miniGame, {
    title: title || store.data.settings.miniGame.title,
    description: description || '',
    costPerPlay: Math.max(0, parseInt(costPerPlay, 10) || 0),
    railTitle: railTitle || store.data.settings.miniGame.railTitle,
    railDescription: railDescription || '',
    railCostPerPlay: Math.max(0, parseInt(railCostPerPlay, 10) || 0),
  });
  await store.save();
  req.flash('success', 'บันทึกการตั้งค่ามินิเกมแล้ว');
  res.redirect('/admin/minigame');
});

router.post('/minigame/toggle', async (req, res) => {
  const field = req.body.gameType === 'rail' ? 'railEnabled' : 'boxEnabled';
  store.data.settings.miniGame[field] = !store.data.settings.miniGame[field];
  store.data.settings.miniGame.enabled = Boolean(store.data.settings.miniGame.boxEnabled || store.data.settings.miniGame.railEnabled);
  await store.save();
  const label = field === 'railEnabled' ? 'เกมรางเลื่อน' : 'เกมเปิดกล่อง';
  req.flash('success', `${store.data.settings.miniGame[field] ? 'เปิด' : 'ปิด'}ใช้งาน${label}แล้ว`);
  res.redirect('/admin/minigame');
});

router.post('/minigame/prizes', (req, res) => {
  prizeImageUpload.single('image')(req, res, store.bindTenantContext(async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูปไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/minigame');
    }
    const { name, percent, stock } = req.body;
    const gameType = req.body.gameType === 'rail' ? 'rail' : 'box';
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
      id: store.genId(8), gameType, name: name.trim(),
      percent: Math.max(0, Math.min(100, Number(percent) || 0)),
      stock: stock === '' || stock === undefined ? null : Math.max(0, parseInt(stock, 10) || 0),
      isPrize: req.body.isPrize === 'on',
      image, active: true, createdAt: new Date().toISOString(),
    });
    await store.save();
    req.flash('success', 'เพิ่มของรางวัลแล้ว');
    res.redirect('/admin/minigame');
  }));
});

router.post('/minigame/prizes/:id/image', (req, res) => {
  prizeImageUpload.single('image')(req, res, store.bindTenantContext(async (err) => {
    const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
    if (err || !req.file || !prize) {
      req.flash('error', 'อัปโหลดรูปไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/minigame');
    }
    try {
      prize.image = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      await store.save();
      req.flash('success', `เปลี่ยนรูป "${prize.name}" แล้ว`);
    } catch (saveError) {
      req.flash('error', 'บันทึกรูปไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/minigame');
  }));
});

router.post('/minigame/prizes/:id/image/remove', async (req, res) => {
  const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
  if (prize) { prize.image = null; await store.save(); }
  res.redirect('/admin/minigame');
});

router.post('/minigame/preview', (req, res) => {
  const gameType = req.query.mode === 'rail' ? 'rail' : 'box';
  const prize = pickPrize(store.data.miniGamePrizes.filter(p => (p.gameType || 'box') === gameType));
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

router.post('/minigame/prizes/:id', async (req, res) => {
  const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
  if (!prize) { req.flash('error', 'ไม่พบของรางวัลนี้'); return res.redirect('/admin/minigame'); }
  const { name, percent, stock } = req.body;
  Object.assign(prize, {
    name: name && name.trim() ? name.trim() : prize.name,
    percent: Math.max(0, Math.min(100, Number(percent) || 0)),
    stock: stock === '' || stock === undefined ? null : Math.max(0, parseInt(stock, 10) || 0),
    isPrize: req.body.isPrize === 'on',
  });
  await store.save();
  req.flash('success', 'บันทึกของรางวัลแล้ว');
  res.redirect('/admin/minigame');
});

router.post('/minigame/prizes/:id/restock', async (req, res) => {
  const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
  const addAmount = Math.max(0, parseInt(req.body.addStock, 10) || 0);
  if (prize && prize.stock !== null) {
    prize.stock += addAmount;
    await store.save();
    req.flash('success', `เติมสต็อก "${prize.name}" อีก ${addAmount} ชิ้นแล้ว`);
  }
  res.redirect('/admin/minigame');
});

router.post('/minigame/prizes/:id/toggle', async (req, res) => {
  const prize = store.data.miniGamePrizes.find(p => p.id === req.params.id);
  if (prize) { prize.active = !prize.active; await store.save(); }
  res.redirect('/admin/minigame');
});

router.post('/minigame/prizes/:id/delete', async (req, res) => {
  store.data.miniGamePrizes = store.data.miniGamePrizes.filter(p => p.id !== req.params.id);
  await store.save();
  req.flash('success', 'ลบของรางวัลแล้ว');
  res.redirect('/admin/minigame');
});

router.post('/minigame/plays/:id/deliver', async (req, res) => {
  const play = store.data.miniGamePlays.find(pl => pl.id === req.params.id);
  if (play && play.isWin) {
    play.status = play.status === 'delivered' ? 'pending' : 'delivered';
    await store.save();
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
  // Shops created via /start (the direct-purchase flow, tracked separately
  // from the licenseSales/key system above) — each one's own expiresAt is
  // the real source of truth for when that customer's rented site expires.
  const rentedShops = [...store.data.shops].sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0));
  res.render('admin/license-plans', {
    title: 'ขายคีย์เช่าเว็บ', active: 'license-plans',
    plans: store.data.licensePlans,
    sales,
    rentedShops,
    mainDomain: MAIN_DOMAIN,
    licenseEnabled: license.isEnabled(),
    discordSettings: store.data.settings.discord,
    discordConfigured: discordBot.isConfigured(),
    discordReady: discordBot.isReady(),
  });
});

// ---------- Discord bot (rent-website notifications + ticket system) ----------
// Bot token itself is DISCORD_BOT_TOKEN (env var, Railway) — only
// non-secret channel/role IDs are editable from here.
router.post('/discord/settings', async (req, res) => {
  store.data.settings.discord = {
    enabled: req.body.enabled === 'on',
    notifyChannelId: (req.body.notifyChannelId || '').trim(),
    ticketPanelChannelId: (req.body.ticketPanelChannelId || '').trim(),
    ticketCategoryId: (req.body.ticketCategoryId || '').trim(),
    ticketLogChannelId: (req.body.ticketLogChannelId || '').trim(),
    supportRoleId: (req.body.supportRoleId || '').trim(),
  };
  await store.save();
  req.flash('success', 'บันทึกการตั้งค่า Discord แล้ว');
  res.redirect('/admin/license-plans');
});

router.post('/discord/post-ticket-panel', async (req, res) => {
  try {
    await discordBot.postTicketPanel();
    req.flash('success', 'โพสต์ปุ่มเปิดตั๋วแล้ว');
  } catch (err) {
    req.flash('error', err.message || 'โพสต์ไม่สำเร็จ');
  }
  res.redirect('/admin/license-plans');
});

// Permanently deletes a rented shop: its entire tenant dataset (products,
// orders, users, wallet, settings) plus its entry in this list. Irreversible
// — the view requires typing the shop's name to confirm before submitting.
// Uploaded media files (product images etc.) are not swept up here, since
// they live in a shared media store with no reliable per-tenant index.
router.post('/rented-shops/:id/delete', async (req, res) => {
  const shop = store.data.shops.find(s => s.id === req.params.id);
  if (!shop) {
    req.flash('error', 'ไม่พบร้านนี้');
    return res.redirect('/admin/license-plans');
  }
  await store.deleteTenantDb(shop.id);
  store.data.shops = store.data.shops.filter(s => s.id !== shop.id);
  await store.save();
  req.flash('success', `ลบร้าน "${shop.name}" แล้ว`);
  res.redirect('/admin/license-plans');
});

function parsePromoFields(body) {
  const promo = body.promo === 'on';
  const promoLimit = promo && body.promoLimit ? Math.max(1, parseInt(body.promoLimit, 10) || 0) || null : null;
  const promoExpiresAt = promo && body.promoExpiresAt ? new Date(body.promoExpiresAt).getTime() || null : null;
  return { promo, promoLimit, promoExpiresAt };
}

router.post('/license-plans', async (req, res) => {
  const days = Math.max(1, parseInt(req.body.days, 10) || 0);
  const price = Math.max(0, Number(req.body.price) || 0);
  if (!days || !price) {
    req.flash('error', 'กรุณากรอกจำนวนวันและราคาให้ถูกต้อง');
    return res.redirect('/admin/license-plans');
  }
  store.data.licensePlans.push({
    id: store.genId(8), days, price, active: true, createdAt: new Date().toISOString(),
    promoUsedCount: 0, ...parsePromoFields(req.body),
  });
  await store.save();
  req.flash('success', 'เพิ่มแพ็กเกจแล้ว');
  res.redirect('/admin/license-plans');
});

router.post('/license-plans/:id/edit', async (req, res) => {
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
  Object.assign(plan, parsePromoFields(req.body));
  await store.save();
  req.flash('success', 'แก้ไขแพ็กเกจแล้ว');
  res.redirect('/admin/license-plans');
});

router.post('/license-plans/:id/toggle', async (req, res) => {
  const plan = store.data.licensePlans.find(p => p.id === req.params.id);
  if (plan) { plan.active = !plan.active; await store.save(); }
  res.redirect('/admin/license-plans');
});

router.post('/license-plans/:id/delete', async (req, res) => {
  store.data.licensePlans = store.data.licensePlans.filter(p => p.id !== req.params.id);
  await store.save();
  req.flash('success', 'ลบแพ็กเกจแล้ว');
  res.redirect('/admin/license-plans');
});

// ---------- Announcements ----------
router.get('/announcements', (req, res) => {
  res.render('admin/announcements', { title: 'ประกาศ', active: 'announcements', announcements: store.data.announcements });
});

router.post('/announcements', (req, res) => {
  bannerUpload.single('image')(req, res, store.bindTenantContext(async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูปไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 10MB)');
      return res.redirect('/admin/announcements');
    }
    try {
      const image = req.file ? await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype) : null;
      store.data.announcements.push({
        id: store.genId(8), title: req.body.title, body: req.body.body,
        image, link: (req.body.link || '').trim(), popup: req.body.popup === 'on',
        active: true, createdAt: new Date().toISOString(),
      });
      await store.save();
      req.flash('success', 'เพิ่มประกาศแล้ว');
    } catch (saveError) {
      req.flash('error', 'บันทึกประกาศไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/announcements');
  }));
});

router.post('/announcements/:id/toggle', async (req, res) => {
  const a = store.data.announcements.find(x => x.id === req.params.id);
  if (a) { a.active = !a.active; await store.save(); }
  res.redirect('/admin/announcements');
});

router.post('/announcements/:id/delete', async (req, res) => {
  store.data.announcements = store.data.announcements.filter(x => x.id !== req.params.id);
  await store.save();
  req.flash('success', 'ลบประกาศแล้ว');
  res.redirect('/admin/announcements');
});

// ---------- Settings ----------
router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'ตั้งค่าร้าน', active: 'settings', licenseEnabled: license.isGateOn() });
});

router.get('/appearance', (req, res) => {
  res.render('admin/appearance', {
    title: 'รูปหน้าเว็บและโลโก้', active: 'appearance',
    currentTheme: store.data.settings.theme,
    accentPresets: theme.getAccentPresets(),
    bgPresets: theme.getBgPresets(),
    styles: theme.getStyles(),
    announcements: store.data.announcements,
  });
});

// A link saved without "http(s)://" (e.g. just "m.me/page" or a bare page
// name) resolves as a path on this site itself when used as a raw <a href>,
// leading to a 404 instead of opening Messenger/Facebook. Normalize it here
// so it always resolves as an absolute external URL.
function normalizeExternalLink(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

router.post('/settings', async (req, res) => {
  const { shopName, tagline, contactLine, contactFacebook, contactMessenger, contactFacebookName, contactResponseTime, openHours } = req.body;
  Object.assign(store.data.settings, {
    shopName, tagline, contactLine,
    contactFacebook: normalizeExternalLink(contactFacebook),
    contactMessenger: normalizeExternalLink(contactMessenger),
    contactFacebookName, contactResponseTime, openHours,
  });
  await store.save();
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

router.post('/music-player', async (req, res) => {
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
  await store.save();
  req.flash('success', 'บันทึกการตั้งค่าเพลงหน้าเว็บแล้ว');
  res.redirect('/admin/settings');
});

// ---------- Snow effect ----------
router.post('/snow-toggle', async (req, res) => {
  store.data.settings.snow = { enabled: req.body.enabled === 'on' };
  await store.save();
  req.flash('success', store.data.settings.snow.enabled ? 'เปิดใช้งานหิมะตกแล้ว' : 'ปิดใช้งานหิมะตกแล้ว');
  res.redirect('/admin/settings');
});

// ---------- Hero banner ----------
router.post('/site-logo/upload', (req, res) => {
  logoUpload.single('logoImage')(req, res, store.bindTenantContext(async (err) => {
    if (err || !req.file) {
      req.flash('error', 'อัปโหลดโลโก้ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/appearance');
    }
    try {
      store.data.settings.branding.logoImage = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      await store.save();
      req.flash('success', 'อัปโหลดโลโก้เว็บไซต์แล้ว และจะไม่หายเมื่อ Deploy');
    } catch (saveError) {
      req.flash('error', 'บันทึกโลโก้ไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/appearance');
  }));
});

router.post('/hero-banner/upload', (req, res) => {
  bannerUpload.single('bannerImage')(req, res, store.bindTenantContext(async (err) => {
    if (err || !req.file) {
      req.flash('error', 'อัปโหลดแบนเนอร์ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 10MB)');
      return res.redirect('/admin/appearance');
    }
    try {
      store.data.settings.hero.bannerImage = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      await store.save();
      req.flash('success', 'อัปโหลดแบนเนอร์แล้ว และจะไม่หายเมื่อ Deploy');
    } catch (saveError) {
      req.flash('error', 'บันทึกแบนเนอร์ไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/appearance');
  }));
});

router.post('/hero-banner/mode', async (req, res) => {
  const mode = req.body.mode === 'banner' ? 'banner' : 'default';
  if (mode === 'banner' && !store.data.settings.hero.bannerImage) {
    req.flash('error', 'กรุณาอัปโหลดรูปแบนเนอร์ก่อนเปิดใช้งานโหมดแบนเนอร์');
    return res.redirect('/admin/appearance');
  }
  store.data.settings.hero.mode = mode;
  store.data.settings.hero.bannerLink = req.body.bannerLink || '';
  await store.save();
  req.flash('success', mode === 'banner' ? 'เปิดใช้งานแบนเนอร์หน้าหลักแล้ว' : 'กลับไปใช้หน้าหลักแบบเดิมแล้ว');
  res.redirect('/admin/appearance');
});

// ---------- API Providers (Redirected to Unified Slip Verification Hub) ----------
router.get('/api-providers', (req, res) => res.redirect('/admin/easyslip-usage'));
router.post('/api-providers/byshop', (req, res) => res.redirect('/admin/easyslip-usage'));
router.post('/api-providers/custom', (req, res) => res.redirect('/admin/easyslip-usage'));

module.exports = router;
