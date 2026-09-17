const express = require('express');
const router = express.Router();
const multer = require('multer');
const store = require('../data/store');
const slipok = require('../services/slipok');
const slipcheck = require('../services/slipcheck');
const rdcwSlip = require('../services/rdcw-slip');
const slip2go = require('../services/slip2go');
const xephtSlip = require('../services/xepht-slip');
const { effectiveSlipConfig, slipcheckCredentials } = require('../services/slip-config');
const { parseSlipDate } = require('../services/slip-fields');
const receiverProfiles = require('../services/receiver-profiles');
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
  const payment = store.data.settings.payment;
  res.render('shop/topup', { title: 'เติมเงิน', payment });
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
    const reserved = await store.transact((data) => {
      data.truemoneyRedemptions ||= [];
      if (data.walletTransactions.some(t => t.voucherCode === voucherCode)
        || data.truemoneyRedemptions.some(item => item.voucherCode === voucherCode && item.status !== 'failed')) return false;
      data.truemoneyRedemptions.push({
        voucherCode, userId: user.id, status: 'processing', createdAt: new Date().toISOString(),
      });
      return true;
    });
    if (!reserved) {
      req.flash('error', 'ซองของขวัญนี้ถูกใช้แล้วหรือกำลังอยู่ระหว่างการตรวจสอบ');
      return res.redirect('/account/topup');
    }

    const result = await truemoney.redeemAngpao(voucherInput, receiverPhone);

    if (!result.success || !Number.isFinite(result.amount) || result.amount <= 0) {
      await store.transact((data) => {
        const claim = (data.truemoneyRedemptions || []).find(item => item.voucherCode === voucherCode && item.status === 'processing');
        if (claim) { claim.status = 'failed'; claim.message = result.message || ''; claim.finishedAt = new Date().toISOString(); }
      });
      req.flash('error', result.message || 'ไม่สามารถรับเงินจากซองของขวัญนี้ได้');
      return res.redirect('/account/topup');
    }

    const amount = result.amount;
    const refCode = 'TM' + store.genId(6).toUpperCase();
    const topupRequestId = store.genId(10);
    const now = new Date().toISOString();

    await store.transact((data) => {
      if (data.walletTransactions.some(t => t.voucherCode === voucherCode)) {
        throw new Error('ซองของขวัญนี้ถูกบันทึกเข้าระบบแล้ว');
      }
      const claim = (data.truemoneyRedemptions || []).find(item => item.voucherCode === voucherCode && item.status === 'processing');
      if (!claim || claim.userId !== user.id) throw new Error('ไม่พบรายการรับซองที่กำลังดำเนินการ');
      const freshUser = data.users.find(u => u.id === user.id);
      if (!freshUser) throw new Error('ไม่พบบัญชีผู้ใช้');
      freshUser.walletBalance = Math.round(((Number(freshUser.walletBalance) || 0) + amount) * 100) / 100;
      data.walletTransactions.push({
        id: store.genId(10), userId: freshUser.id, type: 'topup', amount, voucherCode,
        note: `เติมเงินผ่านซอง TrueMoney (ผู้ส่ง: ${result.senderName || 'ไม่ระบุ'}, อ้างอิง ${refCode})`, createdAt: now,
      });
      data.topupRequests.push({
        id: topupRequestId, userId: freshUser.id, amount, method: 'truemoney_angpao', refCode,
        slipPath: null,
        slipCheck: { checked: true, verified: true, message: `ซองของขวัญสำเร็จ (ผู้ส่ง: ${result.senderName || '-'})`, provider: 'truemoney_angpao' },
        status: 'approved', createdAt: now, reviewedAt: now,
        reviewNote: `ซอง TrueMoney ตรวจสอบและอนุมัติอัตโนมัติ (ผู้ส่ง: ${result.senderName || '-'})`,
      });
      claim.status = 'approved';
      claim.amount = amount;
      claim.finishedAt = now;
    });

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
    res.redirect(`/account/topup/${topupRequestId}`);
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
  const created = await createTopupRequest({ user, amount: req.body.amount, method: req.body.method });
  if (!created.ok) {
    req.flash('error', created.error);
    return res.redirect('/account/topup');
  }
  res.redirect(`/account/topup/${created.request.id}`);
});

router.get('/topup/:id', async (req, res) => {
  const user = currentUser(req);
  const request = store.data.topupRequests.find(t => t.id === req.params.id && t.userId === user.id);
  if (!request) return res.redirect('/account/topup');

  const payment = store.data.settings.payment;
  res.render('shop/topup-detail', {
    title: 'สถานะการเติมเงิน', request, payment,
    automaticSlipCheck: canCheckSlipAutomatically(payment),
  });
});

router.get('/topup/:id/status', (req, res) => {
  const user = currentUser(req);
  const request = store.data.topupRequests.find(t => t.id === req.params.id && t.userId === user.id);
  if (!request) return res.status(404).json({ ok: false, error: 'ไม่พบคำขอนี้' });

  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    ok: true,
    status: request.status,
    finished: request.status !== 'verifying',
    approved: request.status === 'approved',
    message: request.slipCheck?.message || '',
  });
});

router.get('/topup/:id/slip-file', async (req, res, next) => {
  try {
    const user = currentUser(req);
    const request = store.data.topupRequests.find(t => t.id === req.params.id);
    if (!request || (user.role !== 'admin' && request.userId !== user.id) || !request.slipStorageId) {
      return res.sendStatus(404);
    }
    const media = await store.getPrivateMedia(request.slipStorageId);
    if (!media) return res.sendStatus(404);
    res.setHeader('Content-Type', media.file.metadata?.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', media.file.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    media.stream.on('error', next).pipe(res);
  } catch (err) {
    next(err);
  }
});

// The actual automated slip check can take anywhere up
// to several minutes if the provider is slow (see their configured
// timeouts) — the customer must never sit staring at a spinner waiting on
// a third-party API for that long. This runs AFTER the response has
// already been sent (see the route below), so it always needs its own
// bound tenant context — nothing here can rely on the original request's
// context still being current.
const activeVerifications = new Set();

function receiverCredentials(payment = {}, method = 'bank_transfer', ...fallbackPayments) {
  // The storefront renders the active flat payment settings, while provider
  // switching also keeps a provider-specific snapshot. Include both sources
  // from this same shop so verification always checks the account the customer
  // was actually shown, even when an older provider snapshot is stale.
  return receiverProfiles.credentials(method, payment, ...fallbackPayments);
}

function canCheckSlipAutomatically(payment = {}) {
  const effective = effectiveSlipConfig(payment, store.platformData.settings.payment, store.isTenantContext());
  const selected = resolveSlipProvider(effective);
  const receiverPayment = receiverProfiles.view(payment, selected);
  const receiver = receiverCredentials(receiverPayment, 'bank_transfer', payment);
  const hasReceiver = Boolean(receiver.expectedReceiverNames.length || receiver.expectedReceiverNumbers.length);
  if (selected === 'slipok') return Boolean(effective.slipokBranchId && effective.slipokApiKey);
  if (selected === 'slipcheck') return Boolean((effective.slipcheckApiKey || (store.isTenantContext() ? false : (effective.slipcheckApiKeys || []).length)) && hasReceiver);
  if (selected === 'rdcw') return Boolean(effective.rdcwClientId && effective.rdcwClientSecret && hasReceiver);
  if (selected === 'slip2go') return Boolean(effective.slip2goApiKey && hasReceiver);
  if (selected === 'xepht') return Boolean(hasReceiver);
  return false;
}

async function verifySlipInBackground({ requestId, userId, fileBuffer, fileOptions, origin, retryStored = false }) {
  if (activeVerifications.has(requestId)) return;
  activeVerifications.add(requestId);

  try {
    const request = store.data.topupRequests.find(t => t.id === requestId);
    const user = store.data.users.find(u => u.id === userId);
    if (!request || !user || request.status === 'approved' || request.status === 'rejected') return;

    const payment = store.data.settings.payment;
    const effective = effectiveSlipConfig(payment, store.platformData.settings.payment, store.isTenantContext());
    let provider = null;
    let result;

    const selectedProvider = resolveSlipProvider(effective);
    const receiverPayment = receiverProfiles.view(payment, selectedProvider);

    if (selectedProvider === 'slipok') {
      provider = 'slipok';
      result = await slipok.verifySlip(fileBuffer, request.amount, fileOptions, {
        branchId: effective.slipokBranchId,
        apiKey: effective.slipokApiKey,
      });
    } else if (selectedProvider === 'slipcheck') {
      provider = 'slipcheck';
      const expectedReceiver = receiverCredentials(receiverPayment, request.method, payment);
      result = await slipcheck.verifySlip(fileBuffer, request.amount, fileOptions, {
        ...slipcheckCredentials(effective),
        ...expectedReceiver,
      });
    } else if (selectedProvider === 'rdcw') {
      provider = 'rdcw';
      result = await rdcwSlip.verifySlip(fileBuffer, request.amount, fileOptions, {
        clientId: effective.rdcwClientId,
        clientSecret: effective.rdcwClientSecret,
        endpoint: effective.rdcwEndpoint,
        ...receiverCredentials(receiverPayment, request.method, payment),
      });
    } else if (selectedProvider === 'slip2go') {
      provider = 'slip2go';
      result = await slip2go.verifySlip(fileBuffer, request.amount, fileOptions, {
        apiKey: effective.slip2goApiKey,
        endpoint: effective.slip2goEndpoint,
        ...receiverCredentials(receiverPayment, request.method, payment),
      });
    } else if (selectedProvider === 'xepht') {
      provider = 'xepht';
      result = await xephtSlip.verifySlip(fileBuffer, request.amount, fileOptions, {
        apiKey: effective.xephtApiKey,
        endpoint: effective.xephtEndpoint,
        ...receiverCredentials(receiverPayment, request.method, payment),
      });
    } else {
      provider = selectedProvider;
      result = { checked: false, verified: false, message: 'รอแอดมินตรวจสอบสลิป', raw: null };
    }
    let verified = result.checked && result.verified;
    const raw = result.raw;
    // Normalize the transaction reference + timestamp across providers —
    // Providers may nest transfer references or return them flat.
    const transRef = raw && (raw.transRef || (raw.rawSlip && raw.rawSlip.transRef)) || null;
    const transTime = raw && (
      parseSlipDate(raw.rawSlip && raw.rawSlip.date)
      || parseSlipDate(raw.date)
      || slipok.parseTransDateTime(raw.transDate, raw.transTime)
    );

    if (verified) {
      const slipAge = transTime && !Number.isNaN(transTime.getTime()) ? Date.now() - transTime.getTime() : null;
      const requestCreatedAt = new Date(request.createdAt).getTime();
      const retryTimeInvalid = retryStored && (slipAge === null || transTime.getTime() < requestCreatedAt - (5 * 60 * 1000) || slipAge < -2 * 60 * 1000);
      const initialTimeInvalid = !retryStored && (slipAge === null || slipAge > 5 * 60 * 1000 || slipAge < -2 * 60 * 1000);
      if (retryTimeInvalid || initialTimeInvalid) {
        verified = false;
        result.message = 'เวลาในสลิปไม่อยู่ในช่วงที่ยอมรับได้ กรุณาแนบสลิปล่าสุด';
      } else if (!transRef) {
        verified = false;
        result.message = 'ไม่พบเลขอ้างอิงธุรกรรม — รอแอดมินตรวจสอบ';
      } else if (!(await store.claimGlobalSlipRef(transRef, { source: 'main-site', requestId }))) {
        verified = false;
        result.message = 'สลิปนี้เคยถูกใช้เติมเงินไปแล้ว ไม่สามารถใช้ซ้ำได้';
      }
    }

    let finalRequest;
    const applied = await store.transact((data) => {
      const freshRequest = data.topupRequests.find(t => t.id === requestId);
      const freshUser = data.users.find(u => u.id === userId);
      if (!freshRequest || !freshUser || freshRequest.status === 'approved' || freshRequest.status === 'rejected') return false;
      freshRequest.slipCheck = {
        checked: result.checked,
        verified: result.verified,
        quotaExhausted: Boolean(result.quotaExhausted),
        rateLimited: Boolean(result.rateLimited),
        quotaMismatch: Boolean(result.quotaMismatch),
        retryable: Boolean(result.retryable),
        retryAttempts: 0,
        providerCode: result.providerCode || null,
        httpStatus: result.httpStatus || null,
        message: result.message,
        provider,
        transRef,
        checkedAt: new Date().toISOString(),
      };
      freshRequest.slipCheck.verified = verified;
      if (verified) {
        freshUser.walletBalance = Math.round(((Number(freshUser.walletBalance) || 0) + freshRequest.amount) * 100) / 100;
        data.walletTransactions.push({
          id: store.genId(10), userId: freshUser.id, type: 'topup', amount: freshRequest.amount,
          note: `เติมเงินสำเร็จ (ตรวจสอบอัตโนมัติ, อ้างอิง ${freshRequest.refCode})`, createdAt: new Date().toISOString(),
        });
        freshRequest.status = 'approved';
        freshRequest.reviewedAt = new Date().toISOString();
        freshRequest.reviewNote = 'ตรวจสอบและอนุมัติอัตโนมัติ';
      } else {
        freshRequest.status = 'pending';
      }
      finalRequest = freshRequest;
      return true;
    });
    if (!applied) return;

    // Links to the normal (login-required) admin approve page for now — a
    // no-login-needed one-click link is a separate, deliberately-held-back
    // change pending a decision on its security tradeoff.
    webhook.notifyTopup({
      webhookUrl: payment.topupWebhookUrl,
      username: user.username, email: user.email,
      amount: finalRequest.amount, refCode: finalRequest.refCode, method: finalRequest.method,
      slipUrl: null,
      autoApproved: verified,
      adminUrl: verified ? null : `${origin}/admin/topups`,
    }).catch(() => {});
  } catch (err) {
    console.error('[topup] background verify failed:', err.message);
    await store.transact((data) => {
      const request = data.topupRequests.find(t => t.id === requestId);
      if (request && request.status === 'verifying') {
        request.status = 'pending';
        request.slipCheck = { checked: false, verified: false, message: 'ระบบตรวจสลิปขัดข้องชั่วคราว อยู่ระหว่างรอแอดมินตรวจสอบ' };
      }
    }).catch(saveErr => console.error('[topup] could not persist verification failure:', saveErr.message));
  } finally {
    await store.transact((data) => {
      const request = data.topupRequests.find(t => t.id === requestId);
      if (request && request.status === 'verifying') request.status = 'pending';
    }).catch(saveErr => console.error('[topup] could not finalize verification:', saveErr.message));
    activeVerifications.delete(requestId);
  }
}

// Shared with src/routes/internal-api.js (the separate rent-app calls
// these two instead of re-implementing topup + slip verification itself)
// so there is exactly one place that creates a topup request and exactly
// one place that kicks off slip verification.
async function createTopupRequest({ user, amount, method }) {
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  const mth = String(method || 'bank_transfer');
  if (mth !== 'bank_transfer') {
    return { ok: false, error: 'ระบบรับชำระผ่านบัญชีธนาคารเท่านั้น' };
  }
  if (!Number.isFinite(amt) || amt < 1) {
    return { ok: false, error: 'กรุณาระบุจำนวนเงินอย่างน้อย 1 บาท' };
  }
  const request = {
    id: store.genId(10), userId: user.id, amount: amt, method: mth,
    refCode: 'TU' + store.genId(6).toUpperCase(),
    slipPath: null, slipCheck: null, status: 'pending',
    createdAt: new Date().toISOString(), reviewedAt: null, reviewNote: '',
  };
  await store.transact((data) => data.topupRequests.push(request));
  return { ok: true, request };
}

async function attachSlipToTopupRequest({ requestId, user, fileBuffer, fileOptions, origin }) {
  const request = store.data.topupRequests.find(t => t.id === requestId && t.userId === user.id);
  if (!request) return { ok: false, error: 'ไม่พบคำขอนี้' };
  if (request.status === 'approved' || request.status === 'rejected') {
    return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  }
  if (activeVerifications.has(request.id)) {
    return { ok: false, error: 'คำขอนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่' };
  }
  try {
    const storageId = await store.savePrivateMedia(fileBuffer, fileOptions.filename, fileOptions.contentType);
    const automatic = canCheckSlipAutomatically(store.data.settings.payment);
    await store.transact((data) => {
      const fresh = data.topupRequests.find(t => t.id === requestId && t.userId === user.id);
      if (!fresh || fresh.status === 'approved' || fresh.status === 'rejected') throw new Error('คำขอนี้ถูกตรวจสอบแล้ว');
      fresh.slipStorageId = storageId;
      fresh.slipPath = `/account/topup/${fresh.id}/slip-file`;
      fresh.status = automatic ? 'verifying' : 'pending';
      if (!automatic) fresh.slipCheck = { checked: false, verified: false, message: 'รอแอดมินตรวจสอบสลิป', provider: 'manual' };
    });
    request.slipStorageId = storageId;
    request.slipPath = `/account/topup/${request.id}/slip-file`;
    request.status = automatic ? 'verifying' : 'pending';
    if (!automatic) request.slipCheck = { checked: false, verified: false, message: 'รอแอดมินตรวจสอบสลิป', provider: 'manual' };
    if (!automatic) return { ok: true, request, automatic: false };
  } catch (saveError) {
    request.status = 'pending';
    return { ok: false, error: 'บันทึกไฟล์สลิปไม่สำเร็จ กรุณาลองใหม่' };
  }
  const backgroundVerify = store.bindTenantContext(verifySlipInBackground);
  backgroundVerify({ requestId: request.id, userId: user.id, fileBuffer, fileOptions, origin })
    .catch((bgErr) => console.error('[topup] background verify failed:', bgErr.message));
  return { ok: true, request, automatic: true };
}

async function retryTopupSlipVerification({ requestId, origin }) {
  const request = store.data.topupRequests.find(t => t.id === requestId);
  const user = request && store.data.users.find(u => u.id === request.userId);
  if (!request || !user || !request.slipStorageId) return { ok: false, error: 'ไม่พบสลิปของรายการนี้' };
  if (request.status === 'approved' || request.status === 'rejected') return { ok: false, error: 'รายการนี้ถูกดำเนินการแล้ว' };
  if (activeVerifications.has(request.id)) return { ok: false, error: 'รายการนี้กำลังตรวจสอบอยู่' };
  const media = await store.getPrivateMedia(request.slipStorageId);
  if (!media) return { ok: false, error: 'ไม่พบไฟล์สลิปที่บันทึกไว้' };
  const chunks = [];
  for await (const chunk of media.stream) chunks.push(Buffer.from(chunk));
  await store.transact((data) => {
    const fresh = data.topupRequests.find(t => t.id === requestId);
    if (fresh && fresh.status === 'pending') fresh.status = 'verifying';
  });
  await verifySlipInBackground({
    requestId: request.id,
    userId: user.id,
    fileBuffer: Buffer.concat(chunks),
    fileOptions: { filename: media.file.filename || media.file.metadata?.filename || 'slip.jpg', contentType: media.file.metadata?.contentType || 'image/jpeg' },
    origin,
    retryStored: true,
  });
  return { ok: true };
}

router.post('/topup/:id/retry-slip', async (req, res) => {
  const user = currentUser(req);
  const request = store.data.topupRequests.find(t => t.id === req.params.id && t.userId === user.id);
  if (!request) return res.redirect('/account/topup');
  const result = await retryTopupSlipVerification({ requestId: request.id, origin: `${req.protocol}://${req.get('host')}` });
  req.flash(result.ok ? 'success' : 'error', result.ok ? 'ส่งสลิปเดิมไปตรวจอีกครั้งแล้ว' : result.error);
  res.redirect(`/account/topup/${request.id}`);
});

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
    const attached = await attachSlipToTopupRequest({
      requestId: request.id, user,
      fileBuffer: req.file.buffer,
      fileOptions: { filename: req.file.originalname, contentType: req.file.mimetype },
      origin: `${req.protocol}://${req.get('host')}`,
    });
    if (!attached.ok) {
      req.flash('error', attached.error);
      return res.redirect(`/account/topup/${request.id}`);
    }

    req.flash('success', attached.automatic
      ? 'แนบสลิปแล้ว ระบบกำลังตรวจสอบอัตโนมัติและจะแสดงผลให้ทันที ไม่ต้องรีเฟรชหน้า'
      : 'แนบสลิปแล้ว อยู่ระหว่างรอแอดมินตรวจสอบ');
    res.redirect(`/account/topup/${request.id}`);

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
    const product = store.data.products.find(p => p.id === oi.productId);
    const stockItem = store.data.stockItems.find(s => s.id === oi.stockItemId);
    return {
      ...oi,
      credentials: stockItem,
      productTitle: oi.title || product?.title || 'สินค้า',
      productImage: oi.productImage || product?.images?.[0] || '',
    };
  });
  res.render('shop/order-detail', { title: `คำสั่งซื้อ #${order.id}`, order, itemsWithCreds });
});

module.exports = router;
// Attached to the router function object (functions are objects in JS) so
// the internal API can reuse this exact logic without a second import path.
router.createTopupRequest = createTopupRequest;
router.attachSlipToTopupRequest = attachSlipToTopupRequest;
router.retryTopupSlipVerification = retryTopupSlipVerification;
