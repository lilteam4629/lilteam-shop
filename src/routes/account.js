const express = require('express');
const router = express.Router();
const multer = require('multer');
const QRCode = require('qrcode');
const store = require('../data/store');
const slipok = require('../services/slipok');
const easyslip = require('../services/easyslip');
const promptpay = require('../services/promptpay');
const webhook = require('../services/webhook');
const truemoney = require('../services/truemoney');
const { resolveSlipProvider } = require('../services/slip-provider');
const discordBot = require('../services/discord-bot');
const { requireLogin, currentUser } = require('../middleware/auth');

router.use(requireLogin);

const path = require('path');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowed.includes(ext) || file.mimetype === 'image/svg+xml' || !/^image\//.test(file.mimetype)) {
      return cb(null, false);
    }
    cb(null, true);
  },
});

const truemoneyRedemptionLocks = new Set();

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

router.post('/topup/truemoney', async (req, res) => {
  const user = currentUser(req);
  const voucherInput = String(req.body.voucherLink || req.body.voucherCode || '').trim();
  const payment = store.data.settings.payment;

  if (!payment.truemoneyEnabled) {
    req.flash('error', 'ระบบเติมเงินผ่านซองของขวัญ TrueMoney ปิดให้บริการชั่วคราว');
    return res.redirect('/account/topup');
  }

  const receiverPhone = payment.truemoneyPhone ? payment.truemoneyPhone.trim() : '';
  if (!receiverPhone || receiverPhone.length !== 10) {
    req.flash('error', 'ทางร้านยังไม่ได้ตั้งค่าเบอร์รับเงิน TrueMoney กรุณาติดต่อผู้ดูแลร้าน');
    return res.redirect('/account/topup');
  }

  const voucherCode = truemoney.extractVoucherCode(voucherInput);
  if (!voucherCode) {
    req.flash('error', 'กรุณากรอกลิงก์ซองของขวัญ TrueMoney ให้ถูกต้อง');
    return res.redirect('/account/topup');
  }

  if (truemoneyRedemptionLocks.has(voucherCode)) {
    req.flash('error', 'ซองของขวัญนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่');
    return res.redirect('/account/topup');
  }

  const alreadyUsed = store.data.walletTransactions.some(t => t.voucherCode === voucherCode);
  if (alreadyUsed) {
    req.flash('error', 'ซองของขวัญนี้ถูกใช้งานในระบบแล้ว');
    return res.redirect('/account/topup');
  }

  truemoneyRedemptionLocks.add(voucherCode);

  try {
    const result = await truemoney.redeemAngpao(voucherInput, receiverPhone);

    if (!result.success || !result.amount || result.amount <= 0) {
      req.flash('error', result.message || 'ไม่สามารถรับเงินจากซองของขวัญนี้ได้');
      return res.redirect('/account/topup');
    }

    const amount = result.amount;
    const refCode = 'TM' + store.genId(6).toUpperCase();
    const now = new Date().toISOString();

    user.walletBalance = Math.round(((Number(user.walletBalance) || 0) + amount) * 100) / 100;

    store.data.walletTransactions.push({
      id: store.genId(10),
      userId: user.id,
      type: 'topup',
      amount,
      voucherCode,
      note: `เติมเงินผ่านซอง TrueMoney (ผู้ส่ง: ${result.senderName || 'ไม่ระบุ'}, อ้างอิง ${refCode})`,
      createdAt: now,
    });

    store.data.topupRequests.push({
      id: store.genId(10),
      userId: user.id,
      amount,
      method: 'truemoney_angpao',
      refCode,
      slipPath: null,
      slipCheck: { checked: true, verified: true, message: `ซองของขวัญสำเร็จ (ผู้ส่ง: ${result.senderName || '-'})`, provider: 'truemoney_angpao' },
      status: 'approved',
      createdAt: now,
      reviewedAt: now,
      reviewNote: `ซอง TrueMoney ตรวจสอบและอนุมัติอัตโนมัติ (ผู้ส่ง: ${result.senderName || '-'})`,
    });

    await store.save();

    const origin = `${req.protocol}://${req.get('host')}`;
    webhook.notifyTopup({
      webhookUrl: payment.topupWebhookUrl,
      username: user.username,
      email: user.email,
      amount,
      refCode,
      method: 'truemoney_angpao',
      slipUrl: null,
      autoApproved: true,
      adminUrl: null,
    }).catch(() => {});

    discordBot.notifyNewTopup({
      username: user.username,
      amount,
      refCode,
      method: 'ซองของขวัญ TrueMoney',
    }).catch(() => {});

    req.flash('success', `🧧 เติมเงินสำเร็จ! ได้รับ ฿${amount.toLocaleString()} เข้ากระเป๋าเรียบร้อยแล้ว`);
    res.redirect('/account');
  } catch (err) {
    console.error('[TrueMoney Redeem Error]', err);
    req.flash('error', 'เกิดข้อผิดพลาดในการตรวจสอบซองของขวัญ กรุณาลองใหม่อีกครั้ง');
    res.redirect('/account/topup');
  } finally {
    truemoneyRedemptionLocks.delete(voucherCode);
  }
});

router.post('/topup', async (req, res) => {
  const user = currentUser(req);
  const rawAmount = parseFloat(req.body.amount);
  const amount = Math.round((Number(rawAmount) || 0) * 100) / 100;
  const method = req.body.method === 'bank_transfer' ? 'bank_transfer' : 'promptpay';
  if (!Number.isFinite(amount) || amount < 1) {
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
const activeVerifications = new Set();

async function verifySlipInBackground({ requestId, userId, fileBuffer, fileOptions, origin }) {
  if (activeVerifications.has(requestId)) return;
  activeVerifications.add(requestId);

  try {
    const request = store.data.topupRequests.find(t => t.id === requestId);
    const user = store.data.users.find(u => u.id === userId);
    if (!request || !user || request.status === 'approved' || request.status === 'rejected') return;

    const payment = store.data.settings.payment;
    let provider = null;
    let result;

    const selectedProvider = resolveSlipProvider(payment, easyslip.isConfigured());

    if (selectedProvider === 'easyslip' && easyslip.isConfigured() && payment.easyslipAccounts && Object.keys(payment.easyslipAccounts).length) {
      provider = 'easyslip';
      const expectedNumbers = Object.values(payment.easyslipAccounts).map(a => a.bankNumber).filter(Boolean);
      result = await easyslip.verifySlip(fileBuffer, request.amount, fileOptions, expectedNumbers);
    } else if (selectedProvider === 'slipok') {
      provider = 'slipok';
      result = await slipok.verifySlip(fileBuffer, request.amount, fileOptions, {
        branchId: payment.slipokBranchId,
        apiKey: payment.slipokApiKey,
      });
    } else {
      provider = selectedProvider;
      result = { checked: false, verified: false, message: 'รอแอดมินตรวจสอบสลิป', raw: null };
    }
    // An admin may approve/reject while the provider request is in flight.
    if (request.status === 'approved' || request.status === 'rejected') return;
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
      user.walletBalance = Math.round(((Number(user.walletBalance) || 0) + request.amount) * 100) / 100;
      store.data.walletTransactions.push({
        id: store.genId(10), userId: user.id, type: 'topup', amount: request.amount,
        note: `เติมเงินสำเร็จ (ตรวจสอบอัตโนมัติ, อ้างอิง ${request.refCode})`,
        createdAt: new Date().toISOString(),
      });
      request.status = 'approved';
      request.reviewedAt = new Date().toISOString();
      request.reviewNote = 'ตรวจสอบและอนุมัติอัตโนมัติ';
    } else {
      request.status = 'pending';
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
  } catch (err) {
    console.error('[topup] background verify failed:', err.message);
    const request = store.data.topupRequests.find(t => t.id === requestId);
    if (request && request.status === 'verifying') {
      request.status = 'pending';
      request.slipCheck = { checked: false, verified: false, message: 'ระบบตรวจสลิปขัดข้องชั่วคราว อยู่ระหว่างรอแอดมินตรวจสอบ' };
      await store.save();
    }
  } finally {
    const request = store.data.topupRequests.find(t => t.id === requestId);
    if (request && request.status === 'verifying') {
      request.status = 'pending';
      await store.save();
    }
    activeVerifications.delete(requestId);
  }
}

router.post('/topup/:id/slip', (req, res) => {
  const user = currentUser(req);
  const request = store.data.topupRequests.find(t => t.id === req.params.id && t.userId === user.id);
  if (!request) return res.redirect('/account/topup');
  if (request.status === 'approved' || request.status === 'rejected') {
    req.flash('error', 'คำขอนี้ถูกตรวจสอบไปแล้ว');
    return res.redirect(`/account/topup/${request.id}`);
  }
  if (activeVerifications.has(request.id)) {
    req.flash('error', 'คำขอนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่');
    return res.redirect(`/account/topup/${request.id}`);
  }
  upload.single('slip')(req, res, store.bindTenantContext(async (err) => {
    if (err || !req.file) {
      req.flash('error', 'อัปโหลดสลิปไม่สำเร็จ (รองรับไฟล์รูปภาพ JPG, PNG, WEBP ขนาดไม่เกิน 5MB)');
      return res.redirect(`/account/topup/${request.id}`);
    }
    try {
      request.slipPath = await store.saveMedia(req.file.buffer, req.file.originalname, req.file.mimetype);
      request.status = 'verifying';
      await store.save();
    } catch (saveError) {
      request.status = 'pending';
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
