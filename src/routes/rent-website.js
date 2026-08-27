const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const store = require('../data/store');
const license = require('../services/license');
const railway = require('../services/railway');
const { requireLogin, currentUser } = require('../middleware/auth');

router.use(requireLogin);

function randomToken(len) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

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
    newSiteReady: railway.isEnabled(),
  });
});

router.post('/buy', (req, res) => {
  const user = currentUser(req);
  const plan = store.data.licensePlans.find(p => p.id === req.body.planId && p.active);
  const wantsNewSite = req.body.type === 'new_site';

  if (!license.isEnabled()) {
    req.flash('error', 'ระบบขายคีย์ยังไม่พร้อมใช้งาน กรุณาติดต่อแอดมิน');
    return res.redirect('/rent-website');
  }
  if (!plan) {
    req.flash('error', 'ไม่พบแพ็กเกจนี้');
    return res.redirect('/rent-website');
  }
  if (wantsNewSite && !railway.isEnabled()) {
    req.flash('error', 'ระบบสร้างเว็บใหม่อัตโนมัติยังไม่พร้อมใช้งาน กรุณาติดต่อแอดมิน');
    return res.redirect('/rent-website');
  }

  let adminUsername, adminPassword, railwayToken, siteName;
  if (wantsNewSite) {
    siteName = String(req.body.siteName || '').trim().toLowerCase();
    adminUsername = String(req.body.adminUsername || '').trim();
    adminPassword = String(req.body.adminPassword || '');
    railwayToken = String(req.body.railwayToken || '').trim();
    if (!/^[a-z0-9-]{3,30}$/.test(siteName)) {
      req.flash('error', 'ชื่อเว็บต้องเป็นตัวอักษร a-z, 0-9 และ - เท่านั้น ยาว 3-30 ตัว');
      return res.redirect('/rent-website');
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(adminUsername)) {
      req.flash('error', 'ชื่อผู้ใช้แอดมินต้องเป็นตัวอักษร a-z, 0-9 และ _ เท่านั้น ยาว 3-20 ตัว');
      return res.redirect('/rent-website');
    }
    if (adminPassword.length < 8) {
      req.flash('error', 'รหัสผ่านแอดมินต้องมีอย่างน้อย 8 ตัวอักษร');
      return res.redirect('/rent-website');
    }
    if (!railwayToken && !railway.hasSellerToken()) {
      req.flash('error', 'กรุณากรอก Railway API Token ของคุณเอง');
      return res.redirect('/rent-website');
    }
  }

  if (user.walletBalance < plan.price) {
    req.flash('error', 'ยอดเครดิตไม่พอ กรุณาเติมเงินก่อน');
    return res.redirect('/rent-website');
  }

  user.walletBalance -= plan.price;
  store.data.walletTransactions.push({
    id: store.genId(10), userId: user.id, type: 'license_purchase', amount: -plan.price,
    note: `ซื้อคีย์เช่าเว็บ ${plan.days} วัน${wantsNewSite ? ' (พร้อมเปิดเว็บใหม่)' : ''}`,
    createdAt: new Date().toISOString(),
  });

  const key = license.generateKey(user.username, plan.days);
  const sale = {
    id: store.genId(10), userId: user.id, username: user.username,
    days: plan.days, price: plan.price, key, type: wantsNewSite ? 'new_site' : 'renewal',
    createdAt: new Date().toISOString(),
  };

  if (wantsNewSite) {
    sale.provisioning = {
      status: 'creating', log: ['กำลังเริ่มสร้างเว็บใหม่...'],
      url: null, adminUsername, adminPassword, error: null,
    };
    store.data.licenseSales.unshift(sale);
    store.save();

    const envVars = {
      ADMIN_USERNAME: adminUsername,
      ADMIN_PASSWORD: adminPassword,
      SESSION_SECRET: randomToken(32),
      LICENSE_SECRET: process.env.LICENSE_SECRET,
      LICENSE_GATE: 'on',
    };
    const projectName = siteName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    railway.provisionNewSite({ projectName, envVars, railwayToken }).then((result) => {
      const current = store.data.licenseSales.find(s => s.id === sale.id);
      if (!current) return;
      current.provisioning.status = result.ok ? 'success' : 'failed';
      current.provisioning.log = result.log;
      current.provisioning.url = result.url || null;
      current.provisioning.error = result.error || null;
      store.save();
    }).catch((err) => {
      const current = store.data.licenseSales.find(s => s.id === sale.id);
      if (!current) return;
      current.provisioning.status = 'failed';
      current.provisioning.error = err.message;
      store.save();
    });
  } else {
    store.data.licenseSales.unshift(sale);
    store.save();
  }

  req.flash('success', wantsNewSite
    ? 'ซื้อสำเร็จ! ระบบกำลังสร้างเว็บใหม่ให้อัตโนมัติ รอสักครู่'
    : 'ซื้อคีย์สำเร็จ! เอาคีย์นี้ไปกรอกที่หน้า /license ของเว็บที่ต้องการต่ออายุ');
  res.redirect('/rent-website/sale/' + sale.id);
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
  res.render('shop/rent-website-sale', { title: 'คีย์เช่าเว็บของคุณ', sale });
});

router.get('/sale/:id/status', (req, res) => {
  const user = currentUser(req);
  const sale = store.data.licenseSales.find(s => s.id === req.params.id && s.userId === user.id);
  if (!sale) return res.status(404).json({ error: 'not found' });
  res.json({ provisioning: sale.provisioning || null });
});

module.exports = router;
