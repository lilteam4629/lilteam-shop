const express = require('express');
const router = express.Router();
const store = require('../data/store');
const license = require('../services/license');

// Railway auto-sets this to the deployed commit — shown on the page so it's
// possible to tell at a glance whether a site is actually on the latest
// code, instead of guessing about caching or deploy delay.
const buildId = (process.env.RAILWAY_GIT_COMMIT_SHA || 'dev').slice(0, 7);

router.get('/license', (req, res) => {
  const current = store.data.settings.license;
  const active = current.key && current.expiresAt && Date.now() < current.expiresAt;
  res.render('shop/license', {
    title: 'ปลดล็อกระบบ', layout: false,
    active, label: current.label, expiresAt: current.expiresAt, buildId,
  });
});

router.post('/license', async (req, res) => {
  const key = String(req.body?.key || '').trim();
  if (!key) {
    req.flash('error', 'กรุณากรอกคีย์ใบอนุญาต');
    return res.redirect('/license');
  }
  const result = license.verifyKey(key);
  if (!result.valid) {
    req.flash('error', result.error || 'คีย์ไม่ถูกต้อง');
    return res.redirect('/license');
  }
  const current = store.data.settings.license;
  if (current.key === key) {
    req.flash('error', 'คีย์นี้ใช้ไปแล้ว กรุณาซื้อคีย์ใหม่เพื่อต่ออายุ');
    return res.redirect('/license');
  }
  // Renewing while time is still left ADDS the new days on top of what's
  // remaining (instead of overwriting it), so buying/redeeming early never
  // loses paid-for time.
  const stillActive = current.expiresAt && Date.now() < current.expiresAt;
  const base = stillActive ? current.expiresAt : Date.now();
  const expiresAt = typeof result.days === 'number' ? base + Math.round(result.days * 24 * 60 * 60 * 1000) : result.exp;
  store.data.settings.license = { key, label: result.label || null, expiresAt };
  await store.save();
  req.flash('success', stillActive ? 'ต่ออายุสำเร็จ! เพิ่มเวลาให้แล้ว' : 'ปลดล็อกระบบสำเร็จ');
  res.redirect('/');
});

module.exports = router;
