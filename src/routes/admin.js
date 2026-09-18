const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const store = require('../data/store');
const { pickPrize } = require('../services/minigame');
const license = require('../services/license');
const banks = require('../data/thai-banks');
const slipok = require('../services/slipok');
const slip2go = require('../services/slip2go');
const slipcheck = require('../services/slipcheck');
const rdcwSlip = require('../services/rdcw-slip');
const xephtSlip = require('../services/xepht-slip');
const { effectiveSlipConfig } = require('../services/slip-config');
const receiverProfiles = require('../services/receiver-profiles');
const theme = require('../services/theme');
const topupsService = require('../services/topups');
const { getCloudUrl } = require('../services/cloud-url');
const { requireAdmin } = require('../middleware/auth');
const r2 = require('../services/r2');
const efootballSource = require('../services/efootball-catalog');

const toArr = value => Array.isArray(value) ? value : (value === undefined ? [] : [value]);

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

const filterImageUpload = multer({
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

const popupImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 20 },
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

function directUploadUrls(body, field) {
  try {
    const values = JSON.parse(body[`${field}R2Urls`] || '[]');
    return Array.isArray(values) ? values.map(safeExternalUrl).filter(Boolean) : [];
  } catch (_) { return []; }
}
const firstDirectUpload = (body, field) => directUploadUrls(body || {}, field)[0] || '';

router.post('/media/direct-upload', express.json(), async (req, res) => {
  try {
    const result = await r2.createDirectUpload(req.body.filename, req.body.contentType);
    res.json({ ok: true, ...result });
  } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
});

// Firing all uploads (up to 60, 8MB each) at R2 simultaneously saturates the
// VPS's outbound bandwidth and can make a bulk import take far longer than
// running a handful at a time — a handful of overlapping requests keeps the
// connection saturated without the pileup that made large batches feel stuck.
const BULK_UPLOAD_CONCURRENCY = 6;

// Each result is { ok: true, url } or { ok: false, error } — one bad file
// (corrupt image, mismatched extension, a transient R2 hiccup) no longer
// aborts every other file in the same request; the caller decides what to
// do with the ones that failed.
async function persistUploadedFiles(files, onProgress) {
  const results = new Array(files.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      try {
        const url = await store.saveMedia(files[i].buffer, files[i].originalname, files[i].mimetype);
        results[i] = { ok: true, url };
      } catch (fileError) {
        results[i] = { ok: false, error: fileError.message || String(fileError) };
      }
      done += 1;
      if (onProgress) onProgress(done, files.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(BULK_UPLOAD_CONCURRENCY, files.length) }, worker));
  return results;
}

// For the single-product create/edit forms, which still want the original
// all-or-nothing behavior (a handful of images, one request, no reason to
// half-save a product) — turns persistUploadedFiles' per-file results back
// into a plain URL array, or throws with every failure reason listed.
function unwrapUploadResults(results) {
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    throw new Error(failed.map(f => f.error).join('; '));
  }
  return results.map(r => r.url);
}

// Polled by the bulk-import page while its one big form submission is still
// in flight (a normal page load can't otherwise show progress mid-request).
// Keyed by a client-generated jobId; entries are small and self-expiring, so
// a plain in-memory object is fine — nothing here needs to survive a restart.
const bulkImportJobs = new Map();
function setBulkImportProgress(jobId, done, total) {
  if (!jobId) return;
  bulkImportJobs.set(jobId, { done, total, updatedAt: Date.now() });
}
setInterval(() => {
  const staleBefore = Date.now() - (10 * 60 * 1000);
  for (const [jobId, job] of bulkImportJobs) {
    if (job.updatedAt < staleBefore) bulkImportJobs.delete(jobId);
  }
}, 5 * 60 * 1000).unref();

router.get('/products/bulk-import/progress/:jobId', (req, res) => {
  const job = bulkImportJobs.get(req.params.jobId);
  res.json(job ? { ok: true, done: job.done, total: job.total } : { ok: false });
});

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
  const since7Days = now.getTime() - (7 * 86400000);
  const since30Days = now.getTime() - (30 * 86400000);
  let revenueToday = 0;
  let revenue7Days = 0;
  let revenue30Days = 0;
  const revenueByDay = new Map();
  paidOrders.forEach(order => {
    const createdAt = new Date(order.createdAt);
    const createdMs = createdAt.getTime();
    const amount = Number(order.total) || 0;
    const dayKey = bangkokKey(createdAt);
    revenueByDay.set(dayKey, (revenueByDay.get(dayKey) || 0) + amount);
    if (dayKey === todayKey) revenueToday += amount;
    if (createdMs >= since7Days) revenue7Days += amount;
    if (createdMs >= since30Days) revenue30Days += amount;
  });
  const newCustomersToday = users.filter(user => user.role === 'customer' && bangkokKey(new Date(user.createdAt)) === todayKey).length;
  const newCustomers30Days = users.filter(user => user.role === 'customer' && new Date(user.createdAt).getTime() >= since30Days).length;
  const dailySales = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getTime() - ((6 - index) * 86400000));
    const key = bangkokKey(date);
    const amount = revenueByDay.get(key) || 0;
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
  const availableStockByProduct = new Map();
  stockItems.forEach(item => {
    if (item.status === 'available') availableStockByProduct.set(item.productId, (availableStockByProduct.get(item.productId) || 0) + 1);
  });
  const availableStock = [...availableStockByProduct.values()].reduce((sum, count) => sum + count, 0);
  const lowStockProducts = store.data.products.filter(p => {
    const count = availableStockByProduct.get(p.id) || 0;
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
      newCustomersToday, newCustomers30Days,
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
    shopRenewUrl: `${getCloudUrl()}/my-shops`,
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
    apiProvider: body.apiProvider === 'custom' ? 'custom' : 'none',
    apiProductId: (body.apiProductId || '').trim(),
    // Admin-only — never rendered on any customer-facing page. Useful for
    // things like the original filename behind a renamed product code.
    internalNote: (body.internalNote || '').trim(),
  };
}

router.get('/products', (req, res) => {
  const filterTagById = new Map(store.data.filterTags.map(tag => [tag.id, tag]));
  const products = store.data.products.map(p => {
    const stockCount = store.data.stockItems.filter(s => s.productId === p.id && s.status === 'available').length;
    const selectedFilterTags = (p.filterTagIds || []).map(id => filterTagById.get(id)).filter(Boolean);
    return { ...p, stockCount, selectedFilterTags };
  });
  // Inventory value is based on IDs that are still available. Sold/issued
  // IDs remain in history but must not inflate the amount shown to the admin.
  const totalAvailableProductCount = products.reduce((sum, product) => sum + product.stockCount, 0);
  const totalProductPrice = products.reduce((sum, product) => sum + ((Number(product.price) || 0) * product.stockCount), 0);
  res.render('admin/products', { title: 'สินค้า', active: 'products', products, totalProductPrice, totalAvailableProductCount, productCardStyle: store.data.settings.productCardStyle || 'natural' });
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
      const uploadedImages = [...directUploadUrls(req.body, 'productImages'), ...unwrapUploadResults(await persistUploadedFiles(req.files || []))];
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
    // The bulk-import page normally splits a large folder into several small
    // requests (see the inline script in product-form.ejs) so no single
    // request risks tripping nginx's client_max_body_size — each of those
    // calls sends ajax=1 and expects JSON back instead of a page redirect.
    const isAjax = req.body && req.body.ajax === '1';
    // multer/busboy decode multipart filename headers as Latin-1 per the
    // HTTP spec, but browsers send them as UTF-8 bytes — any non-ASCII
    // filename (Thai text, emoji, accents) comes through garbled unless
    // it's round-tripped back through the encoding it was actually sent in.
    // A no-op for plain ASCII filenames, so always safe to apply.
    if (req.files) {
      req.files.forEach((file) => {
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      });
    }
    if (err) {
      console.error('[bulk-import] upload rejected:', err);
      if (isAjax) return res.status(400).json({ ok: false, error: `อัปโหลดรูปไม่สำเร็จ: ${err.message}` });
      req.flash('error', 'อัปโหลดรูปไม่สำเร็จ (สูงสุด 60 รูปต่อครั้ง รูปละไม่เกิน 8MB)');
      return res.redirect('/admin/products/bulk-import');
    }
    const directImages = directUploadUrls(req.body || {}, 'productImages');
    let directNames = [];
    try { directNames = JSON.parse(req.body.productImagesR2Names || '[]'); } catch (_) {}
    if ((!req.files || !req.files.length) && !directImages.length) {
      if (isAjax) return res.status(400).json({ ok: false, error: 'ไม่พบไฟล์รูปในคำขอนี้' });
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
      delete sharedFields.internalNote;

      const jobId = req.body.jobId;
      const files = req.files || [];
      setBulkImportProgress(jobId, 0, files.length + directImages.length);
      const uploadResults = await persistUploadedFiles(files, (done, total) => setBulkImportProgress(jobId, done, total + directImages.length));
      bulkImportJobs.delete(jobId);
      // Titles chosen client-side (either straight from the filename, or an
      // incrementing product code like lilteam-001, lilteam-002, ... typed
      // once by the admin) — one entry per file, same order as productImages.
      const providedTitles = [].concat(req.body.productTitles || []);
      const now = new Date().toISOString();
      // One bad file (corrupt image, mismatched extension, a transient R2
      // hiccup) must not block every other product in this chunk — skip it
      // and report it back so the whole folder can still finish importing.
      const failed = [];
      const created = [];
      directImages.forEach((url, i) => {
        const filename = String(directNames[i] || `สินค้า-${i + 1}`);
        const title = (providedTitles[i] && providedTitles[i].trim()) || filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'สินค้าใหม่';
        created.push({ id: store.genId(8), slug: slugify(title) + '-' + store.genId(4), ...sharedFields, title, images: [url], internalNote: filename, status: 'active', createdAt: now });
      });
      files.forEach((file, i) => {
        const result = uploadResults[i];
        if (!result.ok) {
          failed.push({ filename: file.originalname, error: result.error });
          return;
        }
        const titleIndex = directImages.length + i;
        const title = (providedTitles[titleIndex] && providedTitles[titleIndex].trim())
          || file.originalname.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
          || 'สินค้าใหม่';
        created.push({
          id: store.genId(8), slug: slugify(title) + '-' + store.genId(4),
          ...sharedFields, title, images: [result.url],
          // Original filename, kept as an admin-only reference regardless of
          // naming mode — handy for tying a renamed product code back to
          // whatever the source image was actually named.
          internalNote: file.originalname,
          status: 'active', createdAt: now,
        });
      });
      store.data.products.push(...created);
      await store.save();
      if (isAjax) return res.json({ ok: true, created: created.length, failed });
      if (failed.length) {
        req.flash('error', `นำเข้าสำเร็จ ${created.length} รายการ แต่มี ${failed.length} รูปที่ล้มเหลว: ${failed.map(f => f.filename).join(', ')}`);
      } else {
        req.flash('success', `นำเข้าสินค้าแล้ว ${created.length} รายการ — แก้ไขแต่ละชิ้นแยกได้ตามปกติ`);
      }
      res.redirect('/admin/products');
    } catch (saveError) {
      bulkImportJobs.delete(req.body.jobId);
      console.error('[bulk-import] failed:', saveError);
      if (isAjax) return res.status(500).json({ ok: false, error: saveError.message || 'บันทึกรูปสินค้าไม่สำเร็จ' });
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

router.post('/products/:id/price', async (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ ok: false, message: 'ไม่พบสินค้า' });
  const rawPrice = String(req.body.price == null ? '' : req.body.price).trim();
  const price = Number(rawPrice);
  if (!rawPrice || !Number.isInteger(price) || price < 0 || price > 100000000) {
    return res.status(400).json({ ok: false, message: 'กรุณากรอกราคาเป็นจำนวนเต็มตั้งแต่ 0 ถึง 100,000,000 บาท' });
  }
  product.price = price;
  await store.save();
  res.json({ ok: true, price, formattedPrice: `฿${price.toLocaleString('th-TH')}` });
});

router.post('/products/bulk-price', async (req, res) => {
  const operation = req.body.operation === 'increase' ? 'increase' : 'discount';
  const scope = req.body.scope === 'selected' ? 'selected' : 'all';
  const percentage = Number(String(req.body.percentage == null ? '' : req.body.percentage).trim());
  const selectedIds = new Set(toArr(req.body.productIds).map(String));
  const maxPercentage = operation === 'discount' ? 100 : 1000;
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > maxPercentage) {
    req.flash('error', `เปอร์เซ็นต์ต้องมากกว่า 0 และไม่เกิน ${maxPercentage}%`);
    return res.redirect('/admin/products');
  }
  if (scope === 'selected' && !selectedIds.size) {
    req.flash('error', 'กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');
    return res.redirect('/admin/products');
  }
  const targets = store.data.products.filter(product => scope === 'all' || selectedIds.has(String(product.id)));
  if (!targets.length) {
    req.flash('error', 'ไม่พบสินค้าที่ต้องการปรับราคา');
    return res.redirect('/admin/products');
  }
  const factor = operation === 'discount' ? 1 - (percentage / 100) : 1 + (percentage / 100);
  targets.forEach(product => {
    const currentPrice = Math.max(0, Number(product.price) || 0);
    const nextPrice = Math.min(100000000, Math.max(0, Math.round(currentPrice * factor)));
    if (operation === 'discount' && nextPrice < currentPrice) {
      product.originalPrice = Math.max(Number(product.originalPrice) || 0, currentPrice);
    }
    product.price = nextPrice;
  });
  await store.save();
  const actionLabel = operation === 'discount' ? 'ลด' : 'เพิ่ม';
  req.flash('success', `${actionLabel}ราคา ${percentage}% สำเร็จ ${targets.length} รายการ`);
  res.redirect('/admin/products');
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
      const uploadedImages = [...directUploadUrls(req.body, 'productImages'), ...unwrapUploadResults(await persistUploadedFiles(req.files || []))];
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

// Bulk-adds 1 sellable unit to every product that currently has zero stock,
// using "contact" fulfillment (no username/password needed — the admin
// delivers the account manually via chat after purchase, same as the
// per-product /stock/add flow already does for that mode). Only ever
// touches products that are at zero stock, so it can never oversell or
// clobber real credential-based stock someone already set up.
router.post('/products/stock/add-all', async (req, res) => {
  const stockCountByProduct = new Map();
  store.data.stockItems.forEach(s => {
    if (s.status === 'available') stockCountByProduct.set(s.productId, (stockCountByProduct.get(s.productId) || 0) + 1);
  });
  const now = new Date().toISOString();
  let updated = 0;
  store.data.products.forEach(product => {
    if (stockCountByProduct.get(product.id) > 0) return;
    product.fulfillmentMode = 'contact';
    store.data.stockItems.push({
      id: store.genId(10), productId: product.id, username: '', password: '', extra: '',
      fulfillmentMode: 'contact', status: 'available', soldOrderId: null, addedAt: now,
    });
    updated++;
  });
  await store.save();
  req.flash('success', updated
    ? `เพิ่มสต็อก 1 ชิ้นให้สินค้าที่สต็อกว่างแล้ว ${updated} รายการ (โหมด "ติดต่อร้านเพื่อรับสินค้า" — ส่งไอดีให้ลูกค้าเองหลังขายผ่านแชท)`
    : 'ไม่มีสินค้าที่สต็อกว่างเลย ไม่ได้เพิ่มอะไร');
  res.redirect('/admin/products');
});

router.post('/products/set-status-all', async (req, res) => {
  const status = req.body.status === 'hidden' ? 'hidden' : 'active';
  store.data.products.forEach(p => { p.status = status; });
  await store.save();
  req.flash('success', status === 'active'
    ? `เปิดขายสินค้าทั้งหมด ${store.data.products.length} รายการแล้ว`
    : `ซ่อนสินค้าทั้งหมด ${store.data.products.length} รายการแล้ว`);
  res.redirect('/admin/products');
});

// Irreversible — wipes every product AND its stock in one go. Gated by a
// typed confirmation phrase on the products page (see products.ejs) since
// there's no per-item undo once store.save() commits this. Past orders are
// untouched; they reference a snapshot of the product at purchase time, not
// a live product/stock record.
router.post('/products/delete-all', async (req, res) => {
  if ((req.body.confirmPhrase || '').trim() !== 'ลบสินค้าทั้งหมด') {
    req.flash('error', 'ข้อความยืนยันไม่ถูกต้อง ไม่ได้ลบสินค้าใดๆ');
    return res.redirect('/admin/products');
  }
  const deletedIds = new Set(store.data.products.map(p => p.id));
  const productCount = store.data.products.length;
  const stockCount = store.data.stockItems.filter(s => deletedIds.has(s.productId)).length;
  store.data.products = [];
  store.data.stockItems = store.data.stockItems.filter(s => !deletedIds.has(s.productId));
  await store.save();
  req.flash('success', `ลบสินค้าทั้งหมด ${productCount} รายการ และสต็อก ${stockCount} รายการแล้ว`);
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
  const products = store.data.products.map(p => ({
    id: p.id,
    title: p.title,
    image: p.images && p.images[0],
    status: p.status,
    filterTagIds: p.filterTagIds || [],
  }));
  res.render('admin/filter-tags', { title: 'ตัวกรองสินค้า', active: 'filter-tags', filterTags, products });
});

// Import the eFHUB player-card images into the existing filter-tag library.
// This deliberately does not change the storefront model; it only creates
// reusable image tags that work with the classic filter panel and product
// assignment UI.
router.post('/filter-tags/efootball/import', async (req, res) => {
  const sourceItems = efootballSource.queryCatalog({}).items;
  const sourceIds = new Set(sourceItems.map(player => String(player.id)));
  const staleIds = new Set(store.data.filterTags
    .filter(tag => String(tag.id).startsWith('efootball-') && !sourceIds.has(String(tag.sourceId || tag.id).replace(/^efootball-/, '')))
    .map(tag => String(tag.id)));
  if (staleIds.size) {
    store.data.filterTags = store.data.filterTags.filter(tag => !staleIds.has(String(tag.id)));
    store.data.products.forEach(product => {
      product.filterTagIds = (product.filterTagIds || []).filter(id => !staleIds.has(String(id)));
    });
  }
  const existing = new Map(store.data.filterTags.map(tag => [String(tag.id), tag]));
  let created = 0;
  sourceItems.forEach(player => {
    const id = `efootball-${player.id}`;
    const current = existing.get(id);
    if (current) {
      current.name = player.name;
      current.image = player.imageUrl;
      current.source = 'eFHUB';
      current.sourceId = player.id;
      return;
    }
    const tag = {
      id,
      name: player.name,
      image: player.imageUrl,
      source: 'eFHUB',
      sourceId: player.id,
      createdAt: new Date().toISOString(),
    };
    store.data.filterTags.push(tag);
    existing.set(id, tag);
    created += 1;
  });
  await store.save();
  req.flash('success', `นำเข้ารูปผู้เล่นจาก eFHUB New Players เป็นแท็กตัวกรองแล้ว ${sourceItems.length} รายการ (เพิ่มใหม่ ${created}${staleIds.size ? ` ลบรายการเก่า ${staleIds.size}` : ''})`);
  res.redirect('/admin/filter-tags');
});

router.post('/filter-tags/:id/products', async (req, res) => {
  const tag = store.data.filterTags.find(t => String(t.id) === String(req.params.id));
  if (!tag) {
    req.flash('error', 'ไม่พบตัวกรองสินค้า');
    return res.redirect('/admin/filter-tags');
  }
  const selected = new Set([].concat(req.body.productIds || []).map(String));
  store.data.products.forEach(p => {
    const tags = new Set((p.filterTagIds || []).map(String));
    if (selected.has(String(p.id))) tags.add(String(tag.id));
    else tags.delete(String(tag.id));
    p.filterTagIds = [...tags];
  });
  await store.save();
  req.flash('success', `อัปเดตสินค้าในตัวกรอง “${tag.name}” แล้ว`);
  res.redirect('/admin/filter-tags');
});

router.post('/filter-tags/:tagId/products/:productId/add', async (req, res) => {
  const tag = store.data.filterTags.find(t => String(t.id) === String(req.params.tagId));
  const product = store.data.products.find(p => String(p.id) === String(req.params.productId));
  if (!tag || !product) return res.status(404).json({ ok: false, message: 'ไม่พบตัวกรองหรือสินค้า' });
  const tags = new Set((product.filterTagIds || []).map(String));
  tags.add(String(tag.id));
  product.filterTagIds = [...tags];
  await store.save();
  res.json({
    ok: true,
    tag: { id: String(tag.id), name: tag.name, image: tag.image },
    filterTagIds: product.filterTagIds,
  });
});

router.post('/filter-tags', (req, res) => {
  filterImageUpload.array('filterImages', 60)(req, res, store.bindTenantContext(async (err) => {
    const files = req.files || [];
    const directImages = directUploadUrls(req.body || {}, 'filterImages');
    if (err || (!files.length && !directImages.length)) {
      req.flash('error', 'กรุณาแนบรูปตัวกรอง (สูงสุด 60 รูป รูปละไม่เกิน 8MB)');
      return res.redirect('/admin/filter-tags');
    }
    const name = (req.body.name || '').trim();
    if ((files.length + directImages.length) === 1 && !name) {
      req.flash('error', 'กรุณากรอกชื่อตัวกรอง');
      return res.redirect('/admin/filter-tags');
    }
    try {
      let savedCount = 0;
      const failed = [];
      const failureReasons = [];
      const directNames = (() => { try { return JSON.parse(req.body.filterImagesR2Names || '[]'); } catch (_) { return []; } })();
      directImages.forEach((image, index) => {
        const filterName = directImages.length === 1 && !files.length ? name : String(directNames[index] || '').replace(/\.[^.]+$/, '').trim();
        store.data.filterTags.push({ id: store.genId(8), name: filterName || 'ตัวกรอง', image, createdAt: new Date().toISOString() });
        savedCount += 1;
      });
      for (const file of files) {
        try {
          const hex = file.buffer.toString('hex', 0, 4);
          let detected = hex.startsWith('89504e47') ? { extension: '.png', mime: 'image/png' }
            : hex.startsWith('ffd8') ? { extension: '.jpg', mime: 'image/jpeg' }
              : hex.startsWith('47494638') ? { extension: '.gif', mime: 'image/gif' }
                : (file.buffer.length >= 12 && file.buffer.toString('utf8', 8, 12) === 'WEBP') ? { extension: '.webp', mime: 'image/webp' } : null;
          let imageBuffer = file.buffer;
          // Some game/export tools give browser-readable images a .png name even
          // though the bytes are AVIF, HEIF, TIFF or another Sharp-supported type.
          // Decode the actual image and normalize it instead of trusting its name.
          if (!detected) {
            const sharp = require('sharp');
            const metadata = await sharp(file.buffer, { failOn: 'error' }).metadata();
            if (!metadata.width || !metadata.height) throw new Error('ข้อมูลไฟล์ไม่ใช่รูปภาพ');
            imageBuffer = await sharp(file.buffer, { failOn: 'error' })
              .rotate()
              .webp({ quality: 90 })
              .toBuffer();
            detected = { extension: '.webp', mime: 'image/webp' };
          }
          const image = await store.saveMedia(imageBuffer, `filter-${store.genId(10)}${detected.extension}`, detected.mime);
          const filterName = files.length === 1 ? name : file.originalname.replace(/\.[^.]+$/, '').trim();
          store.data.filterTags.push({ id: store.genId(8), name: filterName || 'ตัวกรอง', image, createdAt: new Date().toISOString() });
          savedCount += 1;
        } catch (fileError) {
          failed.push(file.originalname);
          failureReasons.push(fileError.message);
          console.error('[filter-tags] image save failed:', file.originalname, fileError.message);
        }
      }
      if (!savedCount) {
        throw new Error(failureReasons[0] || 'ไม่สามารถอ่านหรือบันทึกไฟล์รูปภาพได้');
      }
      await store.save();
      req.flash('success', `เพิ่มตัวกรอง ${savedCount} รายการแล้ว${failed.length ? ` (ข้าม ${failed.length} รูปที่มีปัญหา)` : ''}`);
    } catch (saveError) {
      console.error('[filter-tags] bulk save failed:', saveError.message);
      req.flash('error', `บันทึกรูปตัวกรองไม่สำเร็จ: ${saveError.message}`);
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

router.post('/filter-tags/bulk-delete', async (req, res) => {
  const ids = new Set([].concat(req.body?.tagIds || [])
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean));
  if (!ids.size) {
    req.flash('error', 'กรุณาเลือกตัวกรองที่ต้องการลบ');
    return res.redirect('/admin/filter-tags');
  }
  try {
    const removed = await store.transact(data => {
      data.filterTags ||= [];
      data.products ||= [];
      const before = data.filterTags.length;
      data.filterTags = data.filterTags.filter(tag => !ids.has(String(tag.id)));
      data.products.forEach(product => {
        product.filterTagIds = (product.filterTagIds || []).filter(id => !ids.has(String(id)));
      });
      return before - data.filterTags.length;
    });
    req.flash('success', `ลบตัวกรอง ${removed} รายการแล้ว`);
  } catch (error) {
    console.error('[filter-tags/bulk-delete] failed:', error.message);
    req.flash('error', 'ลบตัวกรองไม่สำเร็จ กรุณาลองใหม่');
  }
  res.redirect('/admin/filter-tags');
});

router.post('/filter-tags/:id/edit', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const tag = store.data.filterTags.find(t => t.id === req.params.id);
  if (!tag) req.flash('error', 'ไม่พบตัวกรองสินค้า');
  else if (!name) req.flash('error', 'กรุณากรอกชื่อตัวกรอง');
  else {
    tag.name = name.slice(0, 100);
    await store.save();
    req.flash('success', 'แก้ไขชื่อตัวกรองแล้ว');
  }
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
  store.data.homeSections.push({ id: store.genId(8), title, mode, limit, productIds, imageUrl: String(req.body.imageUrl || '').trim(), enabled: true });
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
  section.imageUrl = String(req.body.imageUrl || '').trim();
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

router.get('/recommended-categories', (req, res) => {
  res.render('admin/recommended-categories', { title: 'หมวดหมู่แนะนำ', active: 'recommended-categories', categories: store.data.recommendedCategories || [], products: store.data.products.filter(p => p.status === 'active') });
});
router.post('/recommended-categories', (req, res) => bannerUpload.single('image')(req, res, store.bindTenantContext(async err => {
  const title = String(req.body.title || '').trim();
  if (err || !title) { req.flash('error', err ? 'อัปโหลดรูปไม่สำเร็จ' : 'กรุณากรอกชื่อหมวดหมู่'); return res.redirect('/admin/recommended-categories'); }
  store.data.recommendedCategories ||= [];
  const imageUrl = req.file ? await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype) : String(req.body.imageUrl || '').trim();
  store.data.recommendedCategories.push({ id: store.genId(8), title, imageUrl, productIds: [], count: 0, enabled: true });
  await store.save(); req.flash('success', 'เพิ่มหมวดหมู่แนะนำแล้ว'); res.redirect('/admin/recommended-categories');
})));
router.post('/recommended-categories/:id/products', async (req, res) => {
  const category = (store.data.recommendedCategories || []).find(item => item.id === req.params.id);
  if (!category) return res.status(404).send('ไม่พบหมวดหมู่');
  const valid = new Set(store.data.products.map(product => String(product.id)));
  category.productIds = [...new Set([].concat(req.body.productIds || []).map(String).filter(id => valid.has(id)))];
  category.count = category.productIds.length;
  await store.save(); req.flash('success', 'บันทึกสินค้าในหมวดแล้ว'); res.redirect('/admin/recommended-categories');
});
router.post('/recommended-categories/:id/delete', async (req, res) => {
  store.data.recommendedCategories = (store.data.recommendedCategories || []).filter(category => category.id !== req.params.id);
  await store.save(); req.flash('success', 'ลบหมวดหมู่แนะนำแล้ว'); res.redirect('/admin/recommended-categories');
});
router.post('/recommended-categories/:id/toggle', async (req, res) => {
  const category = (store.data.recommendedCategories || []).find(item => item.id === req.params.id);
  if (category) category.enabled = category.enabled === false;
  await store.save(); res.redirect('/admin/recommended-categories');
});

router.post('/home-sections/:id/toggle', async (req, res) => {
  const section = store.data.homeSections.find(s => s.id === req.params.id);
  if (!section) { req.flash('error', 'ไม่พบหมวดหมู่นี้'); return res.redirect('/admin/home-sections'); }
  section.enabled = section.enabled === false;
  await store.save();
  req.flash('success', section.enabled ? 'เปิดแสดงหมวดหมู่แล้ว' : 'ปิดการแสดงหมวดหมู่แล้ว');
  res.redirect('/admin/home-sections');
});

// ---------- Storefront models ----------
router.get('/storefront-models', (req, res) => {
  res.render('admin/storefront-models', {
    title: 'โมเดลหน้าร้าน LINE Rangers',
    active: 'storefront-models',
    currentModel: store.data.settings.storefrontModel || 'classic',
    allowRangersMarket: !!req.tenantShop?.isSystemLab,
  });
});

router.post('/storefront-models', async (req, res) => {
  const allowed = new Set(['classic', 'line-rangers']);
  if (req.tenantShop?.isSystemLab) allowed.add('rangers-market');
  const model = String(req.body.model || '');
  if (!allowed.has(model)) {
    req.flash('error', 'ไม่พบโมเดลหน้าร้านที่เลือก');
    return res.redirect('/admin/storefront-models');
  }
  store.data.settings.storefrontModel = model;
  await store.save();
  const modelNames = {
    classic: 'โมเดลหน้าร้านมาตรฐาน',
    'line-rangers': 'โมเดล LINE Rangers เดิม',
    'rangers-market': 'โมเดล Rangers Market',
  };
  req.flash('success', `เปิดใช้${modelNames[model]}แล้ว`);
  res.redirect('/admin/storefront-models');
});

// ---------- LINE Rangers catalog (System Lab trial only) ----------
const requireSystemLab = (req, res, next) => req.tenantShop?.isSystemLab
  ? next()
  : res.status(404).render('shop/404', {
    layout: 'layouts/main', title: 'ไม่พบหน้านี้', statusCode: 404,
    message: 'ไม่พบหน้าที่คุณต้องการ', backPath: '/admin', backLabel: 'กลับหลังบ้าน',
  });
const rangerImageUrl = rangerId => {
  const id = String(rangerId || '').trim().toLowerCase();
  return `https://rangers.lerico.net/res/${id}/${id}-thum.png`;
};
const rangersSource = require('../services/rangers-catalog');

router.get('/rangers-model', requireSystemLab, (req, res) => {
  const catalog = store.data.settings.rangersCatalog || { enabled: false, items: [], productAssignments: {} };
  const assignments = catalog.productAssignments || {};
  res.render('admin/rangers-model', {
    title: 'LINE Rangers Studio', active: 'rangers-model',
    currentModel: store.data.settings.storefrontModel || 'classic',
    catalog, sourceCount: rangersSource.sourceCount,
    productCount: store.data.products.length,
    assignedProductCount: Object.keys(assignments).filter(id => (assignments[id] || []).length).length,
  });
});

router.get('/rangers-catalog', requireSystemLab, (req, res) => {
  res.render('admin/rangers-catalog', {
    title: 'คลังตัวละคร LINE Rangers', active: 'rangers-catalog',
    catalog: store.data.settings.rangersCatalog || { enabled: false, items: [] }, rangerImageUrl,
    products: store.data.products.map(product => ({ id: product.id, title: product.title })),
    sourceCount: rangersSource.sourceCount,
    selectedProductId: String(req.query.product || ''),
    productAssignments: Object.fromEntries(Object.entries(store.data.settings.rangersCatalog?.productAssignments || {})
      .map(([productId, codes]) => [productId, rangersSource.resolveCodes(codes)])),
  });
});

router.get('/rangers-catalog/source', requireSystemLab, (req, res) => {
  res.json(rangersSource.queryCatalog(req.query));
});

router.post('/rangers-catalog/refresh', requireSystemLab, async (req, res) => {
  try {
    const result = await rangersSource.refresh();
    req.flash('success', `อัปเดตข้อมูลแล้ว ${result.rangerCount} ตัวละคร และ ${result.gearCount} เกียร์`);
  } catch (error) {
    req.flash('error', `อัปเดตไม่สำเร็จ ระบบยังใช้ข้อมูลเดิม: ${error.message}`);
  }
  res.redirect('/admin/rangers-catalog');
});

router.post('/rangers-catalog/assign', requireSystemLab, async (req, res) => {
  const productId = String(req.body.productId || '');
  if (!store.data.products.some(product => product.id === productId)) {
    req.flash('error', 'ไม่พบสินค้าที่เลือก');
    return res.redirect('/admin/rangers-catalog');
  }
  let submitted = [];
  try { submitted = JSON.parse(req.body.rangerCodes || '[]'); } catch { submitted = []; }
  store.data.settings.rangersCatalog ||= { enabled: false, items: [] };
  store.data.settings.rangersCatalog.productAssignments ||= {};
  store.data.settings.rangersCatalog.productAssignments[productId] = rangersSource.validCodes(submitted);
  await store.save();
  req.flash('success', `บันทึกตัวละครให้สินค้าแล้ว ${store.data.settings.rangersCatalog.productAssignments[productId].length} รายการ`);
  res.redirect(`/admin/rangers-catalog?product=${encodeURIComponent(productId)}`);
});

router.post('/rangers-catalog/toggle', requireSystemLab, async (req, res) => {
  store.data.settings.rangersCatalog ||= { enabled: false, items: [] };
  store.data.settings.rangersCatalog.enabled = req.body.enabled === '1';
  await store.save();
  req.flash('success', store.data.settings.rangersCatalog.enabled ? 'เปิดใช้คลังตัวละครแล้ว' : 'ปิดคลังตัวละครแล้ว');
  res.redirect('/admin/rangers-catalog');
});

router.post('/rangers-catalog/items', requireSystemLab, async (req, res) => {
  const rangerId = String(req.body.rangerId || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  if (!/^[a-z0-9_-]{3,80}$/.test(rangerId) || !name) {
    req.flash('error', 'กรุณากรอกรหัสและชื่อตัวละครให้ถูกต้อง');
    return res.redirect('/admin/rangers-catalog');
  }
  store.data.settings.rangersCatalog ||= { enabled: false, items: [] };
  const items = store.data.settings.rangersCatalog.items ||= [];
  if (items.some(item => item.rangerId === rangerId)) {
    req.flash('error', 'มีรหัสนี้อยู่ในคลังแล้ว');
    return res.redirect('/admin/rangers-catalog');
  }
  items.push({ id: store.genId(8), rangerId, name,
    stars: Math.min(9, Math.max(1, Number(req.body.stars) || 8)),
    form: ['normal', 'ultra', 'hyper'].includes(req.body.form) ? req.body.form : 'normal',
    type: req.body.type === 'gear' ? 'gear' : 'ranger', imageUrl: rangerImageUrl(rangerId),
    createdAt: new Date().toISOString() });
  await store.save();
  req.flash('success', `เพิ่ม ${name} แล้ว`);
  res.redirect('/admin/rangers-catalog');
});

router.post('/rangers-catalog/items/:id/delete', requireSystemLab, async (req, res) => {
  store.data.settings.rangersCatalog ||= { enabled: false, items: [] };
  store.data.settings.rangersCatalog.items = (store.data.settings.rangersCatalog.items || []).filter(item => item.id !== req.params.id);
  await store.save();
  req.flash('success', 'ลบรายการแล้ว');
  res.redirect('/admin/rangers-catalog');
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
  const productsById = new Map(store.data.products.map(product => [product.id, product]));
  const orders = [...store.data.orders]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(o => {
      const buyer = store.data.users.find(u => u.id === o.userId);
      const itemSearchTerms = (o.items || []).flatMap(item => {
        const product = productsById.get(item.productId);
        return [item.title, item.productId, item.importedFileCode, product?.internalNote];
      });
      return {
        ...o,
        buyer,
        displayItems: (o.items || []).map(item => {
          const product = productsById.get(item.productId);
          return {
            title: item.title || product?.title || 'สินค้า',
            importedFileCode: item.importedFileCode || product?.internalNote || '',
          };
        }),
        searchTerms: [o.id, buyer?.username, buyer?.email, ...itemSearchTerms].filter(Boolean).join(' '),
      };
    });
  res.render('admin/orders', { title: 'คำสั่งซื้อ', active: 'orders', orders });
});

router.get('/orders/:id', (req, res) => {
  const order = store.data.orders.find(o => o.id === req.params.id);
  if (!order) { req.flash('error', 'ไม่พบคำสั่งซื้อ'); return res.redirect('/admin/orders'); }
  const buyer = store.data.users.find(u => u.id === order.userId);
  const itemsWithCreds = order.items.map(oi => {
    const product = store.data.products.find(p => p.id === oi.productId);
    return {
      ...oi,
      credentials: store.data.stockItems.find(s => s.id === oi.stockItemId),
      productImage: oi.productImage || product?.images?.[0] || '',
      importedFileCode: oi.importedFileCode || product?.internalNote || '',
    };
  });
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
  const registered = req.query.registered === 'today' ? 'today' : '';
  const needle = q.toLocaleLowerCase('th-TH');
  const bangkokDay = date => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const todayKey = bangkokDay(new Date());
  const matched = [...store.data.users]
    .filter(user => user.role === 'customer' || !registered)
    .filter(user => !registered || bangkokDay(new Date(user.createdAt)) === todayKey)
    .filter(user => !needle
      || String(user.username || '').toLocaleLowerCase('th-TH').includes(needle)
      || String(user.email || '').toLocaleLowerCase('th-TH').includes(needle))
    .sort((a, b) => registered
      ? new Date(b.createdAt) - new Date(a.createdAt)
      : String(a.username || '').localeCompare(String(b.username || ''), 'th'));

  const pageSizeOptions = [10, 25, 50, 100];
  const pageSize = pageSizeOptions.includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 10;
  const totalPages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(req.query.page) || 1));
  const users = matched.slice((page - 1) * pageSize, page * pageSize);

  const totalWalletBalance = store.data.users.reduce((sum, u) => sum + (Number(u.walletBalance) || 0), 0);

  res.render('admin/users', {
    title: 'สมาชิก', active: 'users', users, q, registered,
    totalUsers: store.data.users.length,
    totalWalletBalance, matchedCount: matched.length,
    page, totalPages, pageSize, pageSizeOptions,
  });
});

router.get('/users/:id', (req, res) => {
  const user = store.data.users.find(item => item.id === req.params.id);
  if (!user) {
    req.flash('error', 'ไม่พบสมาชิก');
    return res.redirect('/admin/users');
  }

  const orders = store.data.orders
    .filter(order => order.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const topups = store.data.topupRequests
    .filter(request => request.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const transactions = store.data.walletTransactions
    .filter(transaction => transaction.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const paidOrders = orders.filter(order => order.status !== 'cancelled');

  return res.render('admin/user-detail', {
    title: `สมาชิก ${user.username}`, active: 'users', user,
    orders: orders.slice(0, 10), topups: topups.slice(0, 10), transactions: transactions.slice(0, 10),
    orderCount: orders.length,
    totalSpent: paidOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
  });
});

router.post('/users/:id/wallet', async (req, res) => {
  const amount = Number(req.body.amount);
  const user = store.data.users.find(u => u.id === req.params.id);
  if (!user) {
    req.flash('error', 'ไม่พบสมาชิก');
    return res.redirect('/admin/users');
  }
  if (!Number.isFinite(amount) || amount < 0) {
    req.flash('error', 'กรุณาระบุยอดเงินใหม่ที่ถูกต้อง');
    return res.redirect('/admin/users');
  }
  await store.transact((data) => {
    const freshUser = data.users.find(u => u.id === req.params.id);
    if (!freshUser) throw new Error('ไม่พบสมาชิก');
    const previousBalance = Number(freshUser.walletBalance) || 0;
    freshUser.walletBalance = Math.round(amount * 100) / 100;
    data.walletTransactions.push({
      id: store.genId(10), userId: freshUser.id, type: 'adjust', amount: Math.round((freshUser.walletBalance - previousBalance) * 100) / 100,
      note: `ผู้ดูแลระบบกำหนดยอดเป็น ฿${freshUser.walletBalance.toLocaleString()} (${req.body.note || 'ไม่มีหมายเหตุ'})`, createdAt: new Date().toISOString(),
    });
  });
  req.flash('success', `กำหนดยอดเงินเป็น ฿${amount.toLocaleString()} สำเร็จ`);
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
  const bankOptions = banks;
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
  const payment = store.data.settings.payment;
  const isTenant = Boolean(req.tenantShop);
  const sharedTenant = Boolean(isTenant && (payment.slipApiMode || 'shared') === 'shared');
  const effective = effectiveSlipConfig(payment, store.platformData.settings.payment, isTenant);
  const availableReceiverProviders = sharedTenant
    ? receiverProfiles.PROVIDERS.filter(provider => provider === effective.slipProvider)
    : [...receiverProfiles.PROVIDERS];
  const requestedReceiverProvider = String(req.query.receiverProvider || '').toLowerCase();
  const receiverProvider = availableReceiverProviders.includes(requestedReceiverProvider) ? requestedReceiverProvider : null;
  const receiverPayment = receiverProfiles.view(payment, receiverProvider
    || availableReceiverProviders[0]
    || (receiverProfiles.PROVIDERS.includes(payment.slipProvider) ? payment.slipProvider : 'slipcheck'));
  res.render('admin/topups', {
    title: 'บัญชี', active: 'topups', requests, pendingCount, payment, receiverPayment,
    receiverProvider, availableReceiverProviders, activeReceiverProvider: effective.slipProvider, banks: bankOptions, q, status,
  });
});

// Slip Verification Hub & Provider Management.
async function renderSlipVerificationHub(req, res) {
  const payment = store.data.settings.payment || {};
  const usesSharedProvider = Boolean(req.tenantShop && (payment.slipApiMode || 'shared') === 'shared');
  const effective = effectiveSlipConfig(payment, store.platformData.settings.payment, Boolean(req.tenantShop));
  let slipokInfo = null;
  if (payment.slipokBranchId && payment.slipokApiKey) {
    try {
      slipokInfo = await slipok.testConnection({ branchId: payment.slipokBranchId, apiKey: payment.slipokApiKey });
    } catch (e) {
      slipokInfo = { ok: false, message: e.message };
    }
  }

  let slip2goInfo = null;
  if (!usesSharedProvider && effective.slip2goApiKey) {
    try {
      slip2goInfo = await slip2go.checkBalance(effective.slip2goApiKey, effective.slip2goEndpoint);
    } catch (e) {
      slip2goInfo = { ok: false, message: e.message };
    }
  }

  let slipcheckInfo = null;
  let slipcheckPoolInfo = null;
  const slipcheckKeys = slipcheck.resolveApiKeys(effective.slipcheckApiKey, effective.slipcheckApiKeys, effective.slipcheckIndependentQuota ? 50 : 5);
  if (!usesSharedProvider && slipcheckKeys.length) {
    try {
      slipcheckPoolInfo = await slipcheck.getPoolAccountInfo(slipcheckKeys, effective.slipcheckEndpoint, { independent: Boolean(effective.slipcheckIndependentQuota) });
      slipcheckInfo = slipcheckPoolInfo.accounts.find(account => account.ok) || slipcheckPoolInfo.accounts[0] || null;
    } catch (e) {
      slipcheckInfo = { ok: false, message: e.message };
      slipcheckPoolInfo = { ok: false, keyCount: slipcheckKeys.length, accounts: [], totalRemaining: 0, message: e.message };
    }
  }

  const rdcwInfo = !usesSharedProvider && effective.rdcwClientId && effective.rdcwClientSecret
    ? { ...rdcwSlip.validateCredentials(effective.rdcwClientId, effective.rdcwClientSecret), quotaUnavailable: true }
    : null;
  const xephtInfo = xephtSlip.validateCredentials(effective.xephtApiKey, effective.xephtEndpoint);

  const bankOptions = banks;
  const savedOwnerCosts = store.data.settings.ownerOperatingCosts || {};
  const ownerCosts = {
    vpsAmount: Number.isFinite(Number(savedOwnerCosts.vpsAmount)) ? Number(savedOwnerCosts.vpsAmount) : 250,
    vpsBillingDay: Math.min(28, Math.max(1, Number(savedOwnerCosts.vpsBillingDay) || 3)),
  };

  function nextMonthlyDue(day) {
    const bangkokNow = new Date(Date.now() + (7 * 60 * 60 * 1000));
    const year = bangkokNow.getUTCFullYear();
    const month = bangkokNow.getUTCMonth();
    const dueMonth = bangkokNow.getUTCDate() > day ? month + 1 : month;
    // 05:00 UTC is noon in Bangkok and keeps the displayed calendar date
    // stable regardless of the VPS process timezone.
    return new Date(Date.UTC(year, dueMonth, day, 5, 0, 0));
  }

  const ownerCostSummary = {
    ...ownerCosts,
    totalMonthly: ownerCosts.vpsAmount,
    vpsNextDue: nextMonthlyDue(ownerCosts.vpsBillingDay),
  };

  res.render('admin/slip-verification', {
    title: 'ระบบตรวจสอบสลิปด้วย API (Slip Provider Hub)',
    active: 'slip-verification',
    payment,
    slipokInfo,
    slip2goInfo,
    slipcheckInfo,
    slipcheckPoolInfo,
    rdcwInfo,
    xephtInfo,
    effectiveProvider: effective.slipProvider,
    usesSharedProvider,
    banks: bankOptions,
    ownerCostSummary,
  });
}

router.get('/slip-verification', renderSlipVerificationHub);

router.post('/slip-verification/billing', async (req, res) => {
  if (req.tenantShop) {
    req.flash('error', 'ตั้งค่าค่าใช้จ่ายได้เฉพาะเว็บหลักเท่านั้น');
    return res.redirect('/admin');
  }

  const amount = value => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
  const billingDay = value => Math.min(28, Math.max(1, Math.trunc(Number(value) || 1)));
  store.data.settings.ownerOperatingCosts = {
    vpsAmount: amount(req.body.vpsAmount),
    vpsBillingDay: billingDay(req.body.vpsBillingDay),
  };
  await store.save();
  req.flash('success', 'บันทึกค่าใช้จ่ายและวันจ่ายของเว็บไซต์แล้ว');
  res.redirect('/admin/slip-verification');
});

router.post('/slip-verification', async (req, res) => {
  const payment = store.data.settings.payment;
  const previousReceiverProvider = receiverProfiles.PROVIDERS.includes(payment.slipProvider) ? payment.slipProvider : 'slipcheck';
  receiverProfiles.save(payment, previousReceiverProvider, receiverProfiles.snapshot(payment));
  const slipApiMode = req.tenantShop && req.body.slipApiMode === 'own' ? 'own' : (req.tenantShop ? 'shared' : 'own');
  const allowedProviders = ['none', 'slipok', 'slipcheck', 'rdcw', 'slip2go', 'xepht'];
  const submittedProvider = Array.isArray(req.body.slipProvider) ? req.body.slipProvider.at(-1) : req.body.slipProvider;
  const previousProvider = allowedProviders.includes(payment.slipProvider) ? payment.slipProvider : 'slipcheck';
  const slipProvider = submittedProvider || previousProvider;
  if (!allowedProviders.includes(slipProvider)) {
    req.flash('error', 'กรุณาเลือกผู้ให้บริการตรวจสลิปที่รองรับ');
    return res.redirect('/admin/slip-verification');
  }
  const slipokBranchId = (req.body.slipokBranchId !== undefined ? req.body.slipokBranchId : (payment.slipokBranchId || '')).trim();
  const slipokApiKey = (req.body.slipokApiKey !== undefined ? req.body.slipokApiKey : (payment.slipokApiKey || '')).trim();
  const slip2goApiKey = (req.body.slip2goApiKey !== undefined ? req.body.slip2goApiKey : (payment.slip2goApiKey || '')).trim();
  const slip2goEndpoint = (req.body.slip2goEndpoint !== undefined ? req.body.slip2goEndpoint : (payment.slip2goEndpoint || slip2go.DEFAULT_ENDPOINT)).trim();
  const slipcheckApiKey = (req.body.slipcheckApiKey !== undefined ? req.body.slipcheckApiKey : (payment.slipcheckApiKey || '')).trim();
  const slipcheckIndependentQuota = !req.tenantShop && (req.body.slipcheckIndependentQuota === 'on' || req.body.slipcheckIndependentQuota === 'true');
  const submittedSlipcheckKeys = req.body.slipcheckApiKeys !== undefined ? req.body.slipcheckApiKeys : (payment.slipcheckApiKeys || []);
  const slipcheckApiKeys = req.tenantShop
    ? (Array.isArray(payment.slipcheckApiKeys) ? payment.slipcheckApiKeys : [])
    : slipcheck.resolveApiKeys(slipcheckApiKey, submittedSlipcheckKeys, slipcheckIndependentQuota ? 50 : 5);
  const slipcheckEndpoint = (req.body.slipcheckEndpoint !== undefined ? req.body.slipcheckEndpoint : (payment.slipcheckEndpoint || slipcheck.DEFAULT_ENDPOINT)).trim();
  const rdcwClientId = (req.body.rdcwClientId !== undefined ? req.body.rdcwClientId : (payment.rdcwClientId || '')).trim();
  const rdcwClientSecret = (req.body.rdcwClientSecret !== undefined ? req.body.rdcwClientSecret : (payment.rdcwClientSecret || '')).trim();
  const rdcwEndpoint = (req.body.rdcwEndpoint !== undefined ? req.body.rdcwEndpoint : (payment.rdcwEndpoint || rdcwSlip.DEFAULT_ENDPOINT)).trim();
  const xephtApiKey = (req.body.xephtApiKey !== undefined ? req.body.xephtApiKey : (payment.xephtApiKey || '')).trim();
  const xephtEndpoint = (req.body.xephtEndpoint !== undefined ? req.body.xephtEndpoint : (payment.xephtEndpoint || xephtSlip.DEFAULT_ENDPOINT)).trim();
  if (slipProvider === 'xepht') {
    const validation = xephtSlip.validateCredentials(xephtApiKey, xephtEndpoint);
    if (!validation.ok) {
      req.flash('error', validation.message);
      return res.redirect('/admin/slip-verification');
    }
  }
  const customSlipEndpoint = (req.body.customSlipEndpoint !== undefined ? req.body.customSlipEndpoint : (payment.customSlipEndpoint || '')).trim();
  const customSlipApiKey = (req.body.customSlipApiKey !== undefined ? req.body.customSlipApiKey : (payment.customSlipApiKey || '')).trim();

  const missingCredentials = slipApiMode === 'own' && ((slipProvider === 'slipcheck' && !slipcheckApiKeys.length)
    || (slipProvider === 'rdcw' && (!rdcwClientId || !rdcwClientSecret))
    || (slipProvider === 'slip2go' && !slip2goApiKey));
  if (missingCredentials) {
    req.flash('error', 'กรุณากรอกข้อมูล API ของผู้ให้บริการที่เลือกให้ครบก่อนบันทึก');
    return res.redirect('/admin/slip-verification');
  }

  Object.assign(payment, {
    slipProvider,
    slipApiMode,
    slipokBranchId,
    slipokApiKey,
    slip2goApiKey,
    slip2goEndpoint,
    slipcheckApiKey,
    slipcheckApiKeys,
    slipcheckIndependentQuota,
    slipcheckEndpoint,
    rdcwClientId,
    rdcwClientSecret,
    rdcwEndpoint,
    xephtApiKey,
    xephtEndpoint,
    tenantOwnedSlipApi: slipApiMode === 'own' && Boolean(req.tenantShop),
    customSlipEndpoint,
    customSlipApiKey,
    topupWebhookUrl: (req.body.topupWebhookUrl !== undefined ? req.body.topupWebhookUrl : (payment.topupWebhookUrl || '')).trim()
  });

  const effectiveAfterProviderSave = effectiveSlipConfig(payment, store.platformData.settings.payment, Boolean(req.tenantShop));
  const receiverProviderToActivate = req.tenantShop && slipApiMode === 'shared'
    ? effectiveAfterProviderSave.slipProvider
    : slipProvider;
  const savedReceiverProfile = payment.receiverProfiles && payment.receiverProfiles[receiverProviderToActivate];
  if (savedReceiverProfile) {
    receiverProfiles.saveAndActivate(payment, receiverProviderToActivate, savedReceiverProfile);
    payment.slipProvider = slipProvider;
  }

  await store.save();
  req.flash('success', 'บันทึกการตั้งค่าระบบตรวจสอบสลิปด้วย API เรียบร้อยแล้ว');
  res.redirect('/admin/slip-verification');
});

router.post('/slip-verification/test', async (req, res) => {
  const provider = (req.body.provider || '').toLowerCase();
  const apiKey = (req.body.apiKey || '').trim();
  const endpoint = (req.body.endpoint || '').trim();
  const branchId = (req.body.branchId || '').trim();
  const clientId = (req.body.clientId || '').trim();
  const clientSecret = (req.body.clientSecret || '').trim();

  try {
    if (provider === 'slipok') {
      if (!branchId || !apiKey) return res.json({ ok: false, message: 'กรุณากรอก Branch ID และ API Key ก่อนทดสอบ' });
      const result = await slipok.testConnection({ branchId, apiKey });
      return res.json(result);
    }

    if (provider === 'slipcheck') {
      const independent = req.body.independent === true || req.body.independent === 'true' || req.body.independent === 'on';
      const keys = slipcheck.resolveApiKeys(apiKey, req.body.apiKeys, independent ? 50 : 5);
      return res.json(await slipcheck.getPoolAccountInfo(keys, endpoint || slipcheck.DEFAULT_ENDPOINT, { independent }));
    }

    if (provider === 'rdcw') {
      return res.json(rdcwSlip.validateCredentials(clientId, clientSecret));
    }

    if (provider === 'slip2go') {
      if (!apiKey) return res.json({ ok: false, message: 'กรุณากรอก Slip2Go API Key ก่อนทดสอบ' });
      const result = await slip2go.checkBalance(apiKey, endpoint || slip2go.DEFAULT_ENDPOINT);
      return res.json(result);
    }

    if (provider === 'xepht') {
      return res.json(xephtSlip.validateCredentials(apiKey, endpoint || xephtSlip.DEFAULT_ENDPOINT));
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
    { name: 'bankQrImage', maxCount: 1 },
  ])(req, res, store.bindTenantContext(async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูป QR ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/topups');
    }
    const { bankAccountNumber, bankAccountName } = req.body;
    const bankCode = (req.body.bankCode || '').trim();
    const bankAccountNameEn = (req.body.bankAccountNameEn || '').trim();
    const bankAccountType = req.body.bankAccountType === 'JURISTIC' ? 'JURISTIC' : 'NATURAL';

    const payment = store.data.settings.payment;
    const primaryBank = banks.find(b => b.code === bankCode);
    const truemoneyPhone = (req.body.truemoneyPhone || '').trim().replace(/[^0-9]/g, '');
    const truemoneyEnabled = req.body.truemoneyEnabled === 'on';
    const effectiveBeforeSave = effectiveSlipConfig(payment, store.platformData.settings.payment, Boolean(req.tenantShop));
    const currentlySelectedProvider = receiverProfiles.PROVIDERS.includes(payment.slipProvider) ? payment.slipProvider : 'slipcheck';
    const submittedReceiverProvider = String(req.body.receiverProvider || '').toLowerCase();
    const sharedTenant = Boolean(req.tenantShop && (payment.slipApiMode || 'shared') === 'shared');
    if (sharedTenant && submittedReceiverProvider && submittedReceiverProvider !== effectiveBeforeSave.slipProvider) {
      req.flash('error', 'ร้านนี้ใช้ระบบกลาง กรุณาตั้งค่าบัญชีรับเงินให้ตรงกับค่ายกลางที่เว็บหลักเลือก');
      return res.redirect(`/admin/topups?tab=bank&receiverProvider=${effectiveBeforeSave.slipProvider}`);
    }
    const slipProvider = sharedTenant
      ? effectiveBeforeSave.slipProvider
      : (receiverProfiles.PROVIDERS.includes(submittedReceiverProvider) ? submittedReceiverProvider : currentlySelectedProvider);
    if (!receiverProfiles.PROVIDERS.includes(slipProvider)) {
      req.flash('error', 'กรุณาเลือกค่ายตรวจสลิปที่รองรับ');
      return res.redirect('/admin/topups?tab=bank');
    }
    receiverProfiles.save(payment, currentlySelectedProvider, receiverProfiles.snapshot(payment));
    const selectedProfile = receiverProfiles.view(payment, slipProvider);
    payment.bankQrImage = selectedProfile.bankQrImage;
    if (!['none', 'slipok', 'slipcheck', 'rdcw', 'slip2go', 'xepht'].includes(slipProvider)) {
      req.flash('error', 'ผู้ให้บริการตรวจสลิปนี้ยังไม่พร้อมใช้งาน');
      return res.redirect('/admin/topups');
    }
    const slipokBranchId = (req.body.slipokBranchId !== undefined ? req.body.slipokBranchId : (payment.slipokBranchId || '')).trim();
    const slipokApiKey = (req.body.slipokApiKey !== undefined ? req.body.slipokApiKey : (payment.slipokApiKey || '')).trim();
    const slip2goApiKey = (req.body.slip2goApiKey !== undefined ? req.body.slip2goApiKey : (payment.slip2goApiKey || '')).trim();
    const slip2goEndpoint = (req.body.slip2goEndpoint !== undefined ? req.body.slip2goEndpoint : (payment.slip2goEndpoint || slip2go.DEFAULT_ENDPOINT)).trim();
    const slipcheckApiKey = (req.body.slipcheckApiKey !== undefined ? req.body.slipcheckApiKey : (payment.slipcheckApiKey || '')).trim();
    const slipcheckEndpoint = (req.body.slipcheckEndpoint !== undefined ? req.body.slipcheckEndpoint : (payment.slipcheckEndpoint || slipcheck.DEFAULT_ENDPOINT)).trim();
    const rdcwClientId = (req.body.rdcwClientId !== undefined ? req.body.rdcwClientId : (payment.rdcwClientId || '')).trim();
    const rdcwClientSecret = (req.body.rdcwClientSecret !== undefined ? req.body.rdcwClientSecret : (payment.rdcwClientSecret || '')).trim();
    const rdcwEndpoint = (req.body.rdcwEndpoint !== undefined ? req.body.rdcwEndpoint : (payment.rdcwEndpoint || rdcwSlip.DEFAULT_ENDPOINT)).trim();
    const xephtApiKey = (req.body.xephtApiKey !== undefined ? req.body.xephtApiKey : (payment.xephtApiKey || '')).trim();
    const xephtEndpoint = (req.body.xephtEndpoint !== undefined ? req.body.xephtEndpoint : (payment.xephtEndpoint || xephtSlip.DEFAULT_ENDPOINT)).trim();
    const xephtValidation = xephtSlip.validateCredentials(xephtApiKey, xephtEndpoint);
    if (!xephtValidation.ok) {
      req.flash('error', xephtValidation.message);
      return res.redirect('/admin/topups?tab=bank');
    }
    const customSlipEndpoint = (req.body.customSlipEndpoint !== undefined ? req.body.customSlipEndpoint : (payment.customSlipEndpoint || '')).trim();
    const customSlipApiKey = (req.body.customSlipApiKey !== undefined ? req.body.customSlipApiKey : (payment.customSlipApiKey || '')).trim();

    Object.assign(payment, {
      bankAccountNumber, bankAccountName, bankAccountNameEn,
      bankAccountType,
      bankName: primaryBank ? primaryBank.nameTh : payment.bankName,
      truemoneyPhone, truemoneyEnabled,
      slipProvider, slipokBranchId, slipokApiKey,
      slip2goApiKey, slip2goEndpoint, customSlipEndpoint, customSlipApiKey,
      slipcheckApiKey, slipcheckEndpoint,
      rdcwClientId, rdcwClientSecret, rdcwEndpoint,
      xephtApiKey, xephtEndpoint,
      tenantOwnedSlipApi: payment.slipApiMode === 'own' && Boolean(req.tenantShop),
      topupWebhookUrl: (req.body.topupWebhookUrl || '').trim(),
    });
    if (!sharedTenant) payment.slipProvider = slipProvider;
    // Refresh the selected provider snapshot after applying the submitted
    // account fields. Saving the snapshot before Object.assign left SlipCheck
    // comparing against the previous account name/number after a bank change.
    receiverProfiles.save(payment, slipProvider, receiverProfiles.snapshot(payment));

    if (req.body.removeBankQrImage === 'on') store.data.settings.payment.bankQrImage = null;
    try {
      const bankFile = req.files && req.files.bankQrImage && req.files.bankQrImage[0];
      const directBank = firstDirectUpload(req.body, 'bankQrImage');
      if (directBank) store.data.settings.payment.bankQrImage = directBank;
      if (bankFile) {
        store.data.settings.payment.bankQrImage = await store.saveMedia(bankFile.buffer, bankFile.originalname, bankFile.mimetype);
      }
    } catch (saveError) {
      req.flash('error', 'บันทึกรูป QR ไม่สำเร็จ กรุณาลองใหม่');
      return res.redirect('/admin/topups');
    }

    receiverProfiles.saveAndActivate(payment, slipProvider, receiverProfiles.snapshot(payment));
    if (sharedTenant) payment.slipProvider = currentlySelectedProvider;

    await store.save();
    req.flash('success', `บันทึกข้อมูลบัญชีรับเงินสำหรับ ${slipProvider === 'slipcheck' ? 'SlipCheck' : slipProvider === 'rdcw' ? 'SlipRDCW' : slipProvider === 'slip2go' ? 'Slip2Go' : slipProvider === 'xepht' ? 'Slip XEPHT' : 'SlipOK'} แล้ว`);
    res.redirect(`/admin/topups?tab=bank&receiverProvider=${slipProvider}`);
  }));
});

router.post('/topups/:id/approve', async (req, res) => {
  const result = await topupsService.approveTopup(req.params.id);
  if (!result.ok) { req.flash('error', result.error); return res.redirect('/admin/topups'); }
  req.flash('success', `อนุมัติคำขอเติมเงิน ${result.request.amount.toLocaleString()} บาท ให้ ${result.user.username} แล้ว`);
  res.redirect('/admin/topups');
});

router.post('/topups/:id/reject', async (req, res) => {
  const result = await topupsService.rejectTopup(req.params.id, req.body.reviewNote);
  if (!result.ok) { req.flash('error', result.error); return res.redirect('/admin/topups'); }
  req.flash('success', 'ปฏิเสธคำขอเติมเงินแล้ว');
  res.redirect('/admin/topups');
});

router.post('/topups/:id/retry-slip', async (req, res) => {
  const accountRoutes = require('./account');
  const result = await accountRoutes.retryTopupSlipVerification({
    requestId: req.params.id,
    origin: `${req.protocol}://${req.get('host')}`,
  });
  req.flash(result.ok ? 'success' : 'error', result.ok ? 'ตรวจสลิปใหม่ด้วยชุด API Key ปัจจุบันแล้ว' : result.error);
  res.redirect('/admin/topups');
});

router.post('/topups/:id/delete', async (req, res) => {
  const result = await topupsService.deleteTopup(req.params.id);
  if (!result.ok) { req.flash('error', result.error); return res.redirect('/admin/topups'); }
  req.flash('success', `ลบคำขอเติมเงิน #${result.request.refCode || result.request.id} แล้ว โดยไม่กระทบบัญชีและยอดเงินลูกค้า`);
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
    let image = firstDirectUpload(req.body, 'image') || null;
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
    const directImage = firstDirectUpload(req.body || {}, 'image');
    if (err || (!req.file && !directImage) || !prize) {
      req.flash('error', 'อัปโหลดรูปไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/minigame');
    }
    try {
      prize.image = directImage || await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
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
    claimCode: null,
    isPreview: true,
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

// ---------- Announcements ----------
router.get('/announcements', (req, res) => {
  res.render('admin/announcements', { title: 'ประกาศ', active: 'announcements', announcements: store.data.announcements });
});

router.post('/announcements', async (req, res) => {
  store.data.announcements.push({
    id: store.genId(8), title: req.body.title, body: req.body.body,
    active: true, createdAt: new Date().toISOString(),
  });
  await store.save();
  req.flash('success', 'เพิ่มประกาศแล้ว');
  res.redirect('/admin/announcements');
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

// ---------- Welcome Popup (separate from the plain text announcement bars above) ----------
router.get('/welcome-popup', (req, res) => {
  res.render('admin/welcome-popup', { title: 'ป๊อปอัปต้อนรับ', active: 'welcome-popup' });
});

router.post('/filter-tags/heading', async (req, res) => {
  const heading = String(req.body.filterHeading || '').trim();
  if (!heading) req.flash('error', 'กรุณากรอกหัวข้อตัวกรอง');
  else { store.data.settings.filterHeading = heading.slice(0, 100); await store.save(); req.flash('success', 'บันทึกหัวข้อตัวกรองแล้ว'); }
  res.redirect('/admin/filter-tags');
});

router.post('/welcome-popup', (req, res) => {
  popupImageUpload.array('images', 20)(req, res, store.bindTenantContext(async (err) => {
    if (err) {
      req.flash('error', 'อัปโหลดรูปไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 8MB ต่อรูป)');
      return res.redirect('/admin/welcome-popup');
    }
    try {
      const existing = (store.data.settings.welcomePopup && store.data.settings.welcomePopup.images) || [];
      const removed = new Set(Array.isArray(req.body.removeImages) ? req.body.removeImages : (req.body.removeImages ? [req.body.removeImages] : []));
      const kept = existing.filter(image => !removed.has(image));
      const uploaded = [...directUploadUrls(req.body, 'images'), ...unwrapUploadResults(await persistUploadedFiles(req.files || []))];
      store.data.settings.welcomePopup = {
        enabled: req.body.enabled === 'on',
        showTitle: req.body.showTitle === 'on',
        showContent: req.body.showContent === 'on',
        title: (req.body.title || '').trim(),
        content: (req.body.content || '').trim(),
        images: [...kept, ...uploaded],
      };
      await store.save();
      req.flash('success', 'บันทึกป๊อปอัพต้อนรับแล้ว');
    } catch (saveError) {
      req.flash('error', 'บันทึกไม่สำเร็จ: ' + (saveError.message || String(saveError)));
    }
    res.redirect('/admin/welcome-popup');
  }));
});

// ---------- Settings ----------
router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'ตั้งค่าร้าน', active: 'settings', licenseEnabled: license.isGateOn() });
});

router.get('/effects', (req, res) => {
  res.render('admin/effects', { title: 'ลูกเล่นหน้าเว็บ', active: 'effects' });
});

router.get('/appearance', (req, res) => {
  res.render('admin/appearance', {
    title: 'รูปหน้าเว็บและโลโก้', active: 'appearance',
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
    showOpenHoursBar: req.body.showOpenHoursBar === 'on',
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
    return res.redirect('/admin/effects');
  }
  if (enabled && !extractYouTubeVideoId(youtubeUrl)) {
    req.flash('error', 'ลิงก์นี้ไม่ใช่วิดีโอ YouTube ที่รองรับ กรุณาใช้ลิงก์วิดีโอแบบ watch, youtu.be, Shorts หรือ Live (ไม่รองรับลิงก์ Playlist อย่างเดียว)');
    return res.redirect('/admin/effects');
  }
  if (endSeconds > 0 && endSeconds <= startSeconds) {
    req.flash('error', 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น');
    return res.redirect('/admin/effects');
  }

  store.data.settings.music = { enabled, youtubeUrl, defaultVolume, startSeconds, endSeconds };
  await store.save();
  req.flash('success', 'บันทึกการตั้งค่าเพลงหน้าเว็บแล้ว');
  res.redirect('/admin/effects');
});

// ---------- Snow effect ----------
router.post('/snow-toggle', async (req, res) => {
  store.data.settings.snow = { enabled: req.body.enabled === 'on' };
  await store.save();
  req.flash('success', store.data.settings.snow.enabled ? 'เปิดใช้งานหิมะตกแล้ว' : 'ปิดใช้งานหิมะตกแล้ว');
  res.redirect('/admin/effects');
});

// ---------- Hero banner ----------
router.post('/site-logo/upload', (req, res) => {
  logoUpload.single('logoImage')(req, res, store.bindTenantContext(async (err) => {
    const directImage = firstDirectUpload(req.body || {}, 'logoImage');
    if (err || (!req.file && !directImage)) {
      req.flash('error', 'อัปโหลดโลโก้ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 4MB)');
      return res.redirect('/admin/appearance');
    }
    try {
      store.data.settings.branding.logoImage = directImage || await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
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
    const directImage = firstDirectUpload(req.body || {}, 'bannerImage');
    if (err || (!req.file && !directImage)) {
      req.flash('error', 'อัปโหลดแบนเนอร์ไม่สำเร็จ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 10MB)');
      return res.redirect('/admin/appearance');
    }
    try {
      store.data.settings.hero.bannerImage = directImage || await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      await store.save();
      req.flash('success', 'อัปโหลดแบนเนอร์แล้ว และจะไม่หายเมื่อ Deploy');
    } catch (saveError) {
      req.flash('error', 'บันทึกแบนเนอร์ไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/appearance');
  }));
});

router.post('/auth-background/upload', (req, res) => {
  bannerUpload.single('authBackgroundImage')(req, res, store.bindTenantContext(async (err) => {
    const directImage = firstDirectUpload(req.body || {}, 'authBackgroundImage');
    if (err || (!req.file && !directImage)) {
      req.flash('error', 'อัปโหลดพื้นหลังหน้าเข้าสู่ระบบไม่สำเร็จ (รองรับไฟล์รูปภาพไม่เกิน 10MB)');
      return res.redirect('/admin/appearance');
    }
    try {
      store.data.settings.authAppearance = store.data.settings.authAppearance || {};
      store.data.settings.authAppearance.backgroundImage = directImage || await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      await store.save();
      req.flash('success', 'บันทึกพื้นหลังหน้าเข้าสู่ระบบและสมัครสมาชิกแล้ว');
    } catch (saveError) {
      req.flash('error', 'บันทึกภาพพื้นหลังไม่สำเร็จ กรุณาลองใหม่');
    }
    res.redirect('/admin/appearance');
  }));
});

router.post('/storefront-background/upload', (req, res) => {
  bannerUpload.single('storefrontBackgroundImage')(req, res, store.bindTenantContext(async (err) => {
    const directImage = firstDirectUpload(req.body || {}, 'storefrontBackgroundImage');
    if (err || (!req.file && !directImage)) { req.flash('error', 'อัปโหลดพื้นหลังหน้าร้านไม่สำเร็จ (รองรับไฟล์รูปภาพไม่เกิน 10MB)'); return res.redirect('/admin/appearance'); }
    try {
      store.data.settings.storefrontAppearance = store.data.settings.storefrontAppearance || {};
      store.data.settings.storefrontAppearance.backgroundImage = directImage || await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      await store.save(); req.flash('success', 'บันทึกภาพพื้นหลังหน้าร้านแล้ว ภาพจะแสดงเต็มโดยไม่ครอป');
    } catch (saveError) { req.flash('error', 'บันทึกภาพพื้นหลังหน้าร้านไม่สำเร็จ กรุณาลองใหม่'); }
    res.redirect('/admin/appearance');
  }));
});

router.post('/storefront-background/remove', async (req, res) => {
  store.data.settings.storefrontAppearance = store.data.settings.storefrontAppearance || {};
  store.data.settings.storefrontAppearance.backgroundImage = null;
  await store.save(); req.flash('success', 'นำภาพพื้นหลังหน้าร้านออกแล้ว'); res.redirect('/admin/appearance');
});

router.post('/auth-background/remove', async (req, res) => {
  store.data.settings.authAppearance = store.data.settings.authAppearance || {};
  store.data.settings.authAppearance.backgroundImage = null;
  await store.save();
  req.flash('success', 'นำพื้นหลังเฉพาะหน้าเข้าสู่ระบบออกแล้ว ระบบจะใช้แบนเนอร์ร้านแทน');
  res.redirect('/admin/appearance');
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

router.post('/hero-text-style', async (req, res) => {
  const normalizeHex = (value, fallback) => {
    const color = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
  };
  const requestedWidth = Number.parseFloat(req.body.outlineWidth);
  const outlineWidth = Number.isFinite(requestedWidth)
    ? Math.round(Math.max(0, Math.min(4, requestedWidth)) * 4) / 4
    : 1.5;

  store.data.settings.hero ||= { mode: 'default', bannerImage: null, bannerLink: '' };
  store.data.settings.hero.textStyle = {
    textColor: normalizeHex(req.body.textColor, '#ffffff'),
    outlineColor: normalizeHex(req.body.outlineColor, '#000000'),
    outlineWidth,
  };
  await store.save();
  req.flash('success', 'บันทึกสีและขอบข้อความหน้าหลักแล้ว');
  res.redirect('/admin/appearance#hero-text-style');
});

// ---------- API Providers (Redirected to Unified Slip Verification Hub) ----------
router.get('/api-providers', (req, res) => res.redirect('/admin/slip-verification'));
router.post('/api-providers/custom', (req, res) => res.redirect('/admin/slip-verification'));

module.exports = router;
