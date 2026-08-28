const express = require('express');
const router = express.Router();
const multer = require('multer');
const QRCode = require('qrcode');
const store = require('../data/store');
const slipok = require('../services/slipok');
const easyslip = require('../services/easyslip');
const promptpay = require('../services/promptpay');
const { requireLogin, currentUser } = require('../middleware/auth');

router.use(requireLogin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  },
});

router.get('/', (req, res) => {
  const user = currentUser(req);
  const transactions = store.data.walletTransactions
    .filter(t => t.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  const topupRequests = store.data.topupRequests
    .filter(t => t.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10);
  const allOrders = store.data.orders
    .filter(o => o.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const orders = allOrders.slice(0, 5);
  const totalSpent = allOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  res.render('shop/account', {
    title: 'บัญชีของฉัน', user, transactions, topupRequests, orders,
    orderCount: allOrders.length, totalSpent,
  });
});

router.get('/topup', (req, res) => {
  res.render('shop/topup', { title: 'เติมเงิน', payment: store.data.settings.payment });
});

router.post('/topup', (req, res) => {
  const user = currentUser(req);
  const amount = parseInt(req.body.amount, 10);
  const method = req.body.method === 'bank_transfer' ? 'bank_transfer' : 'promptpay';
  if (!amount || amount < 20) {
    req.flash('error', 'กรุณาระบุจำนวนเงินอย่างน้อย 20 บาท');
    return res.redirect('/account/topup');
  }
  const request = {
    id: store.genId(10),
    userId: user.id,
    amount,
    method,
    refCode: 'TU' + store.genId(6).toUpperCase(),
    slipPath: null,
    slipCheck: null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewNote: '',
  };
  store.data.topupRequests.push(request);
  store.save();
  res.redirect(`/account/topup/${request.id}`);
});

router.get('/topup/:id', async (req, res) => {
  const user = currentUser(req);
  const request = store.data.topupRequests.find(t => t.id === req.params.id && t.userId === user.id);
  if (!request) return res.redirect('/account/topup');

  const payment = store.data.settings.payment;
  let qrDataUrl = null;
  if (request.method === 'promptpay' && payment.promptpayId) {
    try {
      const payload = promptpay.generatePayload(payment.promptpayId, request.amount);
      qrDataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 260 });
    } catch (err) {
      qrDataUrl = null;
    }
  }

  res.render('shop/topup-detail', { title: 'สถานะการเติมเงิน', request, payment, qrDataUrl });
});

router.post('/topup/:id/slip', (req, res) => {
  const user = currentUser(req);
  const request = store.data.topupRequests.find(t => t.id === req.params.id && t.userId === user.id);
  if (!request) return res.redirect('/account/topup');
  if (request.status !== 'pending') {
    req.flash('error', 'คำขอนี้ถูกตรวจสอบไปแล้ว ไม่สามารถแนบสลิปใหม่ได้');
    return res.redirect(`/account/topup/${request.id}`);
  }
  upload.single('slip')(req, res, async (err) => {
    if (err || !req.file) {
      req.flash('error', 'อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 5MB)');
      return res.redirect(`/account/topup/${request.id}`);
    }
    try {
      request.slipPath = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
    } catch (saveError) {
      req.flash('error', 'บันทึกไฟล์สลิปไม่สำเร็จ กรุณาลองใหม่');
      return res.redirect(`/account/topup/${request.id}`);
    }

    const payment = store.data.settings.payment;
    const fileOptions = { filename: req.file.originalname, contentType: req.file.mimetype };
    let provider = null;
    let result;
    if (easyslip.isConfigured() && payment.easyslipAccountId) {
      provider = 'easyslip';
      result = await easyslip.verifySlip(req.file.buffer, request.amount, fileOptions, {
        bankNumber: payment.bankAccountNumber,
      });
    } else {
      provider = 'slipok';
      result = await slipok.verifySlip(req.file.buffer, request.amount, fileOptions, {
        branchId: payment.slipokBranchId,
        apiKey: payment.slipokApiKey,
      });
    }
    request.slipCheck = { checked: result.checked, verified: result.verified, message: result.message, provider };

    let verified = result.checked && result.verified;
    const raw = result.raw;
    // Normalize the transaction reference + timestamp across providers —
    // EasySlip nests these under rawSlip (transRef, date ISO string);
    // SlipOK returns transRef/transDate/transTime flat.
    const transRef = raw && (raw.transRef || (raw.rawSlip && raw.rawSlip.transRef)) || null;
    const transTime = raw && (
      (raw.rawSlip && raw.rawSlip.date && new Date(raw.rawSlip.date))
      || slipok.parseTransDateTime(raw.transDate, raw.transTime)
    );

    if (verified && raw) {
      request.slipCheck.transRef = transRef;

      // Reject slips for transfers made more than 5 minutes ago
      if (transTime && !Number.isNaN(transTime.getTime()) && Date.now() - transTime.getTime() > 5 * 60 * 1000) {
        verified = false;
        request.slipCheck.verified = false;
        request.slipCheck.message = 'สลิปนี้โอนเงินมานานเกิน 5 นาทีแล้ว ไม่สามารถใช้ยืนยันได้ กรุณาโอนใหม่แล้วแนบสลิปทันที';
      }

      // Reject slips already used to top up successfully before (duplicate) —
      // extra safety on top of the provider's own duplicate check, scoped to
      // this shop's own top-up history.
      if (verified && transRef) {
        const alreadyUsed = store.data.topupRequests.some(t =>
          t.id !== request.id && t.status === 'approved' &&
          t.slipCheck && t.slipCheck.transRef === transRef
        );
        if (alreadyUsed) {
          verified = false;
          request.slipCheck.verified = false;
          request.slipCheck.message = 'สลิปนี้เคยถูกใช้เติมเงินไปแล้ว ไม่สามารถใช้ซ้ำได้';
        }
      }
    }

    if (verified) {
      user.walletBalance += request.amount;
      store.data.walletTransactions.push({
        id: store.genId(10), userId: user.id, type: 'topup', amount: request.amount,
        note: `เติมเงินสำเร็จ (ตรวจสอบอัตโนมัติผ่าน ${provider === 'easyslip' ? 'EasySlip' : 'SlipOK'}, อ้างอิง ${request.refCode})`,
        createdAt: new Date().toISOString(),
      });
      request.status = 'approved';
      request.reviewedAt = new Date().toISOString();
      request.reviewNote = `ตรวจสอบและอนุมัติอัตโนมัติผ่าน ${provider === 'easyslip' ? 'EasySlip' : 'SlipOK'}`;
      store.save();
      req.flash('success', `ตรวจสอบสลิปสำเร็จ! เติมเงิน ${request.amount.toLocaleString()} บาทเข้ากระเป๋าเรียบร้อยแล้ว`);
    } else {
      store.save();
      if (result.checked) {
        req.flash('error', `ตรวจสอบสลิปอัตโนมัติไม่ผ่าน: ${request.slipCheck.message} — กรุณาตรวจสอบยอดเงิน/สลิปแล้วลองแนบใหม่อีกครั้ง`);
      } else {
        req.flash('success', 'แนบสลิปแล้ว กำลังรอระบบตรวจสอบ');
      }
    }
    res.redirect(`/account/topup/${request.id}`);
  });
});

router.get('/orders', (req, res) => {
  const user = currentUser(req);
  const orders = store.data.orders
    .filter(o => o.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.render('shop/orders', { title: 'คำสั่งซื้อของฉัน', orders });
});

router.get('/orders/:id', (req, res) => {
  const user = currentUser(req);
  const order = store.data.orders.find(o => o.id === req.params.id && o.userId === user.id);
  if (!order) return res.status(404).render('shop/404', { title: 'ไม่พบคำสั่งซื้อ' });
  const itemsWithCreds = order.items.map(oi => {
    const stockItem = store.data.stockItems.find(s => s.id === oi.stockItemId);
    return { ...oi, credentials: stockItem };
  });
  res.render('shop/order-detail', { title: `คำสั่งซื้อ #${order.id}`, order, itemsWithCreds });
});

module.exports = router;
