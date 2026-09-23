const crypto = require('node:crypto');

const MAX_ADJUSTMENT_CENTS = 100_000_000;

class WalletAdjustmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WalletAdjustmentError';
  }
}

function parseMoneyCents(value, { allowZero = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new WalletAdjustmentError('กรุณาระบุจำนวนเงินเป็นตัวเลข และใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
  }
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_ADJUSTMENT_CENTS || (!allowZero && cents <= 0)) {
    throw new WalletAdjustmentError('จำนวนเงินต้องมากกว่า 0 และไม่เกิน ฿1,000,000 ต่อครั้ง');
  }
  return cents;
}

function adjustCustomerWallet(data, {
  userId,
  adminUserId,
  operation,
  amount,
  expectedBalance,
  note,
  now = new Date().toISOString(),
  transactionId = crypto.randomBytes(5).toString('hex'),
}) {
  if (!['add', 'subtract'].includes(operation)) {
    throw new WalletAdjustmentError('เลือกรายการเพิ่มหรือลดเครดิตก่อนบันทึก');
  }

  const amountCents = parseMoneyCents(amount);
  const expectedCents = parseMoneyCents(expectedBalance, { allowZero: true });
  const reason = String(note || '').trim();
  if (reason.length < 3 || reason.length > 250) {
    throw new WalletAdjustmentError('กรุณาระบุเหตุผล 3–250 ตัวอักษร');
  }

  const user = (data.users || []).find(item => String(item.id) === String(userId));
  if (!user) throw new WalletAdjustmentError('ไม่พบสมาชิก กรุณารีเฟรชหน้าแล้วลองอีกครั้ง');
  if ((user.role || 'customer') !== 'customer') {
    throw new WalletAdjustmentError('ปรับเครดิตได้เฉพาะบัญชีสมาชิก ไม่สามารถปรับบัญชีผู้ดูแลได้');
  }

  const current = user.walletBalance == null ? 0 : Number(user.walletBalance);
  if (!Number.isFinite(current) || current < 0 || !Number.isSafeInteger(Math.round(current * 100))) {
    throw new WalletAdjustmentError('ยอดเครดิตปัจจุบันไม่ถูกต้อง กรุณาตรวจสอบข้อมูลสมาชิก');
  }
  const previousCents = Math.round(current * 100);
  if (previousCents !== expectedCents) {
    throw new WalletAdjustmentError('ยอดเครดิตเปลี่ยนไประหว่างที่เปิดหน้า กรุณาปิดแล้วเปิดหน้าปรับเครดิตใหม่');
  }

  const deltaCents = operation === 'add' ? amountCents : -amountCents;
  const nextCents = previousCents + deltaCents;
  if (nextCents < 0) throw new WalletAdjustmentError('ยอดเครดิตไม่พอสำหรับการหักจำนวนนี้');
  if (!Number.isSafeInteger(nextCents)) throw new WalletAdjustmentError('ยอดเครดิตใหม่สูงเกินกว่าระบบรองรับ');

  const admin = (data.users || []).find(item => String(item.id) === String(adminUserId));
  const actor = String(admin?.username || adminUserId || 'ผู้ดูแลระบบ').slice(0, 100);
  const delta = deltaCents / 100;
  const previousBalance = previousCents / 100;
  const balanceAfter = nextCents / 100;

  user.walletBalance = balanceAfter;
  data.walletTransactions ||= [];
  data.walletTransactions.push({
    id: transactionId,
    userId: user.id,
    type: 'adjust',
    amount: delta,
    previousBalance,
    balanceAfter,
    adminUserId: String(adminUserId || ''),
    note: `ผู้ดูแล ${actor} ${operation === 'add' ? 'เพิ่ม' : 'หัก'}เครดิต: ${reason}`,
    createdAt: now,
  });

  return { userId: user.id, username: user.username || 'สมาชิก', operation, amount: amountCents / 100, previousBalance, balanceAfter };
}

module.exports = { adjustCustomerWallet, parseMoneyCents, WalletAdjustmentError, MAX_ADJUSTMENT_CENTS };
