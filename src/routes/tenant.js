// Multi-tenant SaaS signup: one form creates a new shop that gets the
// SAME full app every other shop (and the seller's own site) runs — real
// products, stock, wallet, orders, coupons, minigame, appearance settings,
// all of it — because it's literally the same codebase, just pointed at
// that shop's own dataset (see src/middleware/tenant.js and
// src/data/store.js runInTenant/createTenantDb). No Railway, no GitHub,
// no per-customer deployment, and every existing route/view works
// unmodified for a shop's own subdomain.
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const store = require('../data/store');
const { MAIN_DOMAIN } = require('../middleware/tenant');

function slugify(str) {
  return String(str || '').toLowerCase().trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

router.get('/start', (req, res) => {
  res.render('tenant/start', {
    title: 'เปิดร้านของคุณเอง', layout: false,
    domainReady: Boolean(MAIN_DOMAIN),
    mainDomain: MAIN_DOMAIN,
    messages: { error: req.flash('error') },
  });
});

router.post('/start', async (req, res) => {
  if (!MAIN_DOMAIN) {
    req.flash('error', 'ระบบเปิดร้านยังไม่พร้อมใช้งาน (ต้องตั้งค่าโดเมนก่อน) กรุณาติดต่อผู้ดูแลเว็บ');
    return res.redirect('/start');
  }
  const name = String(req.body.name || '').trim();
  const shopName = String(req.body.shopName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !shopName || !email || password.length < 8) {
    req.flash('error', 'กรุณากรอกข้อมูลให้ครบ (รหัสผ่านอย่างน้อย 8 ตัว)');
    return res.redirect('/start');
  }
  if (store.data.shops.some(s => s.ownerEmail === email)) {
    req.flash('error', 'อีเมลนี้เปิดร้านไว้แล้ว');
    return res.redirect('/start');
  }

  let slug = slugify(shopName) || 'shop';
  if (store.data.shops.some(s => s.slug === slug)) slug = `${slug}-${store.genId(4)}`;

  let adminUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'owner';
  if (adminUsername.length < 3) adminUsername = `${adminUsername}${store.genId(3)}`;

  const shopId = store.genId(10);
  store.data.shops.push({ id: shopId, slug, name: shopName, ownerName: name, ownerEmail: email, createdAt: new Date().toISOString() });
  store.save();

  try {
    await store.createTenantDb(shopId, {
      shopName, adminUsername, adminEmail: email, adminPasswordHash: bcrypt.hashSync(password, 10),
    });
  } catch (err) {
    store.data.shops = store.data.shops.filter(s => s.id !== shopId);
    store.save();
    req.flash('error', 'สร้างร้านไม่สำเร็จ ลองใหม่อีกครั้ง');
    return res.redirect('/start');
  }

  req.flash('success', `เปิดร้าน "${shopName}" สำเร็จ! เข้าสู่ระบบด้วยชื่อผู้ใช้ ${adminUsername}`);
  res.redirect(`https://${slug}.${MAIN_DOMAIN}/login`);
});

module.exports = router;
