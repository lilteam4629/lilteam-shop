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
  const result = license.verifyKey(req.body.key);
  if (!result.valid) {
    req.flash('error', result.error || 'คีย์ไม่ถูกต้อง');
    return res.redirect('/license');
  }
  store.data.settings.license = { key: req.body.key.trim(), label: result.label || null, expiresAt: result.exp };
  store.save();
  req.flash('success', 'ปลดล็อกระบบสำเร็จ');
  res.redirect('/');
});

module.exports = router;
