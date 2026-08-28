// Multi-tenant SaaS prototype: one signup form creates a new "shop"
// instantly (no Railway, no GitHub, no per-customer infrastructure at all)
// — every shop just lives as data in the SAME running app/database,
// isolated by URL (/s/:slug/...).
//
// Deliberately kept on its OWN data collections (`shops`, `tenantProducts`)
// completely separate from the existing single-tenant collections
// (`products`, `orders`, `users`, ...) so this can never affect or break
// the main storefront/admin that's already live. Shop-owner auth is its
// own lightweight session field (req.session.shopOwnerId), independent of
// the main app's user/session model.
//
// Still missing vs. the main store: cart/checkout, wallet, real orders,
// stock/claim-code delivery, coupons, appearance customization — this is a
// product catalog + admin only so far.
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

function findShop(slug) {
  return store.data.shops.find(s => s.slug === slug);
}

function requireShopOwner(req, res, next) {
  const shop = findShop(req.params.slug);
  if (!shop) return res.status(404).render('shop/404', { layout: 'layouts/main', title: 'ไม่พบร้านนี้' });
  if (req.session.shopOwnerId !== shop.id) {
    req.flash('error', 'กรุณาเข้าสู่ระบบร้านนี้ก่อน');
    return res.redirect(`/s/${shop.slug}/login`);
  }
  req.shop = shop;
  next();
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

  req.session.shopOwnerId = shop.id;
  req.flash('success', `เปิดร้าน "${shop.name}" สำเร็จ!`);
  res.redirect(`/s/${shop.slug}/admin`);
});

router.get('/s/:slug/login', (req, res) => {
  const shop = findShop(req.params.slug);
  if (!shop) return res.status(404).render('shop/404', { layout: 'layouts/main', title: 'ไม่พบร้านนี้' });
  res.render('tenant/login', { title: `เข้าสู่ระบบ — ${shop.name}`, layout: false, shop, messages: { error: req.flash('error') } });
});

router.post('/s/:slug/login', (req, res) => {
  const shop = findShop(req.params.slug);
  if (!shop) return res.status(404).render('shop/404', { layout: 'layouts/main', title: 'ไม่พบร้านนี้' });
  const password = String(req.body.password || '');
  if (!bcrypt.compareSync(password, shop.ownerPasswordHash)) {
    req.flash('error', 'รหัสผ่านไม่ถูกต้อง');
    return res.redirect(`/s/${shop.slug}/login`);
  }
  req.session.shopOwnerId = shop.id;
  res.redirect(`/s/${shop.slug}/admin`);
});

router.get('/s/:slug/logout', (req, res) => {
  req.session.shopOwnerId = null;
  res.redirect(`/s/${req.params.slug}`);
});

router.get('/s/:slug/admin', requireShopOwner, (req, res) => {
  const products = store.data.tenantProducts.filter(p => p.shopId === req.shop.id);
  res.render('tenant/admin', {
    title: `หลังบ้าน — ${req.shop.name}`, layout: false, shop: req.shop, products,
    messages: { success: req.flash('success'), error: req.flash('error') },
  });
});

router.post('/s/:slug/admin/products', requireShopOwner, (req, res) => {
  const title = String(req.body.title || '').trim();
  const price = Math.max(0, Number(req.body.price) || 0);
  const stock = Math.max(0, parseInt(req.body.stock, 10) || 0);
  const image = String(req.body.image || '').trim();
  const description = String(req.body.description || '').trim();
  if (!title || !price) {
    req.flash('error', 'กรุณากรอกชื่อสินค้าและราคาให้ถูกต้อง');
    return res.redirect(`/s/${req.shop.slug}/admin`);
  }
  store.data.tenantProducts.push({
    id: store.genId(8), shopId: req.shop.id, title, price, stock, image, description,
    active: true, createdAt: new Date().toISOString(),
  });
  store.save();
  req.flash('success', 'เพิ่มสินค้าแล้ว');
  res.redirect(`/s/${req.shop.slug}/admin`);
});

router.post('/s/:slug/admin/products/:id/delete', requireShopOwner, (req, res) => {
  store.data.tenantProducts = store.data.tenantProducts.filter(p => !(p.id === req.params.id && p.shopId === req.shop.id));
  store.save();
  req.flash('success', 'ลบสินค้าแล้ว');
  res.redirect(`/s/${req.shop.slug}/admin`);
});

router.post('/s/:slug/admin/products/:id/toggle', requireShopOwner, (req, res) => {
  const product = store.data.tenantProducts.find(p => p.id === req.params.id && p.shopId === req.shop.id);
  if (product) { product.active = !product.active; store.save(); }
  res.redirect(`/s/${req.shop.slug}/admin`);
});

// Public storefront — every shop's own isolated page and product list.
router.get('/s/:slug', (req, res) => {
  const shop = findShop(req.params.slug);
  if (!shop) return res.status(404).render('shop/404', { layout: 'layouts/main', title: 'ไม่พบร้านนี้' });
  const products = store.data.tenantProducts.filter(p => p.shopId === shop.id && p.active);
  res.render('tenant/storefront', { title: shop.name, layout: false, shop, products });
});

module.exports = router;
