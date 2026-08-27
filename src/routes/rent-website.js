const express = require('express');
const router = express.Router();
const store = require('../data/store');
const license = require('../services/license');
const { requireLogin, currentUser } = require('../middleware/auth');

router.use(requireLogin);

router.get('/', (req, res) => {
  const user = currentUser(req);
  const plans = store.data.licensePlans.filter(p => p.active).sort((a, b) => a.days - b.days);
  const mySales = store.data.licenseSales
    .filter(s => s.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  res.render('shop/rent-website', {
    title: 'เช่าเว็บ / ต่ออายุคีย์', plans, mySales,
    licenseReady: license.isEnabled(),
  });
});

router.post('/buy', (req, res) => {
  const user = currentUser(req);
  const plan = store.data.licensePlans.find(p => p.id === req.body.planId && p.active);

  if (!license.isEnabled()) {
    req.flash('error', 'ระบบขายคีย์ยังไม่พร้อมใช้งาน กรุณาติดต่อแอดมิน');
    return res.redirect('/rent-website');
  }
  if (!plan) {
    req.flash('error', 'ไม่พบแพ็กเกจนี้');
    return res.redirect('/rent-website');
  }
  if (user.walletBalance < plan.price) {
    req.flash('error', 'ยอดเครดิตไม่พอ กรุณาเติมเงินก่อน');
    return res.redirect('/rent-website');
  }

  user.walletBalance -= plan.price;
  store.data.walletTransactions.push({
    id: store.genId(10), userId: user.id, type: 'license_purchase', amount: -plan.price,
    note: `ซื้อคีย์เช่าเว็บ ${plan.days} วัน`, createdAt: new Date().toISOString(),
  });

  const key = license.generateKey(user.username, plan.days);
  const sale = {
    id: store.genId(10), userId: user.id, username: user.username,
    days: plan.days, price: plan.price, key, createdAt: new Date().toISOString(),
  };
  store.data.licenseSales.unshift(sale);
  store.save();

  req.flash('success', 'ซื้อคีย์สำเร็จ! เอาคีย์นี้ไปกรอกที่หน้า /license ของเว็บที่ต้องการปลดล็อก/ต่ออายุ');
  res.redirect('/rent-website/sale/' + sale.id);
});

router.get('/sale/:id', (req, res) => {
  const user = currentUser(req);
  const sale = store.data.licenseSales.find(s => s.id === req.params.id && s.userId === user.id);
  if (!sale) {
    req.flash('error', 'ไม่พบรายการนี้');
    return res.redirect('/rent-website');
  }
  res.render('shop/rent-website-sale', { title: 'คีย์เช่าเว็บของคุณ', sale });
});

module.exports = router;
