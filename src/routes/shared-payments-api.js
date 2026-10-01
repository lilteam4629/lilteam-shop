// Mounted behind the internal API secret + main-site-only guard. Never credits a main wallet.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const store = require('../data/store');
const account = require('./account');
const gateway = require('../services/shared-slip-verification');
const { effectiveSlipConfig } = require('../services/slip-config');
const { resolveSlipProvider } = require('../services/slip-provider');
const receivers = require('../services/receiver-profiles');
const { parseSlipDate } = require('../services/slip-fields');
const slipok = require('../services/slipok');
const truemoney = require('../services/truemoney');
const { publicSlipMessage } = require('../services/public-slip');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_, file, cb) => cb(null, /^image\/(png|jpeg|webp)$/.test(file.mimetype)) });
const locks = new Set();
const payment = () => store.platformData.settings.payment || {};
const identity = value => /^[a-zA-Z0-9_-]{1,100}$/.test(String(value || ''));
function config() {
  const p = payment(), effective = effectiveSlipConfig(p, p, false), provider = resolveSlipProvider(effective);
  const receiver = receivers.view(p, provider);
  const qr = receiver.bankQrImage;
  return { ...receiver, bankQrImage: typeof qr === 'string' && qr.startsWith('/') ? `${process.env.MAIN_SITE_URL || 'https://lilteam.site'}${qr}` : qr,
    slipProvider: provider, sharedPayment: true, automaticSlipCheck: gateway.configured(effective, p), promptpayEnabled: false,
    truemoneyEnabled: p.truemoneyEnabled !== false && Boolean(p.truemoneyPhone), truemoneyPhone: p.truemoneyPhone || '' };
}
router.get('/payments/config', (_, res) => res.json({ ok: true, payment: config() }));

router.post('/payments/slip', upload.single('slip'), async (req, res, next) => {
  const { requestId, userId } = req.body, amount = Number(req.body.amount);
  if (!identity(requestId) || !identity(userId) || !Number.isFinite(amount) || amount <= 0 || !req.file) return res.status(400).json({ error: 'คำขอหรือไฟล์สลิปไม่ถูกต้อง' });
  const key = `rent:${requestId}`;
  if (locks.has(key)) return res.status(409).json({ error: 'รายการกำลังตรวจสอบ กรุณาลองใหม่อีกครั้ง' });
  locks.add(key);
  try {
    const old = (store.platformData.externalSlipResults || []).find(entry => entry.requestId === requestId);
    if (old) {
      if (old.userId !== userId || old.amount !== amount) return res.status(409).json({ error: 'ข้อมูลคำขอไม่ตรงกับรายการเดิม' });
      return res.json({ ok: true, check: old.check, recovered: true });
    }
    const p = payment(), effective = effectiveSlipConfig(p, p, false);
    if (!gateway.configured(effective, p)) return res.status(503).json({ error: 'ระบบตรวจสลิปของเว็บหลักยังไม่พร้อม กรุณาติดต่อผู้ดูแล' });
    const { provider, result } = await gateway.verify(req.file.buffer, amount, { filename: req.file.originalname, contentType: req.file.mimetype }, effective, p);
    const raw = result.raw || {}, ref = String(raw.transRef || raw.trans_ref || raw.rawSlip?.transRef || '').trim();
    const date = parseSlipDate(raw.rawSlip?.date) || parseSlipDate(raw.date) || slipok.parseTransDateTime(raw.transDate, raw.transTime);
    const age = date ? Date.now() - date.getTime() : NaN;
    const createdAt = Date.parse(req.body.createdAt);
    const initialTooOld = req.body.retryStored !== 'true' && age > 300000;
    let verified = Boolean(result.checked && result.verified), message = result.message;
    if (verified && (!ref || !Number.isFinite(age) || age < -120000 || initialTooOld || !Number.isFinite(createdAt) || date.getTime() < createdAt - 300000)) {
      verified = false; message = 'ไม่พบเลขอ้างอิงหรือเวลาในสลิปไม่อยู่ในช่วงที่ยอมรับได้';
    }
    if (verified && !await store.claimGlobalSlipRef(ref, { source: 'shop-cloud', requestId })) {
      verified = false; message = 'สลิปนี้ถูกใช้เติมเงินแล้ว ใช้ซ้ำข้ามเว็บไม่ได้';
    }
    const check = { checked: Boolean(result.checked), verified, provider, message: publicSlipMessage(message), retryable: Boolean(result.retryable), raw: { transRef: ref, date: date?.toISOString() || null } };
    if (verified) await store.runOnPlatform(() => store.transact(data => {
      data.externalSlipResults ||= [];
      data.externalSlipResults.push({ requestId, userId, amount, check, fileHash: crypto.createHash('sha256').update(req.file.buffer).digest('hex'), createdAt: new Date().toISOString() });
    }));
    res.json({ ok: true, check });
  } catch (error) { next(error); } finally { locks.delete(key); }
});

router.post('/payments/truemoney', async (req, res, next) => {
  const { userId } = req.body;
  if (!identity(userId)) return res.status(400).json({ error: 'บัญชีผู้ใช้ไม่ถูกต้อง' });
  const voucher = truemoney.extractVoucherCode(req.body.voucherLink);
  if (!voucher) return res.status(400).json({ error: 'ลิงก์ซองไม่ถูกต้อง' });
  const owner = `rent:${userId}`, key = `voucher:${voucher}`;
  if (locks.has(key)) return res.status(409).json({ error: 'ซองนี้กำลังตรวจสอบ กรุณาลองใหม่', recoverable: true });
  locks.add(key);
  try {
    const p = payment(), phone = truemoney.normalizePhone(p.truemoneyPhone);
    if (p.truemoneyEnabled === false || !/^0\d{9}$/.test(phone)) return res.status(503).json({ error: 'ระบบ TrueMoney ของเว็บหลักยังไม่พร้อม' });
    const existing = (store.platformData.truemoneyRedemptions || []).find(c => c.voucherCode === voucher);
    if ((store.platformData.walletTransactions || []).some(t => t.voucherCode === voucher)) return res.status(409).json({ error: 'ซองนี้เติมเงินเข้าเว็บหลักแล้ว ใช้เติมเว็บเช่าซ้ำไม่ได้' });
    if (existing && existing.userId !== owner) return res.status(409).json({ error: 'ซองนี้ถูกผูกกับอีกบัญชีหรืออีกเว็บแล้ว' });
    const reservation = await account.reserveTrueMoneyClaim(voucher, owner, { externalWallet: true });
    if (!reservation) return res.status(409).json({ error: 'ซองนี้ถูกใช้เติมเงินในอีกเว็บแล้ว' });
    const ready = (store.platformData.truemoneyRedemptions || []).find(c => c.voucherCode === voucher && c.userId === owner);
    if (Number(ready?.amount) > 0) return res.json({ ok: true, result: { success: true, amount: ready.amount, senderName: ready.senderName, recovered: true } });
    if (reservation.alreadyCredited) return res.status(409).json({ error: 'ซองนี้ถูกใช้เติมเงินในอีกเว็บแล้ว' });
    const providerBase = reservation.providerBase || truemoney.providerBases()[0];
    await account.rememberTrueMoneyProvider(voucher, owner, providerBase, phone);
    const result = await truemoney.redeemAngpao(req.body.voucherLink, reservation.receiverPhone || phone, { providerBase });
    if (!result.success) {
      await account.markTrueMoneyClaimFailed(voucher, owner, result.message);
      return res.status(400).json({ error: result.message || 'รับซองไม่สำเร็จ', recoverable: Boolean(result.recoverable) });
    }
    await account.rememberTrueMoneyResult(voucher, owner, result);
    res.json({ ok: true, result: { success: true, amount: result.amount, senderName: result.senderName, recovered: Boolean(result.recovered) } });
  } catch (error) { next(error); } finally { locks.delete(key); }
});

// Bring already accepted Cloud vouchers into the central ownership ledger on upgrade.
router.post('/payments/history', async (req, res, next) => {
  const entries = req.body.vouchers;
  if (!Array.isArray(entries) || entries.length > 200) return res.status(400).json({ error: 'รูปแบบประวัติไม่ถูกต้อง' });
  try {
    const conflicts = [];
    await store.transact(data => {
      data.truemoneyRedemptions ||= [];
      for (const entry of entries) {
        if (!identity(entry.userId) || !identity(entry.voucherCode) || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) <= 0) throw new Error('Invalid historical voucher');
        const owner = `rent:${entry.userId}`, old = data.truemoneyRedemptions.find(c => c.voucherCode === entry.voucherCode);
        if ((data.walletTransactions || []).some(t => t.voucherCode === entry.voucherCode)) { conflicts.push(entry.voucherCode); continue; }
        if (old && old.userId !== owner) { conflicts.push(entry.voucherCode); continue; }
        if (!old) data.truemoneyRedemptions.push({ id: store.genId(16), voucherCode: entry.voucherCode, userId: owner, amount: Number(entry.amount), externalWallet: true, status: 'external_ready', senderName: entry.senderName || '', createdAt: new Date().toISOString() });
      }
    });
    res.json({ ok: true, conflicts });
  } catch (error) { next(error); }
});
module.exports = router;
