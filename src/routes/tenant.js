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
//
// The actual buy/renew logic lives in src/services/shop-provisioning.js —
// shared with src/routes/internal-api.js, which the separate rent-app
// calls to do exactly the same thing from its own UI.
const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { getMainDomain, getShopUrl } = require('../middleware/tenant');
const { requireLogin, currentUser } = require('../middleware/auth');
const recaptcha = require('../services/recaptcha');
const provisioning = require('../services/shop-provisioning');

router.get('/start', requireLogin, (req, res) => {
  const mainDomain = getMainDomain(req);
  const isLocal = mainDomain === 'localhost';
  const plans = store.data.licensePlans.filter(provisioning.isPlanAvailable).sort((a, b) => a.days - b.days);
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

  const result = await provisioning.provisionShop({
    user,
    planId: req.body.planId,
    shopName: req.body.shopName,
    adminUsername: req.body.adminUsername,
    adminPassword: req.body.adminPassword,
    recaptchaResponse: req.body['g-recaptcha-response'],
    ip: req.ip,
  });

  if (!result.ok) {
    req.flash('error', result.error);
    return res.redirect('/start');
  }

  req.flash('success', `เปิดร้าน "${result.shopName}" สำเร็จ! เข้าสู่ระบบด้วยชื่อผู้ใช้ ${result.adminUsername}`);
  res.redirect(`${result.targetUrl}/login`);
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
  const plans = store.data.licensePlans.filter(provisioning.isPlanAvailable).sort((a, b) => a.days - b.days);
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

  const result = await provisioning.renewShop({ user, shopId: req.params.id, planId: req.body.planId });
  if (!result.ok) {
    req.flash('error', result.error);
    return res.redirect('/my-shops');
  }

  req.flash('success', `ต่ออายุร้าน "${result.shop.name}" สำเร็จ!`);
  res.redirect('/my-shops');
});

module.exports = router;
