const express = require('express');
const store = require('../data/store');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

router.post('/effects/rain', async (req, res) => {
  const previous = store.data.settings.rain || {};
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : (previous.color || '#78c8ff');
  const intensity = ['light', 'medium', 'heavy'].includes(req.body.intensity) ? req.body.intensity : 'medium';
  store.data.settings.rain = { enabled: req.body.enabled === 'on', color, intensity };
  await store.save();
  req.flash('success', store.data.settings.rain.enabled ? 'บันทึกและเปิดระบบฝนตกแล้ว' : 'บันทึกและปิดระบบฝนตกแล้ว');
  res.redirect('/admin/effects');
});

module.exports = router;
