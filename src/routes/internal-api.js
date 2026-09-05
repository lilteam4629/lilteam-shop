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
const { getShopUrl, MAIN_SITE_URL } = require('../middleware/tenant');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype) && file.mimetype !== 'image/svg+xml'),
});

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

// ---------- Plans ----------
router.get('/plans', (req, res) => {
  const plans = store.data.licensePlans.filter(provisioning.isPlanAvailable).sort((a, b) => a.days - b.days);
  res.json({ ok: true, plans });
});

// ---------- Shops ----------
router.post('/shops', async (req, res) => {
  const user = findUserById(req.body.userId);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });

  const result = await provisioning.provisionShop({
    user,
    planId: req.body.planId,
    shopName: req.body.shopName,
    adminUsername: req.body.adminUsername,
    adminPassword: req.body.adminPassword,
    recaptchaResponse: req.body.recaptchaResponse,
    ip: req.ip,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, ...result });
});

router.get('/shops', (req, res) => {
  const user = findUserById(req.query.userId);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  const shops = store.data.shops
    .filter(s => s.ownerId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(s => ({ ...s, url: getShopUrl(s.slug) }));
  res.json({ ok: true, shops });
});

router.post('/shops/:id/renew', async (req, res) => {
  const user = findUserById(req.body.userId);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  const result = await provisioning.renewShop({ user, shopId: req.params.id, planId: req.body.planId });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, shop: result.shop });
});

// ---------- Wallet / topup ----------
router.get('/wallet/topups', (req, res) => {
  const user = findUserById(req.query.userId);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  const topups = store.data.topupRequests
    .filter(t => t.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  res.json({ ok: true, topups, walletBalance: user.walletBalance });
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
      return res.json({ ok: true, request: created.request });
    }

    const attached = await accountRoutes.attachSlipToTopupRequest({
      requestId: created.request.id,
      user,
      fileBuffer: req.file.buffer,
      fileOptions: { filename: req.file.originalname, contentType: req.file.mimetype },
      origin: MAIN_SITE_URL || '',
    });
    if (!attached.ok) return res.status(400).json({ error: attached.error, request: created.request });
    res.json({ ok: true, request: attached.request });
  });
});

module.exports = router;
