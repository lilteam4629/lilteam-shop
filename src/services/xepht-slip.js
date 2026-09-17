const axios = require('axios');
const FormData = require('form-data');
const { receiverMatches, textValues, extractReceiverEvidence } = require('./receiver-match');
const { numberValue, officialEndpoint } = require('./slip-fields');

const DEFAULT_ENDPOINT = 'https://slip.xepht.com/api/v1';
// Authentication/configuration failures are actionable and should surface as
// a failed verification; only provider availability/rate-limit errors stay
// pending for the background verifier to retry.
const RETRYABLE_CODES = new Set(['VERIFY_UNAVAILABLE', 'RATE_LIMITED', 'INTERNAL_ERROR']);

function providerMessage(body, fallback = 'Slip XEPHT ไม่สามารถยืนยันสลิปนี้ได้') {
  return String(body?.message || body?.error || fallback);
}

function normalizeResponse(body = {}) {
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const rawSlip = data.rawSlip && typeof data.rawSlip === 'object' ? data.rawSlip : {};
  const transRef = data.trans_ref || data.transRef || rawSlip.transRef || rawSlip.trans_ref || rawSlip.reference || null;
  const amountInSlip = numberValue(data.amountInSlip ?? rawSlip.amount?.amount ?? rawSlip.amount ?? data.amount);
  return {
    ...data,
    transRef,
    amount: amountInSlip,
    date: rawSlip.date || data.date || data.transferred_at || null,
    receiver: data.receiver || rawSlip.receiver || null,
    rawSlip,
    providerResponse: body,
  };
}

async function verifySlip(fileBuffer, expectedAmount, fileOptions = {}, credentials = {}) {
  const endpoint = officialEndpoint(credentials.endpoint, DEFAULT_ENDPOINT, 'slip.xepht.com');
  if (!Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
    return { checked: false, verified: false, message: 'ไม่พบไฟล์สลิปสำหรับตรวจสอบ', raw: null };
  }

  try {
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: fileOptions.filename || 'slip.jpg',
      contentType: fileOptions.contentType || 'image/jpeg',
    });
    form.append('amount', Number(expectedAmount).toFixed(2));
    const expectedNumbers = [...new Set((credentials.expectedReceiverNumbers || []).map(value => String(value || '').trim()).filter(Boolean))];
    const expectedNames = [...new Set((credentials.expectedReceiverNames || []).map(value => String(value || '').trim()).filter(Boolean))];
    if (expectedNumbers.length) form.append('receiver_account', expectedNumbers.join(','));
    if (expectedNames.length) form.append('receiver_name', expectedNames.join(','));

    const headers = { ...form.getHeaders(), Accept: 'application/json' };
    const apiKey = String(credentials.apiKey || '').trim();
    if (apiKey) headers['X-Api-Key'] = apiKey;

    const response = await axios.post(`${endpoint}/slips/verify`, form, { headers, timeout: 90000 });
    const body = response.data || {};
    const code = String(body.code || '').trim().toUpperCase();
    const raw = normalizeResponse(body);
    const retryable = RETRYABLE_CODES.has(code);

    if (code !== 'VERIFIED') {
      return {
        checked: !retryable,
        verified: false,
        retryable,
        providerCode: code || null,
        httpStatus: Number(response.status) || 200,
        message: providerMessage(body),
        raw,
      };
    }

    const amount = numberValue(body.data?.amountInSlip ?? raw.amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(expectedAmount)) > 0.009 || body.data?.is_amount_matched === false) {
      return { checked: true, verified: false, providerCode: 'AMOUNT_MISMATCH', message: 'ยอดเงินในสลิปไม่ตรงกับยอดที่แจ้งไว้', raw };
    }
    if (body.data?.is_duplicate === true) {
      return { checked: true, verified: false, providerCode: 'SLIP_ALREADY_USED', message: 'สลิปนี้เคยถูกใช้แล้ว (สลิปซ้ำ)', raw };
    }

    const discovered = extractReceiverEvidence(raw);
    const receiver = raw.receiver || {};
    const receiverAccount = receiver.account || {};
    const receiverName = receiver.account?.name || receiver.name || raw.receiver_name || raw.receiverName;
    const receiverNumber = receiverAccount.bank?.account || receiverAccount.proxy?.account || receiver.accountNumber || raw.receiver_account;
    const receiverCheck = receiverMatches({
      actualNames: textValues(receiverName, discovered.names),
      actualNumbers: textValues(receiverNumber, discovered.numbers),
      expectedNames,
      expectedNumbers,
      allowMaskedNumber: true,
    });
    if ((expectedNames.length || expectedNumbers.length) && receiverCheck.hasEvidence && !receiverCheck.matched) {
      return { checked: true, verified: false, providerCode: 'WRONG_RECEIVER', message: 'Slip XEPHT: ผู้รับในสลิปไม่ตรงกับบัญชีร้านค้า', raw };
    }

    return {
      checked: true,
      verified: true,
      providerCode: 'VERIFIED',
      message: 'ตรวจสอบสลิปสำเร็จผ่าน Slip XEPHT',
      raw,
    };
  } catch (error) {
    const body = error.response?.data || {};
    const status = Number(error.response?.status) || null;
    const code = String(body.code || '').trim().toUpperCase();
    const retryable = RETRYABLE_CODES.has(code) || [429, 500, 503].includes(status);
    return {
      checked: !retryable && Boolean(body.code),
      verified: false,
      retryable,
      providerCode: code || null,
      httpStatus: status,
      message: providerMessage(body, error.message || 'เชื่อมต่อ Slip XEPHT ไม่สำเร็จ'),
      raw: body,
    };
  }
}

function validateCredentials(apiKey = '', endpoint = DEFAULT_ENDPOINT) {
  const requested = String(endpoint || '').trim();
  if (requested) {
    try {
      const url = new URL(requested);
      const validPath = url.pathname === '/api/v1' || url.pathname === '/api/v1/';
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'slip.xepht.com' || !validPath) {
        return { ok: false, message: 'Endpoint ต้องเป็น https://slip.xepht.com/api/v1 เท่านั้น' };
      }
    } catch (_) {
      return { ok: false, message: 'รูปแบบ Endpoint ของ Slip XEPHT ไม่ถูกต้อง' };
    }
  }
  return { ok: true, message: String(apiKey || '').trim() ? 'บันทึก Slip XEPHT พร้อม API Key แล้ว' : 'พร้อมใช้ Slip XEPHT (ค่ายนี้ไม่จำเป็นต้องใช้ API Key หากระบบเปิดแบบสาธารณะ)' };
}

module.exports = { DEFAULT_ENDPOINT, RETRYABLE_CODES, normalizeResponse, validateCredentials, verifySlip };
