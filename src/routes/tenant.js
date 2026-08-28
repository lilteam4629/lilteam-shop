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
const { MAIN_DOMAIN } = require('../middleware/tenant');
const { requireLogin, currentUser } = require('../middleware/auth');

function slugify(str) {
  return String(str || '').toLowerCase().trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

router.get('/start', requireLogin, (req, res) => {
  const plans = store.data.licensePlans.filter(p => p.active).sort((a, b) => a.days - b.days);
  res.render('tenant/start', {
    title: 'เปิดร้านของคุณเอง', layout: false,
    domainReady: Boolean(MAIN_DOMAIN), mainDomain: MAIN_DOMAIN, plans,
    messages: { error: req.flash('error') },
  });
});

router.post('/start', requireLogin, async (req, res) => {
  const user = currentUser(req);
  if (!MAIN_DOMAIN) {
    req.flash('error', 'ระบบเปิดร้านยังไม่พร้อมใช้งาน (ต้องตั้งค่าโดเมนก่อน) กรุณาติดต่อผู้ดูแลเว็บ');
    return res.redirect('/start');
  }
  const plan = store.data.licensePlans.find(p => p.id === req.body.planId && p.active);
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
  if (store.data.shops.some(s => s.slug === slug)) slug = `${slug}-${store.genId(4)}`;

  user.walletBalance -= plan.price;
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
  store.save();

  try {
    await store.createTenantDb(shopId, {
      shopName, adminUsername, adminEmail: user.email || `${adminUsername}@${slug}.local`,
      adminPasswordHash: bcrypt.hashSync(adminPassword, 10),
    });
  } catch (err) {
    store.data.shops = store.data.shops.filter(s => s.id !== shopId);
    user.walletBalance += plan.price;
    store.data.walletTransactions.push({
      id: store.genId(10), userId: user.id, type: 'shop_purchase_refund', amount: plan.price,
      note: `คืนเครดิต — เปิดร้าน "${shopName}" ไม่สำเร็จ`, createdAt: new Date().toISOString(),
    });
    store.save();
    req.flash('error', 'สร้างร้านไม่สำเร็จ ลองใหม่อีกครั้ง (คืนเครดิตให้แล้ว)');
    return res.redirect('/start');
  }

  req.flash('success', `เปิดร้าน "${shopName}" สำเร็จ! เข้าสู่ระบบด้วยชื่อผู้ใช้ ${adminUsername}`);
  res.redirect(`https://${slug}.${MAIN_DOMAIN}/login`);
});

// Buyer's own shops + renewal.
router.get('/my-shops', requireLogin, (req, res) => {
  const user = currentUser(req);
  const shops = store.data.shops.filter(s => s.ownerId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const plans = store.data.licensePlans.filter(p => p.active).sort((a, b) => a.days - b.days);
  res.render('tenant/my-shops', {
    title: 'ร้านของฉัน', shops, plans, mainDomain: MAIN_DOMAIN,
  });
});

router.post('/my-shops/:id/renew', requireLogin, (req, res) => {
  const user = currentUser(req);
  const shop = store.data.shops.find(s => s.id === req.params.id && s.ownerId === user.id);
  const plan = store.data.licensePlans.find(p => p.id === req.body.planId && p.active);
  if (!shop || !plan) {
    req.flash('error', 'ไม่พบร้านหรือแพ็กเกจนี้');
    return res.redirect('/my-shops');
  }
  if (user.walletBalance < plan.price) {
    req.flash('error', 'ยอดเครดิตไม่พอ กรุณาเติมเงินก่อน');
    return res.redirect('/my-shops');
  }
  user.walletBalance -= plan.price;
  store.data.walletTransactions.push({
    id: store.genId(10), userId: user.id, type: 'shop_renewal', amount: -plan.price,
    note: `ต่ออายุร้าน "${shop.name}" (${plan.days} วัน)`, createdAt: new Date().toISOString(),
  });
  const base = shop.expiresAt && Date.now() < shop.expiresAt ? shop.expiresAt : Date.now();
  shop.expiresAt = base + plan.days * 24 * 60 * 60 * 1000;
  store.save();
  req.flash('success', `ต่ออายุร้าน "${shop.name}" สำเร็จ!`);
  res.redirect('/my-shops');
});

module.exports = router;
