/**
 * TrueMoney Angpao (gift voucher) redemption service.
 *
 * The old api.xpluem.com proxy now returns 521. These browser-compatible
 * providers return TrueMoney's current { status, data } envelope. A voucher
 * redemption is irreversible, so one request is sent to one provider only;
 * retrying against another provider after a 5xx could turn a credited voucher
 * into a misleading "already used" response.
 */
const http = require('http');
const https = require('https');

const DEFAULT_PROVIDERS = [
  'https://truemoney-voucher-go.vercel.app',
  'https://truemoney-voucher-nestjs.vercel.app',
  'https://truemoney-voucher-fastapi.vercel.app',
  // Legacy xpluem API. It uses /<code>/<phone> (without /truemoney) and is
  // kept as a last fallback for shops that still have access to that service.
  'https://api.xpluem.com',
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
    const transport = parsed.protocol === 'http:' ? http : https;
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
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
  const rawStatus = payload?.status;
  const status = rawStatus && typeof rawStatus === 'object' ? rawStatus : {};
  return {
    code: String(status.code || (typeof rawStatus === 'string' ? rawStatus : '') || payload?.code || (payload?.success === true ? 'SUCCESS' : '')).toUpperCase(),
    message: String(status.message || payload?.message || '').trim(),
  };
}

function errorMessage(code, fallback = '') {
  const messages = {
    VOUCHER_NOT_FOUND: 'ไม่พบซองของขวัญนี้ กรุณาตรวจสอบลิงก์อีกครั้ง',
    VOUCHER_OUT_OF_STOCK: 'ซองของขวัญนี้ถูกใช้หมดแล้ว',
    VOUCHER_ALREADY_USED: 'ซองของขวัญนี้ถูกใช้แล้ว',
    VOUCHER_REDEEMED: 'ซองของขวัญนี้ถูกใช้แล้ว',
    VOUCHER_EXPIRED: 'ซองของขวัญนี้หมดอายุแล้ว',
    TARGET_USER_REDEEMED: 'เบอร์รับเงินนี้เคยรับซองของขวัญนี้ไปแล้ว',
    TARGET_USER_NOT_FOUND: 'ไม่พบเบอร์ TrueMoney ของร้านในระบบ',
    TARGET_USER_STATUS_INACTIVE: 'บัญชี TrueMoney ของร้านไม่พร้อมรับเงิน',
    CANNOT_GET_OWN_VOUCHER: 'ไม่สามารถรับซองที่สร้างจากบัญชีเดียวกันได้',
    MAINTENANCE: 'ระบบ TrueMoney อยู่ระหว่างปรับปรุง กรุณาลองใหม่ภายหลัง',
  };
  return messages[code] || fallback || 'ไม่สามารถรับเงินจากซองของขวัญนี้ได้';
}

function isTransientProviderFailure(code, statusCode) {
  return Number(statusCode) >= 500 || ['500', 'INTERNAL_ERROR', 'MAINTENANCE', 'SERVICE_UNAVAILABLE', 'UPSTREAM_ERROR'].includes(String(code || '').toUpperCase());
}

function responseData(payload) {
  if (payload?.data && typeof payload.data === 'object') return payload.data;
  if (payload?.status?.data && typeof payload.status.data === 'object') return payload.status.data;
  if (payload?.result?.data && typeof payload.result.data === 'object') return payload.result.data;
  return {};
}

function amountFrom(payload) {
  const data = responseData(payload);
  const ticket = data.my_ticket || data.ticket || {};
  const voucher = data.voucher || {};
  const candidates = [payload.amount, data.amount, ticket.amount_baht, ticket.amount, voucher.redeemed_amount_baht, voucher.amount_baht];
  for (const candidate of candidates) {
    const amount = Number.parseFloat(String(candidate ?? '').replace(/,/g, ''));
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

function redeemUrl(base, voucherCode, phone) {
  const hostname = new URL(base).hostname.toLowerCase();
  const path = hostname === 'api.xpluem.com' ? '' : '/truemoney';
  return `${base}${path}/${encodeURIComponent(voucherCode)}/${encodeURIComponent(phone)}`;
}

function senderFrom(payload) {
  const data = responseData(payload);
  return data.name || data.owner_profile?.full_name || data.my_ticket?.full_name || 'ไม่ระบุชื่อ';
}

function recipientMatches(payload, phone) {
  const data = responseData(payload);
  const rawValues = [data.my_ticket?.mobile, data.my_ticket?.mobile_number, data.redeemer_profile?.mobile, data.redeemer_profile?.mobile_number, data.mobile, data.phone, data.target_mobile];
  const values = rawValues.map(normalizePhone).filter(Boolean);
  if (!values.length) return true;
  return values.some(value => value === phone || (value.length >= 4 && phone.slice(-4) === value.slice(-4)));
}

async function redeemAngpao(voucherInput, receiverPhone, options = {}) {
  const voucherCode = extractVoucherCode(voucherInput);
  const phone = normalizePhone(receiverPhone);
  if (!voucherCode) return { success: false, amount: 0, code: 'INVALID_VOUCHER', message: 'ลิงก์ซองของขวัญไม่ถูกต้อง' };
  if (!/^0\d{9}$/.test(phone)) return { success: false, amount: 0, code: 'INVALID_PHONE', message: 'เบอร์รับเงิน TrueMoney ไม่ถูกต้อง (ต้องเป็นเบอร์ 10 หลัก)' };

  const base = String(options.providerBase || providerBases()[0] || '').trim().replace(/\/+$/, '');
  if (!base) return { success: false, amount: 0, code: 'PROVIDER_UNAVAILABLE', recoverable: true, message: 'ระบบ TrueMoney ยังไม่พร้อมให้ตรวจสอบ กรุณาลองใหม่อีกครั้ง' };
  try {
    const response = await requestJson(redeemUrl(base, voucherCode, phone));
    const { code, message } = statusFrom(response.payload);
    if (code === 'SUCCESS' || code || response.payload?.status || response.payload?.success === false) {
      const amount = amountFrom(response.payload);
      const recoveredCodes = ['TARGET_USER_REDEEMED', 'VOUCHER_OUT_OF_STOCK', 'VOUCHER_ALREADY_USED', 'VOUCHER_REDEEMED'];
      const recovered = recoveredCodes.includes(code) && amount > 0 && recipientMatches(response.payload, phone);
      if ((code === 'SUCCESS' || recovered) && amount > 0) {
        return { success: true, recovered, amount, code: code || 'SUCCESS', senderName: senderFrom(response.payload), message: message || (recovered ? 'กู้คืนรายการรับเงินสำเร็จ' : 'รับเงินสำเร็จ'), raw: response.payload, providerBase: base };
      }
      const redemptionCodes = ['SUCCESS', 'TARGET_USER_REDEEMED', 'VOUCHER_OUT_OF_STOCK', 'VOUCHER_ALREADY_USED', 'VOUCHER_REDEEMED'];
      if (redemptionCodes.includes(code) && amount <= 0) {
        return { success: false, amount: 0, code: 'PROVIDER_UNCERTAIN', recoverable: true, message: 'ระบบรับคำขอซองแล้วแต่ยังไม่ส่งยอดกลับมา กรุณาลองลิงก์เดิมอีกครั้ง', raw: response.payload, providerBase: base };
      }
      if (Number(response.statusCode) >= 500 || ['500', 'INTERNAL_ERROR', 'MAINTENANCE', 'SERVICE_UNAVAILABLE', 'UPSTREAM_ERROR'].includes(String(code || '').toUpperCase())) {
        return { success: false, amount: 0, code: 'PROVIDER_UNCERTAIN', recoverable: true, message: 'ระบบ TrueMoney ตอบกลับผิดพลาดหลังส่งคำขอแล้ว กรุณาลองลิงก์เดิมอีกครั้ง ระบบจะไม่ยิงซ้ำข้าม provider', raw: response.payload, providerBase: base };
      }
      return { success: false, amount: 0, code, recoverable: ['TARGET_USER_REDEEMED', 'VOUCHER_OUT_OF_STOCK', 'VOUCHER_ALREADY_USED', 'VOUCHER_REDEEMED'].includes(code), message: errorMessage(code, message), raw: response.payload, providerBase: base };
    }
    return { success: false, amount: 0, code: 'PROVIDER_UNCERTAIN', recoverable: true, message: 'รูปแบบข้อมูลตอบกลับจากระบบไม่ถูกต้อง กรุณาลองลิงก์เดิมอีกครั้ง', raw: response.payload, providerBase: base };
  } catch (error) {
    const text = String(error?.message || '');
    return { success: false, amount: 0, code: 'PROVIDER_UNCERTAIN', recoverable: true, message: /หมดเวลา|timeout/i.test(text) ? 'การเชื่อมต่อไปยังระบบ TrueMoney หมดเวลา กรุณาลองลิงก์เดิมอีกครั้ง' : 'ระบบ TrueMoney ไม่ตอบสนอง กรุณาลองลิงก์เดิมอีกครั้ง', error: text, providerBase: base };
  }
}

module.exports = { extractVoucherCode, normalizePhone, redeemAngpao, providerBases };
