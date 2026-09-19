/**
 * TrueMoney Angpao (gift voucher) redemption service.
 *
 * The old api.xpluem.com proxy now returns 521. These browser-compatible
 * providers return TrueMoney's current { status, data } envelope and keep
 * two fallbacks for a temporary provider outage.
 */
const https = require('https');

const DEFAULT_PROVIDERS = [
  'https://truemoney-voucher-go.vercel.app',
  'https://truemoney-voucher-nestjs.vercel.app',
  'https://truemoney-voucher-fastapi.vercel.app',
];

function providerBases() {
  const configured = String(process.env.TRUEMONEY_API_BASE_URL || '').trim().replace(/\/+$/, '');
  return [...new Set([configured, ...DEFAULT_PROVIDERS].filter(Boolean))];
}

function extractVoucherCode(input) {
  if (!input) return '';
  const trimmed = String(input).trim();
  const match = trimmed.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const pathMatch = trimmed.match(/campaign\/(?:\?v=)?([a-zA-Z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
}

function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.startsWith('66') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return digits;
}

function requestJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'LilTeamShop-TrueMoneyClient/2.0',
        Accept: 'application/json',
      },
      timeout: timeoutMs,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let payload;
        try { payload = JSON.parse(body); } catch (_) {
          return reject(new Error(`รูปแบบข้อมูลตอบกลับจากระบบไม่ถูกต้อง (HTTP ${res.statusCode || 0})`));
        }
        resolve({ statusCode: res.statusCode || 0, payload });
      });
    });
    req.on('timeout', () => req.destroy(new Error('การเชื่อมต่อไปยังระบบ TrueMoney หมดเวลา')));
    req.on('error', reject);
    req.end();
  });
}

function statusFrom(payload) {
  const status = payload && payload.status && typeof payload.status === 'object' ? payload.status : {};
  return {
    code: String(status.code || payload?.code || '').toUpperCase(),
    message: String(status.message || payload?.message || '').trim(),
  };
}

function errorMessage(code, fallback = '') {
  const messages = {
    VOUCHER_NOT_FOUND: 'ไม่พบซองของขวัญนี้ กรุณาตรวจสอบลิงก์อีกครั้ง',
    VOUCHER_OUT_OF_STOCK: 'ซองของขวัญนี้ถูกใช้หมดแล้ว',
    VOUCHER_EXPIRED: 'ซองของขวัญนี้หมดอายุแล้ว',
    TARGET_USER_REDEEMED: 'เบอร์รับเงินนี้เคยรับซองของขวัญนี้ไปแล้ว',
    TARGET_USER_NOT_FOUND: 'ไม่พบเบอร์ TrueMoney ของร้านในระบบ',
    TARGET_USER_STATUS_INACTIVE: 'บัญชี TrueMoney ของร้านไม่พร้อมรับเงิน',
    CANNOT_GET_OWN_VOUCHER: 'ไม่สามารถรับซองที่สร้างจากบัญชีเดียวกันได้',
    MAINTENANCE: 'ระบบ TrueMoney อยู่ระหว่างปรับปรุง กรุณาลองใหม่ภายหลัง',
  };
  return messages[code] || fallback || 'ไม่สามารถรับเงินจากซองของขวัญนี้ได้';
}

function amountFrom(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const ticket = data.my_ticket || data.ticket || {};
  const voucher = data.voucher || {};
  const candidates = [payload.amount, data.amount, ticket.amount_baht, ticket.amount, voucher.redeemed_amount_baht, voucher.amount_baht];
  for (const candidate of candidates) {
    const amount = Number.parseFloat(String(candidate ?? '').replace(/,/g, ''));
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

function senderFrom(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  return data.name || data.owner_profile?.full_name || data.my_ticket?.full_name || 'ไม่ระบุชื่อ';
}

async function redeemAngpao(voucherInput, receiverPhone) {
  const voucherCode = extractVoucherCode(voucherInput);
  const phone = normalizePhone(receiverPhone);
  if (!voucherCode) return { success: false, amount: 0, message: 'ลิงก์ซองของขวัญไม่ถูกต้อง' };
  if (!/^0\d{9}$/.test(phone)) return { success: false, amount: 0, message: 'เบอร์รับเงิน TrueMoney ไม่ถูกต้อง (ต้องเป็นเบอร์ 10 หลัก)' };

  let lastError = null;
  for (const base of providerBases()) {
    const targetUrl = `${base}/truemoney/${encodeURIComponent(voucherCode)}/${encodeURIComponent(phone)}`;
    try {
      const response = await requestJson(targetUrl);
      const { code, message } = statusFrom(response.payload);
      // Return valid voucher errors directly; only network/invalid responses
      // use a fallback because redemption is irreversible on success.
      if (code === 'SUCCESS' || code || response.payload?.status) {
        const amount = amountFrom(response.payload);
        if (code === 'SUCCESS' && amount > 0) {
          return { success: true, amount, senderName: senderFrom(response.payload), message: message || 'รับเงินสำเร็จ', raw: response.payload };
        }
        return { success: false, amount: 0, message: errorMessage(code, message), raw: response.payload };
      }
      lastError = new Error('รูปแบบข้อมูลตอบกลับจากระบบไม่ถูกต้อง');
    } catch (error) {
      lastError = error;
    }
  }

  const text = String(lastError?.message || '');
  if (/หมดเวลา|timeout/i.test(text)) return { success: false, amount: 0, message: 'การเชื่อมต่อไปยังระบบ TrueMoney หมดเวลา กรุณาลองใหม่อีกครั้ง' };
  return { success: false, amount: 0, message: 'ระบบ TrueMoney ยังไม่พร้อมให้ตรวจสอบ กรุณาลองใหม่อีกครั้ง' };
}

module.exports = { extractVoucherCode, normalizePhone, redeemAngpao, providerBases };
