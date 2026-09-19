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
const { publicSlipMessage } = require('../services/public-slip');
const discordBot = require('../services/discord-bot');
const { requireLogin, currentUser } = require('../middleware/auth');

router.use(requireLogin);

// Normal tenant top-ups always use that shop's own receiving account. The
// platform account is selected only for an explicitly marked API top-up.
function settlementPayment({ catalogApiTopup = false } = {}) {
  const source = catalogApiTopup ? store.platformData : store.data;
  return source?.settings?.payment || {};
}

// Partner/API top-ups are owned by the platform even when the customer is
// browsing a rented shop.  Keep the request on the platform queue so the
// main-shop owner can review it, while retaining the tenant user identity for
// the wallet credit that follows approval.
function isPartnerTopup(request) {
  return Boolean(request?.catalogApiTopup && request?.tenantShopId);
}

function withTopupStore(request, callback) {
  return isPartnerTopup(request) ? store.runOnPlatform(callback) : callback();
}

function findTopupRequestForUser(requestId, userId) {
  const local = store.data.topupRequests.find(item => item.id === requestId && item.userId === userId);
  if (local) return local;
  if (!store.isTenantContext()) return null;
  const tenantId = store.currentTenantId ? String(store.currentTenantId()) : '';
  return store.platformData.topupRequests.find(item => isPartnerTopup(item)
    && (!tenantId || String(item.tenantShopId) === tenantId)
    && (item.tenantUserId || item.userId) === userId && item.id === requestId);
}

async function findTopupActor(request, fallbackUserId) {
  const userId = request?.tenantUserId || request?.userId || fallbackUserId;
  if (request?.tenantShopId) {
    const tenantDb = await store.loadTenantDb(request.tenantShopId);
    const user = tenantDb?.users?.find(item => item.id === userId);
    return { user, tenantDb, userId };
  }
  return { user: store.data.users.find(item => item.id === userId), tenantDb: null, userId };
}

// Credit a catalog wallet exactly once.  The transaction marker is stored in
// the tenant wallet transaction so automatic verification and manual approval
// can safely retry after a provider/network timeout without double crediting.
async function creditCatalogTopup(request) {
  if (!request?.catalogApiTopup) return { ok: false, error: 'ไม่ใช่คำขอเติมเงินสินค้า API' };
  const targetUserId = request.tenantUserId || request.userId;
  if (request.tenantShopId) {
    const tenantDb = await store.loadTenantDb(request.tenantShopId);
    if (!tenantDb) return { ok: false, error: 'ไม่พบข้อมูลร้านเช่าสำหรับเติมเงินสินค้า API' };
    return store.runInTenant(request.tenantShopId, tenantDb, () => store.transact(data => {
      data.walletTransactions ||= [];
      const user = data.users.find(item => item.id === targetUserId);
      if (!user) return { ok: false, error: 'ไม่พบบัญชีลูกค้าในร้านเช่า' };
      const already = data.walletTransactions.find(item => item.topupRequestId === request.id);
      if (already) return { ok: true, alreadyCredited: true, user };
      const amount = Math.round((Number(request.amount) || 0) * 100) / 100;
      user.catalogWalletBalance = Math.round(((Number(user.catalogWalletBalance) || 0) + amount) * 100) / 100;
      data.walletTransactions.push({
        id: store.genId(10), userId: user.id, type: 'catalog-topup', catalogApiTopup: true,
        amount, topupRequestId: request.id, tenantShopId: String(request.tenantShopId),
        note: `เติมเงินสินค้า API สำเร็จ (ร้านหลัก, อ้างอิง ${request.refCode})`, createdAt: new Date().toISOString(),
      });
      return { ok: true, alreadyCredited: false, user };
    }));
  }
  return store.transact(data => {
    data.walletTransactions ||= [];
    const user = data.users.find(item => item.id === targetUserId);
    if (!user) return { ok: false, error: 'ไม่พบบัญชีผู้ใช้' };
    const already = data.walletTransactions.find(item => item.topupRequestId === request.id);
    if (already) return { ok: true, alreadyCredited: true, user };
    const amount = Math.round((Number(request.amount) || 0) * 100) / 100;
    user.catalogWalletBalance = Math.round(((Number(user.catalogWalletBalance) || 0) + amount) * 100) / 100;
    data.walletTransactions.push({
      id: store.genId(10), userId: user.id, type: 'catalog-topup', catalogApiTopup: true,
      amount, topupRequestId: request.id,
      note: `เติมเงินสินค้า API สำเร็จ (อ้างอิง ${request.refCode})`, createdAt: new Date().toISOString(),
    });
    return { ok: true, alreadyCredited: false, user };
  });
}

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

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Mongo optimistic writes can lose a race with another wallet request. A
// redeemed voucher must never be left uncredited just because that write
// briefly conflicted, so retry the whole mutation before returning an error.
async function transactWithRetry(mutator, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await store.transact(mutator);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait(150 * (attempt + 1));
    }
  }
  throw lastError;
}

async function reserveTrueMoneyClaim(voucherCode, userId) {
  return transactWithRetry(data => {
    data.truemoneyRedemptions ||= [];
    data.walletTransactions ||= [];
    if (data.walletTransactions.some(t => t.voucherCode === voucherCode)) return { alreadyCredited: true };
    const existing = data.truemoneyRedemptions.find(item => item.voucherCode === voucherCode);
    // A voucher claim is permanently owned by the user who first submitted
    // it. Even a failed/network-error claim must never be re-assigned to a
    // different account, otherwise a later retry could credit the wrong user
    // after the voucher has already been redeemed.
    if (existing && existing.userId !== userId) return null;
    if (existing && existing.status === 'approved') return { alreadyCredited: true };
    if (existing) {
      existing.userId = userId;
      existing.status = 'processing';
      existing.message = '';
      existing.updatedAt = new Date().toISOString();
      return { retryExisting: true, amount: Number(existing.amount) || 0, senderName: existing.senderName || '', providerBase: existing.providerBase || '' };
    }
    data.truemoneyRedemptions.push({ voucherCode, userId, status: 'processing', createdAt: new Date().toISOString() });
    return { retryExisting: false, amount: 0, senderName: '', providerBase: '' };
  });
}

async function rememberTrueMoneyResult(voucherCode, userId, result) {
  return transactWithRetry(data => {
    const claim = (data.truemoneyRedemptions || []).find(item => item.voucherCode === voucherCode && item.userId === userId);
    if (!claim || claim.status === 'approved') return;
    claim.amount = Math.round(Number(result.amount) * 100) / 100;
    claim.senderName = result.senderName || '';
    claim.providerBase = result.providerBase || claim.providerBase || '';
    claim.providerStatus = result.recovered ? 'TARGET_USER_REDEEMED' : 'SUCCESS';
    claim.redeemedAt = claim.redeemedAt || new Date().toISOString();
    claim.updatedAt = new Date().toISOString();
  });
}

async function rememberTrueMoneyProvider(voucherCode, userId, providerBase) {
  if (!providerBase) return;
  await transactWithRetry(data => {
    const claim = (data.truemoneyRedemptions || []).find(item => item.voucherCode === voucherCode && item.userId === userId);
    if (claim && !claim.providerBase) {
      claim.providerBase = providerBase;
      claim.updatedAt = new Date().toISOString();
    }
  });
}

async function markTrueMoneyClaimFailed(voucherCode, userId, message) {
  await transactWithRetry(data => {
    const claim = (data.truemoneyRedemptions || []).find(item => item.voucherCode === voucherCode && item.userId === userId && item.status === 'processing');
    if (claim) { claim.status = 'failed'; claim.message = message || ''; claim.finishedAt = new Date().toISOString(); }
  });
}

async function creditTrueMoneyClaim({ voucherCode, userId, result }) {
  const amount = Math.round(Number(result.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('จำนวนเงินในซองไม่ถูกต้อง');
  const refCode = 'TM' + store.genId(6).toUpperCase();
  const topupRequestId = store.genId(10);
  const now = new Date().toISOString();
  const creditResult = await transactWithRetry(data => {
    data.truemoneyRedemptions ||= [];
    data.walletTransactions ||= [];
    data.topupRequests ||= [];
    data.users ||= [];
    if (data.walletTransactions.some(t => t.voucherCode === voucherCode)) return { alreadyCredited: true, id: null, refCode: null };
    const claim = (data.truemoneyRedemptions || []).find(item => item.voucherCode === voucherCode && item.userId === userId);
    if (!claim) throw new Error('ไม่พบรายการรับซองที่กำลังดำเนินการ');
    if (claim.status === 'approved') return { alreadyCredited: true, id: claim.topupRequestId || null, refCode: claim.refCode || null };
    const freshUser = data.users.find(u => u.id === userId);
    if (!freshUser) throw new Error('ไม่พบบัญชีผู้ใช้');
    freshUser.walletBalance = Math.round(((Number(freshUser.walletBalance) || 0) + amount) * 100) / 100;
    data.walletTransactions.push({
      id: store.genId(10), userId: freshUser.id, type: 'topup', amount, voucherCode,
      note: `เติมเงินผ่านซอง TrueMoney (ผู้ส่ง: ${result.senderName || claim.senderName || 'ไม่ระบุ'}, อ้างอิง ${refCode})`, createdAt: now,
    });
    data.topupRequests.push({
      id: topupRequestId, userId: freshUser.id, amount, method: 'truemoney_angpao', voucherCode, refCode,
      slipPath: null,
      slipCheck: { checked: true, verified: true, message: `ซองของขวัญสำเร็จ (ผู้ส่ง: ${result.senderName || claim.senderName || '-'})`, provider: 'truemoney_angpao' },
      status: 'approved', createdAt: now, reviewedAt: now,
      reviewNote: `ซอง TrueMoney ตรวจสอบและอนุมัติอัตโนมัติ${result.recovered ? ' (กู้คืนรายการที่รับเงินแล้ว)' : ''}`,
    });
    claim.status = 'approved';
    claim.amount = amount;
    claim.senderName = result.senderName || claim.senderName || '';
    claim.topupRequestId = topupRequestId;
    claim.refCode = refCode;
    claim.finishedAt = now;
    return { alreadyCredited: false, id: topupRequestId, refCode };
  });
  return creditResult;
}

// Provider redemption is irreversible, so persist the provider result and
// wallet credit as a small retryable handoff. This covers a transient Mongo
// conflict or connection blip between the provider response and our local
// credit transaction without asking the customer to create another voucher.
async function finalizeTrueMoneyClaim({ voucherCode, userId, result, attempts = 5 }) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rememberTrueMoneyResult(voucherCode, userId, result);
      return await creditTrueMoneyClaim({ voucherCode, userId, result });
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait(250 * (attempt + 1));
    }
  }
  throw lastError;
}

router.get('/', (req, res) => {
  const user = currentUser(req);
  const transactions = store.data.walletTransactions
    .filter(t => t.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  const localTopups = store.data.topupRequests.filter(t => t.userId === user.id);
  const partnerTopups = req.tenantShop
    ? store.platformData.topupRequests.filter(t => isPartnerTopup(t)
      && String(t.tenantShopId) === String(req.tenantShop.id)
      && (t.tenantUserId || t.userId) === user.id)
    : [];
  const topupRequests = localTopups.concat(partnerTopups)
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
  const payment = settlementPayment();
  res.render('shop/topup', { title: 'เติมเงิน', payment, catalogApiTopup: false });
});

// Separate balance and bank receiver for products syndicated from the main
// shop. This route never changes the regular tenant wallet top-up flow.
router.get('/topup/catalog-api', (req, res) => {
  const payment = settlementPayment({ catalogApiTopup: true });
  res.render('shop/topup', {
    title: 'เติมเงินสินค้า API',
    payment,
    catalogApiTopup: true,
    settlementShopName: store.platformData.settings.shopName || 'ร้านหลัก',
  });
});

router.post('/topup/truemoney', async (req, res) => {
  const user = currentUser(req);
  let voucherCode = '';
  let providerAccepted = false;
  try {
    const voucherInput = String(req.body.voucherLink || req.body.voucherCode || '').trim();
    const payment = settlementPayment() || {};

  if (!payment.truemoneyEnabled) {
    req.flash('error', 'ระบบเติมเงินผ่านซองของขวัญ TrueMoney ปิดให้บริการชั่วคราว');
    return res.redirect('/account/topup');
  }

  const receiverPhone = payment.truemoneyPhone ? payment.truemoneyPhone.trim() : '';
  if (!receiverPhone || receiverPhone.length !== 10) {
    req.flash('error', 'ทางร้านยังไม่ได้ตั้งค่าเบอร์รับเงิน TrueMoney กรุณาติดต่อผู้ดูแลร้าน');
    return res.redirect('/account/topup');
  }

  voucherCode = truemoney.extractVoucherCode(voucherInput);
  if (!voucherCode) {
    req.flash('error', 'กรุณากรอกลิงก์ซองของขวัญ TrueMoney ให้ถูกต้อง');
    return res.redirect('/account/topup');
  }

  if (truemoneyRedemptionLocks.has(voucherCode)) {
    req.flash('error', 'ซองของขวัญนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่');
    return res.redirect('/account/topup');
  }

  truemoneyRedemptionLocks.add(voucherCode);

    const reservation = await reserveTrueMoneyClaim(voucherCode, user.id);
    if (!reservation) {
      req.flash('error', 'ซองของขวัญนี้ถูกใช้แล้วหรือกำลังอยู่ระหว่างการตรวจสอบ');
      return res.redirect('/account/topup');
    }

    if (reservation.alreadyCredited) {
      req.flash('success', 'ซองของขวัญนี้เติมเงินเข้าเว็บแล้ว');
      return res.redirect('/account');
    }

    const result = reservation.retryExisting && reservation.amount > 0
      ? { success: true, recovered: true, amount: reservation.amount, senderName: reservation.senderName || '', message: 'กู้คืนรายการรับเงินสำเร็จ' }
      : await truemoney.redeemAngpao(voucherInput, receiverPhone, { providerBase: reservation.providerBase });

    if (!result.success || !Number.isFinite(result.amount) || result.amount <= 0) {
      if (result.recoverable && result.providerBase) {
        await rememberTrueMoneyProvider(voucherCode, user.id, result.providerBase).catch(error => console.error('[TrueMoney provider claim]', error.message));
      }
      // TARGET_USER_REDEEMED can be the response from a successful first
      // attempt whose persistence was interrupted. Keep that claim in
      // processing so the next retry can recover it instead of permanently
      // hiding the already-redeemed voucher behind a generic error.
      if (!result.recoverable) {
        await markTrueMoneyClaimFailed(voucherCode, user.id, result.message || '').catch(error => {
          console.error('[TrueMoney claim status]', error.message);
        });
      }
      req.flash('error', result.message || 'ไม่สามารถรับเงินจากซองของขวัญนี้ได้');
      return res.redirect('/account/topup');
    }

    providerAccepted = true;
    const credit = await finalizeTrueMoneyClaim({ voucherCode, userId: user.id, result });
    if (credit.alreadyCredited) {
      req.flash('success', 'ซองของขวัญนี้เติมเงินเข้าเว็บแล้ว');
      return res.redirect('/account');
    }
    const amount = Number(result.amount);
    const topupRequestId = credit.id;
    const refCode = credit.refCode;

    // Notifications are deliberately fire-and-forget. They must never be
    // able to turn an already-credited wallet into an error response.
    Promise.resolve().then(() => webhook.notifyTopup({
      webhookUrl: payment.topupWebhookUrl,
      username: user.username,
      email: user.email,
      amount,
      refCode,
      method: 'truemoney_angpao',
      slipUrl: null,
      autoApproved: true,
      adminUrl: null,
    })).catch(error => console.error('[TrueMoney webhook notify]', error.message));

    Promise.resolve().then(() => discordBot.notifyNewTopup({
      username: user.username,
      email: user.email,
      amount,
      refCode,
      method: 'ซองของขวัญ TrueMoney',
    })).catch(error => console.error('[TrueMoney Discord notify]', error.message));

    req.flash('success', `🧧 เติมเงินสำเร็จ! ได้รับ ฿${amount.toLocaleString()} เข้ากระเป๋าเรียบร้อยแล้ว`);
    res.redirect(topupRequestId ? `/account/topup/${topupRequestId}` : '/account');
  } catch (err) {
    console.error('[TrueMoney Redeem Error]', err);
    if (providerAccepted) {
      // The provider has already accepted the voucher. If the final write
      // hit a transient failure, try one last durable recovery before asking
      // the customer to retry the same link.
      try {
        const claim = (store.data?.truemoneyRedemptions || []).find(item => item.voucherCode === voucherCode && item.userId === user.id);
        if (claim && Number(claim.amount) > 0) {
          const recovered = await creditTrueMoneyClaim({
            voucherCode,
            userId: user.id,
            result: { amount: Number(claim.amount), senderName: claim.senderName || '', recovered: true },
          });
          if (recovered && (recovered.alreadyCredited || recovered.id)) {
            req.flash('success', `🧧 เติมเงินสำเร็จ! ได้รับ ฿${Number(claim.amount).toLocaleString()} เข้ากระเป๋าเรียบร้อยแล้ว`);
            return res.redirect(recovered.id ? `/account/topup/${recovered.id}` : '/account');
          }
        }
      } catch (recoveryError) {
        console.error('[TrueMoney recovery after error]', recoveryError);
      }
      req.flash('error', 'รับซองสำเร็จแล้ว แต่ระบบกำลังบันทึกยอดอยู่ กรุณาส่งลิงก์ซองเดิมอีกครั้ง ระบบจะกู้คืนยอดให้โดยไม่หักซ้ำ');
    } else {
      req.flash('error', 'เกิดข้อผิดพลาดในการตรวจสอบซองของขวัญ กรุณาลองใหม่อีกครั้ง');
    }
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

router.post('/topup/catalog-api', async (req, res) => {
  const user = currentUser(req);
  const created = await createTopupRequest({
    user,
    amount: req.body.amount,
    method: 'bank_transfer',
    catalogApiTopup: true,
    tenantShopId: req.tenantShop?.id || null,
    tenantShopName: req.tenantShop?.name || req.tenantShop?.slug || '',
  });
  if (!created.ok) {
    req.flash('error', created.error);
    return res.redirect('/account/topup/catalog-api');
  }
  res.redirect(`/account/topup/${created.request.id}`);
});

router.get('/topup/:id', async (req, res) => {
  const user = currentUser(req);
  const request = findTopupRequestForUser(req.params.id, user.id);
  if (!request) return res.redirect('/account/topup');

  const catalogApiTopup = Boolean(request.catalogApiTopup);
  const payment = settlementPayment({ catalogApiTopup });
  res.render('shop/topup-detail', {
    title: 'สถานะการเติมเงิน', request, payment,
    catalogApiTopup, settlementShopName: store.platformData.settings.shopName || 'ร้านหลัก',
    automaticSlipCheck: canCheckSlipAutomatically(payment, catalogApiTopup),
  });
});

router.get('/topup/:id/status', (req, res) => {
  const user = currentUser(req);
  const request = findTopupRequestForUser(req.params.id, user.id);
  if (!request) return res.status(404).json({ ok: false, error: 'ไม่พบคำขอนี้' });

  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    ok: true,
    status: request.status,
    finished: request.status !== 'verifying',
    approved: request.status === 'approved',
    message: publicSlipMessage(request.slipCheck?.message || ''),
  });
});

router.get('/topup/:id/slip-file', async (req, res, next) => {
  try {
    const user = currentUser(req);
    const request = findTopupRequestForUser(req.params.id, user.id)
      || (!store.isTenantContext() && store.data.topupRequests.find(t => t.id === req.params.id));
    if (!request || (user.role !== 'admin' && (request.tenantUserId || request.userId) !== user.id) || !request.slipStorageId) {
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

function canCheckSlipAutomatically(payment = {}, catalogApiTopup = false) {
  const effective = effectiveSlipConfig(payment, store.platformData.settings.payment, catalogApiTopup ? false : store.isTenantContext());
  const selected = resolveSlipProvider(effective);
  const receiverPayment = receiverProfiles.view(payment, selected);
  const receiver = receiverCredentials(receiverPayment, 'bank_transfer', payment);
  const hasReceiver = Boolean(receiver.expectedReceiverNames.length || receiver.expectedReceiverNumbers.length);
  if (selected === 'slipok') return Boolean(effective.slipokBranchId && effective.slipokApiKey);
  if (selected === 'slipcheck') return Boolean((effective.slipcheckApiKey || (store.isTenantContext() ? false : (effective.slipcheckApiKeys || []).length)) && hasReceiver);
  if (selected === 'rdcw') return Boolean(effective.rdcwClientId && effective.rdcwClientSecret && hasReceiver);
  if (selected === 'slip2go') return Boolean(effective.slip2goApiKey && hasReceiver);
  // XEPHT supports its public verification endpoint without a key; a receiver
  // is still required so a verified slip cannot credit the wrong account.
  if (selected === 'xepht') return Boolean(hasReceiver);
  return false;
}

async function verifySlipInBackground({ requestId, userId, fileBuffer, fileOptions, origin, retryStored = false }) {
  if (activeVerifications.has(requestId)) return;
  activeVerifications.add(requestId);

  try {
    const localRequest = store.data.topupRequests.find(t => t.id === requestId);
    const request = localRequest || (store.isTenantContext()
      ? store.platformData.topupRequests.find(t => isPartnerTopup(t)
        && (!store.currentTenantId || String(t.tenantShopId) === String(store.currentTenantId()))
        && t.id === requestId)
      : null);
    const actor = await findTopupActor(request, userId);
    const user = actor.user;
    if (!request || !user || request.status === 'approved' || request.status === 'rejected') return;

    const payment = settlementPayment({ catalogApiTopup: Boolean(request.catalogApiTopup) });
    const effective = request.catalogApiTopup
      ? effectiveSlipConfig(payment, payment, false)
      : effectiveSlipConfig(payment, store.platformData.settings.payment, store.isTenantContext());
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

    // Record the provider result on the platform queue for Partner requests.
    // Wallet credit is performed in the tenant database below and is guarded
    // by topupRequestId, making retries idempotent.
    if (verified && request.catalogApiTopup) {
      const credit = await creditCatalogTopup(request);
      if (!credit.ok) throw new Error(credit.error);
    }

    let finalRequest;
    const saveResult = (data) => {
      const freshRequest = data.topupRequests.find(t => t.id === requestId);
      if (!freshRequest || freshRequest.status === 'approved' || freshRequest.status === 'rejected') return false;
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
      if (verified && !freshRequest.catalogApiTopup) {
        const freshUser = data.users.find(u => u.id === userId);
        if (!freshUser) return false;
        const alreadyCredited = (data.walletTransactions || []).some(item => item.topupRequestId === freshRequest.id);
        if (!alreadyCredited) {
          freshUser.walletBalance = Math.round(((Number(freshUser.walletBalance) || 0) + freshRequest.amount) * 100) / 100;
          data.walletTransactions.push({
            id: store.genId(10), userId: freshUser.id,
            type: 'topup', catalogApiTopup: false, topupRequestId: freshRequest.id,
            amount: freshRequest.amount,
            note: `เติมเงินสำเร็จ (ตรวจสอบอัตโนมัติ, อ้างอิง ${freshRequest.refCode})`,
            createdAt: new Date().toISOString(),
          });
        }
      }
      if (verified) {
        freshRequest.status = 'approved';
        freshRequest.reviewedAt = new Date().toISOString();
        freshRequest.reviewNote = 'ตรวจสอบและอนุมัติอัตโนมัติ';
      } else {
        freshRequest.status = 'pending';
      }
      finalRequest = freshRequest;
      return true;
    };
    const applied = await withTopupStore(request, () => store.transact(saveResult));
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
    const fallbackRequest = store.data.topupRequests.find(t => t.id === requestId)
      || (store.isTenantContext() ? store.platformData.topupRequests.find(t => isPartnerTopup(t)
        && (!store.currentTenantId || String(t.tenantShopId) === String(store.currentTenantId()))
        && t.id === requestId) : null);
    await withTopupStore(fallbackRequest, () => store.transact((data) => {
      const request = data.topupRequests.find(t => t.id === requestId);
      if (request && request.status === 'verifying') {
        request.status = 'pending';
        request.slipCheck = { checked: false, verified: false, message: 'ระบบตรวจสลิปขัดข้องชั่วคราว อยู่ระหว่างรอแอดมินตรวจสอบ' };
      }
    })).catch(saveErr => console.error('[topup] could not persist verification failure:', saveErr.message));
  } finally {
    const fallbackRequest = store.data.topupRequests.find(t => t.id === requestId)
      || (store.isTenantContext() ? store.platformData.topupRequests.find(t => isPartnerTopup(t)
        && (!store.currentTenantId || String(t.tenantShopId) === String(store.currentTenantId()))
        && t.id === requestId) : null);
    await withTopupStore(fallbackRequest, () => store.transact((data) => {
      const request = data.topupRequests.find(t => t.id === requestId);
      if (request && request.status === 'verifying') request.status = 'pending';
    })).catch(saveErr => console.error('[topup] could not finalize verification:', saveErr.message));
    activeVerifications.delete(requestId);
  }
}

// Shared with src/routes/internal-api.js (the separate rent-app calls
// these two instead of re-implementing topup + slip verification itself)
// so there is exactly one place that creates a topup request and exactly
// one place that kicks off slip verification.
async function createTopupRequest({ user, amount, method, catalogApiTopup = false, tenantShopId = null, tenantShopName = '' }) {
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  const mth = String(method || 'bank_transfer');
  if (mth !== 'bank_transfer') {
    return { ok: false, error: 'ระบบรับชำระผ่านบัญชีธนาคารเท่านั้น' };
  }
  if (!Number.isFinite(amt) || amt < 1) {
    return { ok: false, error: 'กรุณาระบุจำนวนเงินอย่างน้อย 1 บาท' };
  }
  const isPartner = Boolean(catalogApiTopup && tenantShopId && store.isTenantContext()
    && (!store.currentTenantId || String(store.currentTenantId()) === String(tenantShopId)));
  const request = {
    id: store.genId(10), userId: user.id, amount: amt, method: mth,
    catalogApiTopup: Boolean(catalogApiTopup),
    tenantShopId: isPartner ? String(tenantShopId) : null,
    tenantShopName: isPartner ? String(tenantShopName || tenantShopId) : '',
    tenantUserId: isPartner ? user.id : null,
    tenantUsername: isPartner ? String(user.username || '') : '',
    tenantUserEmail: isPartner ? String(user.email || '') : '',
    refCode: 'TU' + store.genId(6).toUpperCase(),
    slipPath: null, slipCheck: null, status: 'pending',
    createdAt: new Date().toISOString(), reviewedAt: null, reviewNote: '',
  };
  await withTopupStore(request, () => store.transact((data) => {
    data.topupRequests ||= [];
    data.topupRequests.push(request);
  }));
  return { ok: true, request };
}

async function attachSlipToTopupRequest({ requestId, user, fileBuffer, fileOptions, origin }) {
  const request = findTopupRequestForUser(requestId, user.id);
  if (!request) return { ok: false, error: 'ไม่พบคำขอนี้' };
  if (request.status === 'approved' || request.status === 'rejected') {
    return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  }
  if (activeVerifications.has(request.id)) {
    return { ok: false, error: 'คำขอนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่' };
  }
  try {
    const storageId = await store.savePrivateMedia(fileBuffer, fileOptions.filename, fileOptions.contentType);
    const requestPayment = request.catalogApiTopup
      ? store.platformData.settings.payment
      : store.data.settings.payment;
    const automatic = canCheckSlipAutomatically(requestPayment, Boolean(request.catalogApiTopup));
    await withTopupStore(request, () => store.transact((data) => {
      const fresh = data.topupRequests.find(t => t.id === requestId && t.userId === user.id);
      const partnerFresh = data.topupRequests.find(t => t.id === requestId && isPartnerTopup(t)
        && (t.tenantUserId || t.userId) === user.id);
      const target = fresh || partnerFresh;
      if (!target || target.status === 'approved' || target.status === 'rejected') throw new Error('คำขอนี้ถูกตรวจสอบแล้ว');
      target.slipStorageId = storageId;
      target.slipPath = `/account/topup/${target.id}/slip-file`;
      target.status = automatic ? 'verifying' : 'pending';
      if (!automatic) target.slipCheck = { checked: false, verified: false, message: 'รอแอดมินตรวจสอบสลิป', provider: 'manual' };
    }));
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
  const request = store.data.topupRequests.find(t => t.id === requestId)
    || (store.isTenantContext() ? store.platformData.topupRequests.find(t => isPartnerTopup(t)
      && (!store.currentTenantId || String(t.tenantShopId) === String(store.currentTenantId()))
      && t.id === requestId) : null);
  const actor = request ? await findTopupActor(request, request.userId) : { user: null };
  const user = actor.user;
  if (!request || !user || !request.slipStorageId) return { ok: false, error: 'ไม่พบสลิปของรายการนี้' };
  if (request.status === 'approved' || request.status === 'rejected') return { ok: false, error: 'รายการนี้ถูกดำเนินการแล้ว' };
  if (activeVerifications.has(request.id)) return { ok: false, error: 'รายการนี้กำลังตรวจสอบอยู่' };
  const media = await store.getPrivateMedia(request.slipStorageId);
  if (!media) return { ok: false, error: 'ไม่พบไฟล์สลิปที่บันทึกไว้' };
  const chunks = [];
  for await (const chunk of media.stream) chunks.push(Buffer.from(chunk));
  await withTopupStore(request, () => store.transact((data) => {
    const fresh = data.topupRequests.find(t => t.id === requestId);
    if (fresh && fresh.status === 'pending') fresh.status = 'verifying';
  }));
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
  const request = findTopupRequestForUser(req.params.id, user.id);
  if (!request) return res.redirect('/account/topup');
  const result = await retryTopupSlipVerification({ requestId: request.id, origin: `${req.protocol}://${req.get('host')}` });
  req.flash(result.ok ? 'success' : 'error', result.ok ? 'ส่งสลิปเดิมไปตรวจอีกครั้งแล้ว' : result.error);
  res.redirect(`/account/topup/${request.id}`);
});

router.post('/topup/:id/slip', (req, res) => {
  const user = currentUser(req);
  const request = findTopupRequestForUser(req.params.id, user.id);
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
      credentials: oi.credentials || stockItem,
      productTitle: oi.title || product?.title || 'สินค้า',
      productImage: oi.productImage || product?.images?.[0] || '',
    };
  });
  const orderContactSettings = order.salesChannel === 'catalog-api' ? store.platformData.settings : store.data.settings;
  res.render('shop/order-detail', { title: `คำสั่งซื้อ #${order.id}`, order, itemsWithCreds, orderContactSettings });
});

module.exports = router;
// Attached to the router function object (functions are objects in JS) so
// the internal API can reuse this exact logic without a second import path.
router.createTopupRequest = createTopupRequest;
router.attachSlipToTopupRequest = attachSlipToTopupRequest;
router.retryTopupSlipVerification = retryTopupSlipVerification;
router.canCheckSlipAutomatically = canCheckSlipAutomatically;
router.reserveTrueMoneyClaim = reserveTrueMoneyClaim;
router.rememberTrueMoneyResult = rememberTrueMoneyResult;
router.markTrueMoneyClaimFailed = markTrueMoneyClaimFailed;
router.creditTrueMoneyClaim = creditTrueMoneyClaim;
router.finalizeTrueMoneyClaim = finalizeTrueMoneyClaim;
router.rememberTrueMoneyProvider = rememberTrueMoneyProvider;
