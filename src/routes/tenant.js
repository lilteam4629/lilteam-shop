// Phase 1 prototype of a multi-tenant SaaS model: one signup form creates a
// new "shop" record instantly (no Railway, no GitHub, no per-customer
// infrastructure at all) — every shop just lives as data in the SAME
// running app/database, isolated by URL (/s/:slug/...).
//
// Deliberately NOT wired into the real storefront/admin/products/orders
// yet (that's Phase 2-3) — this only proves the core idea: signup -> a shop
// exists -> visiting its URL shows its own isolated data, with zero
// per-tenant deployment.
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const store = require('../data/store');

function slugify(str) {
  return String(str || '').toLowerCase().trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

router.get('/start', (req, res) => {
  res.render('tenant/start', { title: 'เปิดร้านของคุณเอง', layout: false, messages: { error: req.flash('error') } });
});

router.post('/start', (req, res) => {
  const name = String(req.body.name || '').trim();
  const shopName = String(req.body.shopName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
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

  const shop = {
    id: store.genId(10),
    slug,
    name: shopName,
    ownerName: name,
    ownerEmail: email,
    ownerPhone: phone,
    ownerPasswordHash: bcrypt.hashSync(password, 10),
    plan: 'trial',
    createdAt: new Date().toISOString(),
  };
  store.data.shops.push(shop);
  store.save();

  req.flash('success', `เปิดร้าน "${shop.name}" สำเร็จ!`);
  res.redirect(`/s/${shop.slug}`);
});

// Tenant resolution proof-of-concept: any shop's own isolated page, purely
// from data — no separate server, no separate database, no deployment.
router.get('/s/:slug', (req, res) => {
  const shop = store.data.shops.find(s => s.slug === req.params.slug);
  if (!shop) {
    return res.status(404).render('shop/404', { layout: 'layouts/main', title: 'ไม่พบร้านนี้' });
  }
  res.render('tenant/shop-stub', { title: shop.name, layout: false, shop });
});

module.exports = router;
