// JSON API for the separate rent-app (its own codebase/deploy) to drive
// the "buy a plan -> real shop" funnel WITHOUT ever touching MongoDB
// itself. This is the only door the rent-app has into this app's data —
// every operation here reuses the exact same in-process logic the main
// site's own /start, /my-shops, /login, /register, /account/topup already
// use (store.js, shop-provisioning.js), so store.save()'s full-document
// replace and the existing per-user locks behave exactly as they always
// have. The rent-app never sees a Mongo connection string.
//
// Trust model: the browser never calls these routes directly. The
// rent-app's own backend calls them server-to-server, attaching
// X-Internal-Secret (proves the caller IS the legitimate rent-app) and an
// explicit userId (safe to trust here because the browser has no way to
// set that header itself — it only ever talks to the rent-app, which only
// sets userId from its own session after a real password check).
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const store = require('../data/store');
const recaptcha = require('../services/recaptcha');
const provisioning = require('../services/shop-provisioning');
const accountRoutes = require('./account');
const topupsService = require('../services/topups');
const truemoney = require('../services/truemoney');
const webhook = require('../services/webhook');
const discordBot = require('../services/discord-bot');
const licensePlansService = require('../services/license-plans');
const r2 = require('../services/r2');
const { getShopUrl, MAIN_SITE_URL } = require('../middleware/tenant');
const { publicTopupRequest } = require('../services/public-slip');
const catalogSyndication = require('../services/catalog-syndication');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype) && file.mimetype !== 'image/svg+xml'),
});
const truemoneyRedemptionLocks = new Set();

router.use(express.json());

router.use((req, res, next) => {
  const secret = process.env.INTERNAL_API_SECRET || '';
  if (!secret) {
    // Fails closed: an unconfigured secret means this API is not meant to
    // be reachable at all yet, not "open to anyone".
    return res.status(503).json({ error: 'internal API not configured' });
  }
  if (req.get('X-Internal-Secret') !== secret) {
    return res.status(403).json({ error: 'forbidden' });
  }
  // Defense in depth: this router must only ever run against the MAIN
  // site's own data. If tenantResolver (src/middleware/tenant.js) somehow
  // matched this request to a tenant shop's subdomain — e.g. MAIN_API_BASE_URL
  // was misconfigured to a public *.{MAIN_DOMAIN} host instead of the
  // internal docker hostname — refuse rather than silently operating on
  // the wrong shop's database.
  if (req.tenantShop) {
    return res.status(400).json({ error: 'internal API must be called on the main site, not a tenant subdomain' });
  }
  next();
});

router.use(require('./cloud-management-api'));

router.post('/media/direct-upload', async (req, res) => {
  try { res.json({ ok: true, ...(await r2.createDirectUpload(req.body.filename, req.body.contentType)) }); }
  catch (error) { res.status(400).json({ ok: false, error: error.message }); }
});

router.post('/slips/claim', async (req, res, next) => {
  try {
    const transRef = String(req.body.transRef || '').trim();
    if (!transRef) return res.status(400).json({ error: 'ไม่พบเลขอ้างอิงสลิป' });
    const claimed = await store.claimGlobalSlipRef(transRef, {
      source: req.body.source || 'shop-cloud', requestId: req.body.requestId,
    });
    res.status(claimed ? 200 : 409).json({ ok: claimed, duplicate: !claimed });
  } catch (error) { next(error); }
});

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email, walletBalance: user.walletBalance };
}

function findUserById(userId) {
  return store.data.users.find(u => u.id === userId && u.status !== 'banned') || null;
}

// ---------- Auth ----------
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const usernameLower = String(username || '').trim().toLowerCase();
  const user = store.data.users.find(u =>
    (u.username || '').toLowerCase() === usernameLower || (u.email || '').toLowerCase() === usernameLower);
  const isValid = user && (await bcrypt.compare(password || '', user.passwordHash));
  if (!isValid) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  if (user.status === 'banned') return res.status(403).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน' });
  res.json({ ok: true, user: publicUser(user) });
});

router.post('/auth/register', async (req, res) => {
  const { username, email, password, recaptchaResponse } = req.body || {};
  const cleanUsername = String(username || '').trim();
  const cleanEmail = String(email || '').trim();
  if (!cleanUsername || !cleanEmail || !password) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }
  if (!(await recaptcha.verify(recaptchaResponse, req.ip))) {
    return res.status(400).json({ error: 'กรุณายืนยันแคปช่าให้ถูกต้อง' });
  }
  if (store.data.users.some(u => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
  }
  if (store.data.users.some(u => u.email.toLowerCase() === cleanEmail.toLowerCase())) {
    return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: store.genId(8), username: cleanUsername, email: cleanEmail, passwordHash,
    role: 'customer', walletBalance: 0, status: 'active', createdAt: new Date().toISOString(),
  };
  store.data.users.push(user);
  await store.save();
  res.json({ ok: true, user: publicUser(user) });
});

router.get('/me', (req, res) => {
  const user = findUserById(req.query.userId);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, user: publicUser(user), recaptchaSiteKey: recaptcha.siteKey() });
});

// Public (no userId needed) — e.g. the rent-app's own /register page needs
// the recaptcha site key before anyone has logged in.
router.get('/config', (req, res) => {
  res.json({ ok: true, recaptchaSiteKey: recaptcha.siteKey() });
});

router.post('/captcha/verify', async (req, res) => {
  const valid = await recaptcha.verify(req.body && req.body.token, req.body && req.body.remoteip);
  res.status(valid ? 200 : 400).json({ ok: valid, error: valid ? undefined : 'กรุณายืนยันแคปช่าให้ถูกต้อง' });
});

// ---------- Plans ----------
router.get('/plans', (req, res) => {
  const plans = store.data.licensePlans.filter(provisioning.isPlanAvailable).sort((a, b) => a.days - b.days);
  res.json({ ok: true, plans });
});

// ---------- Shops ----------
router.post('/shops', async (req, res) => {
  const external = req.body.cloudUser;
  const user = external && external.id ? { id: String(external.id), username: String(external.username || ''), email: String(external.email || ''), walletBalance: 0 } : findUserById(req.body.userId);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });

  const result = await provisioning.provisionShop({
    user,
    planId: req.body.planId,
    shopName: req.body.shopName,
    adminUsername: req.body.adminUsername,
    adminPassword: req.body.adminPassword,
    recaptchaResponse: req.body.recaptchaResponse,
    ip: req.ip, skipWallet: Boolean(external),
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, ...result });
});

router.get('/shops', (req, res) => {
  const user = req.query.cloudUserId ? { id: String(req.query.cloudUserId) } : findUserById(req.query.userId);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  const shops = store.data.shops
    .filter(s => s.ownerId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(s => ({ ...s, url: getShopUrl(s.slug) }));
  res.json({ ok: true, shops });
});

router.post('/shops/:id/renew', async (req, res) => {
  const external = req.body.cloudUser;
  const user = external && external.id ? { id: String(external.id), username: String(external.username || ''), email: String(external.email || ''), walletBalance: 0 } : findUserById(req.body.userId);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  const result = await provisioning.renewShop({ user, shopId: req.params.id, planId: req.body.planId, skipWallet: Boolean(external) });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, shop: result.shop });
});


// ---------- Central catalog API ----------
// Returns public product metadata only. Never include stock credentials,
// internal notes, or order history in this response.
router.get('/catalog/products', (req, res) => {
  const requestedShopId = String(req.query.shopId || '').trim();
  let tenantDb = null;
  if (requestedShopId) {
    const shop = store.data.shops.find(item => String(item.id) === requestedShopId);
    if (!shop) return res.status(404).json({ error: 'shop_not_found' });
    return store.loadTenantDb(shop.id).then(db => {
      const result = catalogSyndication.getTenantProducts(store.platformData, db, MAIN_SITE_URL, shop);
      res.json({ ok: true, source: 'main-store', shopId: shop.id, config: result.config, products: result.products });
    });
  }
  const config = { enabled: true, source: 'main-store', markupMode: 'percent', markupValue: 0 };
  const products = store.platformData.products.filter(product => product.status === 'active').map(product => ({
    id: String(product.id), slug: product.slug, title: product.title, price: Number(product.price) || 0,
    originalPrice: Number(product.originalPrice) || 0, images: Array.isArray(product.images) ? product.images.slice(0, 3) : [],
    description: product.description || '', status: product.status,
    availableStock: store.platformData.stockItems.filter(item => item.productId === product.id && item.status === 'available').length,
  }));
  res.json({ ok: true, source: 'main-store', shopName: store.platformData.settings.shopName, products });
});

router.get('/catalog/shops', async (req, res) => {
  const shops = await Promise.all((store.data.shops || []).map(async shop => {
    const db = await store.loadTenantDb(shop.id);
    const config = catalogSyndication.normalizeConfig(db?.settings || {});
    return { id: shop.id, name: shop.name, slug: shop.slug, expiresAt: shop.expiresAt, catalogApi: config };
  }));
  res.json({ ok: true, shops });
});

// ---------- Wallet / topup ----------
router.get('/wallet/topups', (req, res) => {
  const user = findUserById(req.query.userId);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  const topups = store.data.topupRequests
    .filter(t => t.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  res.json({ ok: true, topups: topups.map(publicTopupRequest), walletBalance: user.walletBalance });
});

router.post('/wallet/topup', (req, res) => {
  // multer needs to run before we can read req.body.userId (multipart),
  // so the user lookup happens inside the callback.
  upload.single('slip')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'อัปโหลดสลิปไม่สำเร็จ (รองรับไฟล์รูปภาพ ขนาดไม่เกิน 5MB)' });
    const user = findUserById(req.body.userId);
    if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });

    const created = await accountRoutes.createTopupRequest({ user, amount: req.body.amount, method: req.body.method });
    if (!created.ok) return res.status(400).json({ error: created.error });

    if (!req.file) {
      // Amount-only request (e.g. bank transfer) — the rent-app can let
      // the customer come back and attach a slip later via the same
      // endpoint using this request's id.
      return res.json({ ok: true, request: publicTopupRequest(created.request) });
    }

    const attached = await accountRoutes.attachSlipToTopupRequest({
      requestId: created.request.id,
      user,
      fileBuffer: req.file.buffer,
      fileOptions: { filename: req.file.originalname, contentType: req.file.mimetype },
      origin: MAIN_SITE_URL || '',
    });
    if (!attached.ok) return res.status(400).json({ error: attached.error, request: created.request });
    res.json({ ok: true, request: publicTopupRequest(attached.request) });
  });
});

router.get('/wallet/topups/:id', (req, res) => {
  const user = findUserById(req.query.userId);
  const request = user && store.data.topupRequests.find(t => t.id === req.params.id && t.userId === user.id);
  if (!request) return res.status(404).json({ error: 'ไม่พบคำขอเติมเงิน' });
  const payment = store.data.settings.payment || {};
  res.json({ ok: true, request: publicTopupRequest(request), payment: {
    bankName: payment.bankName || '',
    bankAccountNumber: payment.bankAccountNumber || '', bankAccountName: payment.bankAccountName || '',
    bankQrImage: payment.bankQrImage || null,
  }, automaticSlipCheck: payment.slipProvider !== 'none' });
});

router.get('/wallet/topups/:id/slip', async (req, res, next) => {
  try {
    const user = findUserById(req.query.userId);
    const request = user && store.data.topupRequests.find(t => t.id === req.params.id && t.userId === user.id);
    if (!request || !request.slipStorageId) return res.sendStatus(404);
    const media = await store.getPrivateMedia(request.slipStorageId);
    if (!media) return res.sendStatus(404);
    res.setHeader('Content-Type', media.file.metadata?.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    media.stream.on('error', next).pipe(res);
  } catch (error) { next(error); }
});

router.post('/wallet/topups/:id/slip', (req, res) => {
  upload.single('slip')(req, res, async (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์รูปสลิปขนาดไม่เกิน 5MB' });
    const user = findUserById(req.body.userId);
    if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
    const result = await accountRoutes.attachSlipToTopupRequest({ requestId: req.params.id, user,
      fileBuffer: req.file.buffer, fileOptions: { filename: req.file.originalname, contentType: req.file.mimetype },
      origin: MAIN_SITE_URL || '' });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, request: publicTopupRequest(result.request) });
  });
});

router.post('/wallet/truemoney', async (req, res) => {
  const user = findUserById(req.body.userId);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  const payment = store.data.settings.payment || {};
  if (!payment.truemoneyEnabled) return res.status(400).json({ error: 'ระบบเติมเงินผ่านซองของขวัญ TrueMoney ปิดให้บริการชั่วคราว' });
  const receiverPhone = String(payment.truemoneyPhone || '').trim();
  if (!/^\d{10}$/.test(receiverPhone)) return res.status(400).json({ error: 'ทางร้านยังไม่ได้ตั้งค่าเบอร์รับเงิน TrueMoney' });
  const voucherInput = String(req.body.voucherLink || '').trim();
  const voucherCode = truemoney.extractVoucherCode(voucherInput);
  if (!voucherCode) return res.status(400).json({ error: 'กรุณากรอกลิงก์ซองของขวัญ TrueMoney ให้ถูกต้อง' });
  if (truemoneyRedemptionLocks.has(voucherCode)) return res.status(409).json({ error: 'ซองนี้กำลังตรวจสอบ กรุณารอสักครู่' });
  truemoneyRedemptionLocks.add(voucherCode);
  let providerAccepted = false;
  try {
    const reservation = await accountRoutes.reserveTrueMoneyClaim(voucherCode, user.id);
    if (!reservation) return res.status(409).json({ error: 'ซองของขวัญนี้ถูกใช้แล้วหรือกำลังตรวจสอบ' });
    if (reservation.alreadyCredited) return res.json({ ok: true, alreadyCredited: true, message: 'ซองของขวัญนี้เติมเงินเข้าเว็บแล้ว' });
    const result = reservation.retryExisting && reservation.amount > 0
      ? { success: true, recovered: true, amount: reservation.amount, senderName: reservation.senderName || '', message: 'กู้คืนรายการรับเงินสำเร็จ' }
      : await truemoney.redeemAngpao(voucherInput, receiverPhone);
    if (!result.success || !Number.isFinite(result.amount) || result.amount <= 0) {
      // Keep an already-redeemed claim recoverable when the provider does not
      // include the amount in its second response.
      if (result.code !== 'TARGET_USER_REDEEMED') {
        await accountRoutes.markTrueMoneyClaimFailed(voucherCode, user.id, result.message || '').catch(error => {
          console.error('[Cloud TrueMoney claim status]', error.message);
        });
      }
      return res.status(400).json({ error: result.message || 'ไม่สามารถรับเงินจากซองนี้ได้' });
    }
    providerAccepted = true;
    const credit = await accountRoutes.finalizeTrueMoneyClaim({ voucherCode, userId: user.id, result });
    if (credit.alreadyCredited) return res.json({ ok: true, alreadyCredited: true, message: 'ซองของขวัญนี้เติมเงินเข้าเว็บแล้ว' });
    const amount = Number(result.amount);
    const refCode = credit.refCode;
    const id = credit.id;
    // The wallet has already been credited. Run optional notifications after
    // scheduling them so a notifier/configuration failure can never change a
    // successful top-up into a 500 response from the rental API.
    Promise.resolve().then(() => webhook.notifyTopup({webhookUrl:payment.topupWebhookUrl,username:user.username,email:user.email,amount,refCode,method:'truemoney_angpao',slipUrl:null,autoApproved:true,adminUrl:null}))
      .catch(error => console.error('[Cloud TrueMoney webhook notify]', error.message));
    Promise.resolve().then(() => discordBot.notifyNewTopup({username:user.username,email:user.email,amount,refCode,method:'ซองของขวัญ TrueMoney'}))
      .catch(error => console.error('[Cloud TrueMoney Discord notify]', error.message));
    res.json({ok:true,requestId:id,amount,recovered:Boolean(result.recovered || reservation.retryExisting)});
  } catch (err) {
    console.error('[Cloud TrueMoney]', err);
    if (providerAccepted) {
      try {
        const claim = (store.data?.truemoneyRedemptions || []).find(item => item.voucherCode === voucherCode && item.userId === user.id);
        if (claim && Number(claim.amount) > 0) {
          const recovered = await accountRoutes.creditTrueMoneyClaim({
            voucherCode,
            userId: user.id,
            result: { amount: Number(claim.amount), senderName: claim.senderName || '', recovered: true },
          });
          if (recovered && (recovered.alreadyCredited || recovered.id)) {
            return res.json({ ok: true, requestId: recovered.id || claim.topupRequestId || null, amount: Number(claim.amount), recovered: true });
          }
        }
      } catch (recoveryError) {
        console.error('[Cloud TrueMoney recovery after error]', recoveryError);
      }
      // Keep the HTTP response successful once the external voucher was
      // accepted. The rent-app can refresh the wallet and retry the same link
      // without showing a misleading generic Internal Server Error.
      return res.json({ ok: true, pending: true, recoverable: true, message: 'รับซองสำเร็จแล้ว ระบบกำลังบันทึกยอด กรุณาลองลิงก์เดิมอีกครั้ง' });
    }
    res.status(500).json({error:'เกิดข้อผิดพลาดในการตรวจสอบซอง กรุณาลองใหม่'});
  }
  finally { truemoneyRedemptionLocks.delete(voucherCode); }
});

// ---------- Admin (rent-app's own /admin panel drives these) ----------
// These are more powerful than everything above — full plan CRUD, topup
// approve/reject, and a user directory — because rent-app's /admin is
// meant to become a full back-office for the shop-rental business. There
// is no separate admin-vs-customer distinction at this layer: whoever
// holds INTERNAL_API_SECRET is trusted completely, exactly like every
// other route in this file. rent-app's own ADMIN_USERNAME/ADMIN_PASSWORD
// login is what actually gates who can reach these — never expose them
// through anything the browser can call directly.
router.get('/admin/license-plans', (req, res) => {
  const plans = licensePlansService.listPlans().map(p => ({ ...p, available: provisioning.isPlanAvailable(p) }));
  res.json({ ok: true, plans });
});

router.post('/admin/license-plans', async (req, res) => {
  const result = await licensePlansService.createPlan(req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, plan: result.plan });
});

router.post('/admin/license-plans/:id', async (req, res) => {
  const result = await licensePlansService.editPlan(req.params.id, req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, plan: result.plan });
});

router.post('/admin/license-plans/:id/toggle', async (req, res) => {
  const result = await licensePlansService.togglePlan(req.params.id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, plan: result.plan });
});

router.post('/admin/license-plans/:id/delete', async (req, res) => {
  const result = await licensePlansService.deletePlan(req.params.id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

router.get('/admin/topups', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
  const q = String(req.query.q || '').trim().toLocaleLowerCase('th-TH');
  const requests = [...store.data.topupRequests]
    .map(t => {
      const buyer = store.data.users.find(u => u.id === t.userId);
      return { ...publicTopupRequest(t), buyerUsername: buyer ? buyer.username : null, buyerEmail: buyer ? buyer.email : null };
    })
    .filter(t => {
      if (status && t.status !== status) return false;
      if (!q) return true;
      return String(t.refCode || '').toLocaleLowerCase('th-TH').includes(q)
        || String(t.buyerUsername || '').toLocaleLowerCase('th-TH').includes(q)
        || String(t.buyerEmail || '').toLocaleLowerCase('th-TH').includes(q);
    })
    .sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .slice(0, 100);
  res.json({ ok: true, requests });
});

router.get('/admin/topups/:id/slip', async (req, res, next) => {
  try {
    const request = store.data.topupRequests.find(t => t.id === req.params.id);
    if (!request || !request.slipStorageId) return res.sendStatus(404);
    const media = await store.getPrivateMedia(request.slipStorageId);
    if (!media) return res.sendStatus(404);
    res.setHeader('Content-Type', media.file.metadata?.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', media.file.length);
    res.setHeader('Cache-Control', 'private, no-store');
    media.stream.on('error', next).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/topups/:id/approve', async (req, res) => {
  const result = await topupsService.approveTopup(req.params.id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, request: publicTopupRequest(result.request), user: publicUser(result.user) });
});

router.post('/admin/topups/:id/reject', async (req, res) => {
  const result = await topupsService.rejectTopup(req.params.id, req.body && req.body.reviewNote);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

router.get('/admin/users', (req, res) => {
  const q = String(req.query.q || '').trim().toLocaleLowerCase('th-TH');
  const users = store.data.users
    .filter(u => {
      if (!q) return true;
      return String(u.username || '').toLocaleLowerCase('th-TH').includes(q)
        || String(u.email || '').toLocaleLowerCase('th-TH').includes(q);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100)
    .map(u => ({
      id: u.id, username: u.username, email: u.email, walletBalance: u.walletBalance,
      status: u.status, role: u.role, createdAt: u.createdAt,
    }));
  res.json({ ok: true, users });
});

module.exports = router;
