const express = require('express');
const router = express.Router();
const multer = require('multer');
const QRCode = require('qrcode');
const store = require('../data/store');
const slipok = require('../services/slipok');
const easyslip = require('../services/easyslip');
const promptpay = require('../services/promptpay');
const webhook = require('../services/webhook');
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

router.post('/topup', async (req, res) => {
  const user = currentUser(req);
  const amount = parseInt(req.body.amount, 10);
  const method = req.body.method === 'bank_transfer' ? 'bank_transfer' : 'promptpay';
  if (!amount || amount < 1) {
    req.flash('error', 'กรุณาระบุจำนวนเงินอย่างน้อย 1 บาท');
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
  // Must finish persisting before redirecting — on a tenant shop, the very
  // next request (GET /topup/:id) reloads this tenant's db fresh from
  // MongoDB, so an unawaited save() here is a race: that next request can
  // land before the write is committed and find the request missing,
  // silently bouncing back to /account/topup with no error shown.
  await store.save();
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

// The actual automated check against EasySlip/SlipOK can take anywhere up
// to several minutes if the provider is slow (see their configured
// timeouts) — the customer must never sit staring at a spinner waiting on
// a third-party API for that long. This runs AFTER the response has
// already been sent (see the route below), so it always needs its own
// bound tenant context — nothing here can rely on the original request's
// context still being current.
async function verifySlipInBackground({ requestId, userId, fileBuffer, fileOptions, origin }) {
  const request = store.data.topupRequests.find(t => t.id === requestId);
  const user = store.data.users.find(u => u.id === userId);
  if (!request || !user || request.status !== 'pending') return;

  const payment = store.data.settings.payment;
  let provider = null;
  let result;
  if (easyslip.isConfigured() && payment.easyslipAccounts && Object.keys(payment.easyslipAccounts).length) {
    provider = 'easyslip';
    const expectedNumbers = Object.values(payment.easyslipAccounts).map(a => a.bankNumber).filter(Boolean);
    result = await easyslip.verifySlip(fileBuffer, request.amount, fileOptions, expectedNumbers);
  } else {
    provider = 'slipok';
    result = await slipok.verifySlip(fileBuffer, request.amount, fileOptions, {
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
      note: `เติมเงินสำเร็จ (ตรวจสอบอัตโนมัติ, อ้างอิง ${request.refCode})`,
      createdAt: new Date().toISOString(),
    });
    request.status = 'approved';
    request.reviewedAt = new Date().toISOString();
    request.reviewNote = 'ตรวจสอบและอนุมัติอัตโนมัติ';
  }
  await store.save();

  // Links to the normal (login-required) admin approve page for now — a
  // no-login-needed one-click link is a separate, deliberately-held-back
  // change pending a decision on its security tradeoff.
  webhook.notifyTopup({
    webhookUrl: payment.topupWebhookUrl,
    username: user.username, email: user.email,
    amount: request.amount, refCode: request.refCode, method: request.method,
    slipUrl: request.slipPath ? origin + request.slipPath : null,
    autoApproved: verified,
    adminUrl: verified ? null : `${origin}/admin/topups`,
  }).catch(() => {});
}

router.post('/topup/:id/slip', (req, res) => {
  const user = currentUser(req);
  const request = store.data.topupRequests.find(t => t.id === req.params.id && t.userId === user.id);
  if (!request) return res.redirect('/account/topup');
  if (request.status !== 'pending') {
    req.flash('error', 'คำขอนี้ถูกตรวจสอบไปแล้ว ไม่สามารถแนบสลิปใหม่ได้');
    return res.redirect(`/account/topup/${request.id}`);
  }
  upload.single('slip')(req, res, store.bindTenantContext(async (err) => {
    if (err || !req.file) {
      req.flash('error', 'อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่ (รองรับไฟล์รูปภาพเท่านั้น ไม่เกิน 5MB)');
      return res.redirect(`/account/topup/${request.id}`);
    }
    try {
      request.slipPath = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      await store.save();
    } catch (saveError) {
      req.flash('error', 'บันทึกไฟล์สลิปไม่สำเร็จ กรุณาลองใหม่');
      return res.redirect(`/account/topup/${request.id}`);
    }

    req.flash('success', 'แนบสลิปแล้ว ระบบกำลังตรวจสอบอัตโนมัติเบื้องหลัง — รีเฟรชหน้านี้อีกครั้งในไม่กี่วินาทีเพื่อดูผล');
    res.redirect(`/account/topup/${request.id}`);

    const backgroundVerify = store.bindTenantContext(verifySlipInBackground);
    backgroundVerify({
      requestId: request.id, userId: user.id,
      fileBuffer: req.file.buffer,
      fileOptions: { filename: req.file.originalname, contentType: req.file.mimetype },
      origin: `${req.protocol}://${req.get('host')}`,
    }).catch((bgErr) => console.error('[topup] background verify failed:', bgErr.message));
  }));
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
