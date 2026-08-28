const express = require('express');
const router = express.Router();
const store = require('../data/store');
const license = require('../services/license');
const railway = require('../services/railway');
const { requireLogin, currentUser } = require('../middleware/auth');

router.use(requireLogin);

router.get('/', (req, res) => {
  const user = currentUser(req);
  const mySales = store.data.licenseSales
    .filter(s => s.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20)
    .map(s => ({ ...s, exp: license.isEnabled() ? (license.verifyKey(s.key).exp || null) : null }));
  res.render('shop/rent-website', { title: 'เปิดร้านใหม่ของคุณเอง', mySales });
});

// Selling new license keys (the old "rent a separate Railway deployment"
// system) is retired in favor of /start's multi-tenant shops — this stays
// only so past buyers can still view their key and self-serve update
// (see /sale/:id and /sale/:id/sync below).
router.post('/buy', (req, res) => {
  req.flash('error', 'ระบบนี้ปิดให้บริการแล้ว กรุณาเปิดร้านใหม่ที่ /start แทน');
  res.redirect('/rent-website');
});

router.get('/guide', (req, res) => {
  res.render('shop/rent-website-guide', { title: 'วิธีเปิดเว็บใหม่แบบละเอียด' });
});

router.get('/sale/:id', (req, res) => {
  const user = currentUser(req);
  const sale = store.data.licenseSales.find(s => s.id === req.params.id && s.userId === user.id);
  if (!sale) {
    req.flash('error', 'ไม่พบรายการนี้');
    return res.redirect('/rent-website');
  }
  const verified = license.isEnabled() ? license.verifyKey(sale.key) : {};
  res.render('shop/rent-website-sale', { title: 'คีย์เช่าเว็บของคุณ', sale, exp: verified.exp || null });
});

router.get('/sale/:id/status', (req, res) => {
  const user = currentUser(req);
  const sale = store.data.licenseSales.find(s => s.id === req.params.id && s.userId === user.id);
  if (!sale) return res.status(404).json({ error: 'not found' });
  res.json({ provisioning: sale.provisioning || null });
});

// Customer self-service: pull the latest release into JUST this one site,
// without touching anyone else's. Needs the buyer's Railway token again
// (never stored) since it's their own project.
router.post('/sale/:id/sync', async (req, res) => {
  const user = currentUser(req);
  const sale = store.data.licenseSales.find(s => s.id === req.params.id && s.userId === user.id);
  if (!sale || !sale.provisioning || sale.provisioning.status !== 'success') {
    req.flash('error', 'ไม่พบเว็บนี้ หรือเว็บยังสร้างไม่เสร็จ');
    return res.redirect('/rent-website');
  }
  const railwayToken = String(req.body.railwayToken || '').trim();
  if (!railwayToken) {
    req.flash('error', 'กรุณากรอก Railway API Token ของคุณ');
    return res.redirect('/rent-website/sale/' + sale.id);
  }
  const result = await railway.redeployService({
    railwayToken,
    serviceId: sale.provisioning.serviceId,
    environmentId: sale.provisioning.environmentId,
  });
  req.flash(result.ok ? 'success' : 'error', result.ok
    ? 'สั่งอัพเดตเว็บของคุณแล้ว รอสักครู่แล้วรีเฟรชเว็บของคุณ'
    : ('อัพเดตไม่สำเร็จ: ' + result.error));
  res.redirect('/rent-website/sale/' + sale.id);
});

module.exports = router;
