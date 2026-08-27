const express = require('express');
const router = express.Router();
const store = require('../data/store');
const license = require('../services/license');

router.get('/license', (req, res) => {
  const current = store.data.settings.license;
  const active = current.key && current.expiresAt && Date.now() < current.expiresAt;
  res.render('shop/license', {
    title: 'ปลดล็อกระบบ', layout: false,
    active, label: current.label, expiresAt: current.expiresAt,
  });
});

router.post('/license', (req, res) => {
  const key = req.body.key.trim();
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
  store.save();
  req.flash('success', stillActive ? 'ต่ออายุสำเร็จ! เพิ่มเวลาให้แล้ว' : 'ปลดล็อกระบบสำเร็จ');
  res.redirect('/');
});

module.exports = router;
