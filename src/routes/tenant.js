// Multi-tenant SaaS: signing up creates a new shop that gets the SAME full
// app every other shop (and the seller's own site) runs — real products,
// stock, wallet, orders, coupons, minigame, appearance settings, all of it
// — because it's literally the same codebase, just pointed at that shop's
// own dataset (see src/middleware/tenant.js and src/data/store.js
// runInTenant/createTenantDb). No Railway, no GitHub, no per-customer
// deployment, and every existing route/view works unmodified for a shop's
// own subdomain.
//
// Paid like the old Railway-based system: buyer must be logged into the
// MAIN site, picks a plan (reusing the existing licensePlans — days +
// price), and pays from their wallet balance. Each shop's own expiresAt is
// checked by the tenant-resolver middleware itself (no license key, no env
// var — it's all in the same database now), which shows a lightweight
// "renew" page once it passes.
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const store = require('../data/store');
const { getMainDomain, getShopUrl, MAIN_DOMAIN } = require('../middleware/tenant');
const { requireLogin, currentUser } = require('../middleware/auth');
const recaptcha = require('../services/recaptcha');
const discordBot = require('../services/discord-bot');

// A promo plan disappears on its own once it expires or sells out — no
// admin cleanup needed. Non-promo plans are unaffected.
function isPlanAvailable(plan) {
  if (!plan.active) return false;
  if (!plan.promo) return true;
  if (plan.promoExpiresAt && Date.now() > plan.promoExpiresAt) return false;
  if (plan.promoLimit && (plan.promoUsedCount || 0) >= plan.promoLimit) return false;
  return true;
}

function slugify(str) {
  return String(str || '').toLowerCase().trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const RESERVED_SLUGS = new Set([
  'www', 'admin', 'administrator', 'api', 'app', 'mail', 'email', 'smtp',
  'pop', 'imap', 'ftp', 'ssh', 'cpanel', 'webmail', 'media', 'cdn',
  'static', 'assets', 'public', 'cart', 'account', 'login', 'register',
  'auth', 'start', 'shop', 'tenant', 'license', 'system', 'root', 'bot',
  'discord', 'webhook', 'easyslip', 'slipok', 'promptpay', 'preview', 'my-shops',
  'rent', 'rent-website',
]);

const tenantActionLocks = new Set();

router.get('/start', requireLogin, (req, res) => {
  const mainDomain = getMainDomain(req);
  const isLocal = mainDomain === 'localhost';
  const plans = store.data.licensePlans.filter(isPlanAvailable).sort((a, b) => a.days - b.days);
  res.render('tenant/start', {
    title: 'เปิดร้านของคุณเอง', layout: false,
    domainReady: true, mainDomain, isLocal, plans,
    preselectedPlanId: String(req.query.plan || ''),
    logoImage: store.data.settings.branding && store.data.settings.branding.logoImage,
    recaptchaSiteKey: recaptcha.siteKey(),
    messages: { error: req.flash('error') },
  });
});

router.post('/start', requireLogin, async (req, res) => {
  const user = currentUser(req);
  if (!user) {
    req.flash('error', 'กรุณาเข้าสู่ระบบก่อน');
    return res.redirect('/login');
  }

  if (tenantActionLocks.has(user.id)) {
    req.flash('error', 'ระบบกำลังดำเนินการรายการก่อนหน้า กรุณารอสักครู่');
    return res.redirect('/start');
  }

  tenantActionLocks.add(user.id);
  try {
    if (!(await recaptcha.verify(req.body['g-recaptcha-response'], req.ip))) {
      req.flash('error', 'กรุณายืนยันแคปช่าให้ถูกต้อง');
      return res.redirect('/start');
    }
    const plan = store.data.licensePlans.find(p => p.id === req.body.planId && isPlanAvailable(p));
    const shopName = String(req.body.shopName || '').trim();
    const adminUsername = String(req.body.adminUsername || '').trim();
    const adminPassword = String(req.body.adminPassword || '');

    if (!plan) {
      req.flash('error', 'กรุณาเลือกแพ็กเกจ');
      return res.redirect('/start');
    }
    if (!shopName) {
      req.flash('error', 'กรุณากรอกชื่อร้าน');
      return res.redirect('/start');
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(adminUsername)) {
      req.flash('error', 'ชื่อผู้ใช้แอดมินต้องเป็นตัวอักษร a-z, 0-9 และ _ เท่านั้น ยาว 3-20 ตัว');
      return res.redirect('/start');
    }
    if (adminPassword.length < 8) {
      req.flash('error', 'รหัสผ่านแอดมินต้องมีอย่างน้อย 8 ตัวอักษร');
      return res.redirect('/start');
    }
    if (user.walletBalance < plan.price) {
      req.flash('error', 'ยอดเครดิตไม่พอ กรุณาเติมเงินก่อน');
      return res.redirect('/start');
    }

    let slug = slugify(shopName) || 'shop';
    if (RESERVED_SLUGS.has(slug) || store.data.shops.some(s => (s.slug || '').toLowerCase() === slug.toLowerCase())) {
      slug = `${slug}-${store.genId(4).toLowerCase()}`;
    }
    slug = slug.toLowerCase();

    user.walletBalance -= plan.price;
    if (plan.promo) plan.promoUsedCount = (plan.promoUsedCount || 0) + 1;
    store.data.walletTransactions.push({
      id: store.genId(10), userId: user.id, type: 'shop_purchase', amount: -plan.price,
      note: `เปิดร้านใหม่ "${shopName}" (${plan.days} วัน)`, createdAt: new Date().toISOString(),
    });

    const shopId = store.genId(10);
    const expiresAt = Date.now() + plan.days * 24 * 60 * 60 * 1000;
    store.data.shops.push({
      id: shopId, slug, name: shopName, ownerId: user.id, ownerUsername: user.username,
      expiresAt, createdAt: new Date().toISOString(),
    });
    await store.save();

    try {
      const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
      await store.createTenantDb(shopId, {
        shopName, adminUsername, adminEmail: user.email || `${adminUsername}@${slug}.local`,
        adminPasswordHash,
      });
    } catch (err) {
      store.data.shops = store.data.shops.filter(s => s.id !== shopId);
      user.walletBalance += plan.price;
      if (plan.promo && plan.promoUsedCount > 0) {
        plan.promoUsedCount -= 1;
      }
      store.data.walletTransactions.push({
        id: store.genId(10), userId: user.id, type: 'shop_purchase_refund', amount: plan.price,
        note: `คืนเครดิต — เปิดร้าน "${shopName}" ไม่สำเร็จ`, createdAt: new Date().toISOString(),
      });
      await store.save();
      req.flash('error', 'สร้างร้านไม่สำเร็จ ลองใหม่อีกครั้ง (คืนเครดิตให้แล้ว)');
      return res.redirect('/start');
    }

    discordBot.notifyNewRental({
      shopName, ownerUsername: user.username, days: plan.days, price: plan.price, expiresAt,
    }).catch((err) => console.error('[discord-bot] notifyNewRental failed:', err));

    const targetUrl = getShopUrl(slug, req);
    req.flash('success', `เปิดร้าน "${shopName}" สำเร็จ! เข้าสู่ระบบด้วยชื่อผู้ใช้ ${adminUsername}`);
    res.redirect(`${targetUrl}/login`);
  } catch (err) {
    console.error('[start] error:', err);
    req.flash('error', 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    res.redirect('/start');
  } finally {
    tenantActionLocks.delete(user.id);
  }
});

// Buyer's own shops + renewal.
router.get('/my-shops', requireLogin, (req, res) => {
  const user = currentUser(req);
  const mainDomain = getMainDomain(req);
  const shops = store.data.shops
    .filter(s => s.ownerId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(s => ({
      ...s,
      url: getShopUrl(s.slug, req),
    }));
  const plans = store.data.licensePlans.filter(isPlanAvailable).sort((a, b) => a.days - b.days);
  res.render('tenant/my-shops', {
    title: 'ร้านของฉัน', shops, plans, mainDomain,
  });
});

router.post('/my-shops/:id/renew', requireLogin, async (req, res) => {
  const user = currentUser(req);
  if (!user) {
    req.flash('error', 'กรุณาเข้าสู่ระบบก่อน');
    return res.redirect('/login');
  }

  if (tenantActionLocks.has(user.id)) {
    req.flash('error', 'ระบบกำลังดำเนินการรายการก่อนหน้า กรุณารอสักครู่');
    return res.redirect('/my-shops');
  }

  tenantActionLocks.add(user.id);
  try {
    const shop = store.data.shops.find(s => s.id === req.params.id && s.ownerId === user.id);
    const plan = store.data.licensePlans.find(p => p.id === req.body.planId && isPlanAvailable(p));
    if (!shop || !plan) {
      req.flash('error', 'ไม่พบร้านหรือแพ็กเกจนี้');
      return res.redirect('/my-shops');
    }
    if (user.walletBalance < plan.price) {
      req.flash('error', 'ยอดเครดิตไม่พอ กรุณาเติมเงินก่อน');
      return res.redirect('/my-shops');
    }
    user.walletBalance -= plan.price;
    if (plan.promo) plan.promoUsedCount = (plan.promoUsedCount || 0) + 1;
    store.data.walletTransactions.push({
      id: store.genId(10), userId: user.id, type: 'shop_renewal', amount: -plan.price,
      note: `ต่ออายุร้าน "${shop.name}" (${plan.days} วัน)`, createdAt: new Date().toISOString(),
    });
    const base = shop.expiresAt && Date.now() < shop.expiresAt ? shop.expiresAt : Date.now();
    shop.expiresAt = base + plan.days * 24 * 60 * 60 * 1000;
    await store.save();

    discordBot.notifyRenewal({
      shopName: shop.name, ownerUsername: user.username, days: plan.days, price: plan.price, expiresAt: shop.expiresAt,
    }).catch((err) => console.error('[discord-bot] notifyRenewal failed:', err));

    req.flash('success', `ต่ออายุร้าน "${shop.name}" สำเร็จ!`);
    res.redirect('/my-shops');
  } catch (err) {
    console.error('[renew] error:', err);
    req.flash('error', 'เกิดข้อผิดพลาดในการต่ออายุ');
    res.redirect('/my-shops');
  } finally {
    tenantActionLocks.delete(user.id);
  }
});

module.exports = router;
