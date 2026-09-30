const express = require('express');
const crypto = require('crypto');
const store = require('../data/store');
const rewards = require('../services/promotions');
const { requireLogin, requireAdmin, currentUser } = require('../middleware/auth');
const router = express.Router();
function token(req) { return req.session.promotionCsrf ||= crypto.randomBytes(24).toString('hex'); }
function csrf(req, res, next) {
  const a = Buffer.from(String(req.body.csrf || '')), b = Buffer.from(token(req));
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return res.status(403).send('กรุณารีเฟรชหน้าแล้วลองใหม่');
  next();
}
function requireStorefrontPromotions(req, res, next) {
  if (!req.tenantShop || store.data.settings.promotions?.storefrontEnabled === true) return next();
  return res.redirect('/');
}
const publicView = (req, res) => {
  if (req.tenantShop && store.data.settings.promotions?.storefrontEnabled !== true) return res.redirect('/');
  const user = currentUser(req), cfg = rewards.config(store.data);
  res.render('shop/promotions', { title: 'โปรโมชั่นและชวนเพื่อน', campaigns: cfg.campaigns || [], referral: cfg.referral,
    claims: (store.data.promotionClaims || []).filter(c => c.userId === user?.id),
    referralCount: user ? store.data.users.filter(u => u.referredBy === user.id).length : 0,
    referralCompleted: user ? store.data.users.filter(u => u.referredBy === user.id && u.referralRewardedAt).length : 0,
    topupTotal: user ? rewards.topupTotal(store.data,user.id) : 0,
    referralJoined: Boolean(user?.referredBy),
    referralPath: user && rewards.topupTotal(store.data,user.id) >= 10 ? `/register?ref=${encodeURIComponent(user.id)}` : '',
    coupon: req.session.coupon || null, csrf: token(req), inWindow: rewards.inWindow });
};
router.get('/promotions', publicView);
router.post('/promotions/claim', requireStorefrontPromotions, requireLogin, csrf, async (req,res) => {
  try {
    const amount = await store.transact(data => rewards.claim(data, req.session.userId, String(req.body.campaignId), req.body.username));
    req.flash('success', `ได้รับ ${amount.toLocaleString()} พ้อยเข้ากระเป๋าแล้ว`);
  } catch(e) { req.flash('error', e.message); }
  res.redirect('/promotions');
});
router.post('/promotions/coupon', requireStorefrontPromotions, requireLogin, csrf, (req,res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const coupon = (store.data.coupons || []).find(c => c.code === code && c.active
    && (!c.expiresAt || Date.parse(c.expiresAt) > Date.now())
    && (!c.usageLimit || Number(c.usedCount || 0) < c.usageLimit));
  if (!coupon) req.flash('error', 'โค้ดไม่ถูกต้อง หมดเวลา หรือใช้ครบจำนวนแล้ว');
  else {
    req.session.coupon = { code: coupon.code, type: coupon.type, value: coupon.value };
    req.flash('success', `เก็บคูปอง ${coupon.code} แล้ว ส่วนลดจะคำนวณตอนชำระสินค้า`);
  }
  res.redirect('/promotions');
});
router.post('/promotions/referral-join', requireStorefrontPromotions, requireLogin, csrf, async (req,res) => {
  try { await store.transact(data=>rewards.joinReferral(data,req.session.userId,req.body.username,req.body.referrerUsername));req.flash('success','บันทึกผู้แนะนำแล้ว ซื้อสินค้าสำเร็จครั้งแรกเพื่อรับรางวัล'); }
  catch(e){req.flash('error',e.message);}res.redirect('/promotions');
});
router.post('/promotions/referral-check', requireStorefrontPromotions, requireLogin, csrf, async (req,res) => {
  try {
    const settled = await store.transact(data => {
      let count = 0;
      for (const order of data.orders || []) if (order.userId === req.session.userId || data.users.some(u => u.id === order.userId && u.referredBy === req.session.userId)) {
        if (rewards.settleReferral(data, order)) count++;
      }
      return count;
    });
    req.flash('success', settled ? 'อัปเดตรางวัลแนะนำเพื่อนแล้ว' : 'ยังไม่มีรางวัลใหม่ เพื่อนต้องซื้อและคำสั่งซื้อสำเร็จก่อน');
  } catch(e) { req.flash('error', e.message); }
  res.redirect('/promotions');
});
router.get('/admin/promotions', requireAdmin, (req,res) => res.render('admin/promotions', {
  layout: 'layouts/admin-experiment', title: 'โปรโมชั่นและแนะนำเพื่อน', active: 'promotions', config: rewards.config(store.data),
  isMainSite: !req.tenantShop, storefrontEnabled: !req.tenantShop || store.data.settings.promotions?.storefrontEnabled === true,
  history: rewards.history(store.data), claims: store.data.promotionClaims || [], csrf: token(req),
  pendingTopupCount: (store.data.topupRequests || []).filter(t => ['pending','verifying'].includes(t.status)).length,
  persistentStorageEnabled: store.isPersistent(),
}));
router.post('/admin/promotions/storefront', requireAdmin, csrf, async (req,res) => {
  if (!req.tenantShop) {
    req.flash('success', 'โปรโมชั่นเปิดใช้งานสำหรับเว็บหลักอยู่แล้ว');
    return res.redirect('/admin/promotions');
  }
  await store.transact(data => {
    const cfg = data.settings.promotions ||= { campaigns: [], referral: { enabled: false, referrerAmount: 0, friendAmount: 0 } };
    cfg.storefrontEnabled = req.body.enabled === 'on';
  });
  req.flash('success', req.body.enabled === 'on' ? 'เปิดโปรโมชั่นบนหน้าเว็บร้านแล้ว' : 'ซ่อนโปรโมชั่นจากหน้าเว็บร้านแล้ว');
  res.redirect('/admin/promotions');
});
router.post('/admin/promotions/campaign', requireAdmin, csrf, async (req,res) => {
  try {
    const title = String(req.body.title || '').trim().slice(0,120);
    const amount = rewards.money(req.body.amount), window = rewards.validateWindow(req.body);
    const maxClaims = Number(req.body.maxClaims || 0);
    if (!title || amount <= 0 || !Number.isInteger(maxClaims) || maxClaims < 0 || maxClaims > 1000000) throw new Error('ตรวจสอบชื่อโปรโมชั่น พ้อย และจำนวนสิทธิ์');
    if (req.body.newMembersOnly && !window.startsAt) throw new Error('โปรโมชั่นสมาชิกใหม่ต้องกำหนดวันเริ่ม');
    await store.transact(data => {
      const cfg = data.settings.promotions ||= { campaigns: [], referral: { enabled: false, referrerAmount: 0, friendAmount: 0 } };
      cfg.campaigns ||= [];
      cfg.campaigns.push({ id: crypto.randomBytes(12).toString('hex'), title, description: String(req.body.description || '').trim().slice(0,500),
        amount, maxClaims, ...window, enabled: req.body.enabled === 'on', newMembersOnly: req.body.newMembersOnly === 'on', createdAt: new Date().toISOString() });
    });
    req.flash('success','สร้างโปรโมชั่นแล้ว');
  } catch(e) { req.flash('error',e.message); }
  res.redirect('/admin/promotions');
});
router.post('/admin/promotions/campaign/:id/toggle', requireAdmin, csrf, async (req,res) => {
  await store.transact(data => {
    const campaign = data.settings.promotions?.campaigns?.find(c => c.id === req.params.id);
    if (campaign) campaign.enabled = !campaign.enabled;
  });
  res.redirect('/admin/promotions');
});
router.post('/admin/promotions/referral', requireAdmin, csrf, async (req,res) => {
  try {
    const value = { enabled: req.body.enabled === 'on', referrerAmount: rewards.money(req.body.referrerAmount), friendAmount: rewards.money(req.body.friendAmount), ...rewards.validateWindow(req.body) };
    if (value.enabled && !value.referrerAmount && !value.friendAmount) throw new Error('กำหนดพ้อยอย่างน้อยหนึ่งฝ่ายก่อนเปิด');
    await store.transact(data => {
      const cfg = data.settings.promotions ||= { campaigns: [] };
      cfg.referral = value;
    });
    req.flash('success','บันทึกระบบแนะนำเพื่อนแล้ว');
  } catch(e) { req.flash('error',e.message); }
  res.redirect('/admin/promotions');
});
module.exports = router;
