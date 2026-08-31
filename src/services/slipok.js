const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const DEFAULT_BRANCH_ID = process.env.SLIPOK_BRANCH_ID;
const DEFAULT_API_KEY = process.env.SLIPOK_API_KEY;

const ERROR_MESSAGES = {
  1010: 'สลิปนี้เป็นรายการที่โอนมานานเกินไป (delay slip)',
  1012: 'สลิปนี้เคยถูกใช้ยืนยันไปแล้ว (สลิปซ้ำ)',
  1013: 'ยอดเงินในสลิปไม่ตรงกับยอดที่แจ้งไว้',
  1014: 'บัญชีผู้รับในสลิปไม่ตรงกับบัญชีร้านค้า',
};

// A shop may bring its own SlipOK branch (see settings.payment.slipokBranchId/
// slipokApiKey, set at /admin/topups) so slip checks verify against ITS OWN
// bank account rather than the main site's. Falls back to the global
// SLIPOK_BRANCH_ID/SLIPOK_API_KEY env vars when a shop hasn't set its own.
function resolveCredentials(credentials = {}) {
  return {
    branchId: credentials.branchId || DEFAULT_BRANCH_ID,
    apiKey: credentials.apiKey || DEFAULT_API_KEY,
  };
}

const isConfigured = (credentials) => {
  const { branchId, apiKey } = resolveCredentials(credentials);
  return Boolean(branchId && apiKey);
};

/**
 * Parse SlipOK's transDate (yyyyMMdd) + transTime (HH:mm:ss) — always Thai
 * local time (UTC+7) — into a real Date object usable for age comparisons.
 */
function parseTransDateTime(transDate, transTime) {
  if (!transDate || !transTime || transDate.length !== 8) return null;
  const y = transDate.slice(0, 4);
  const m = transDate.slice(4, 6);
  const d = transDate.slice(6, 8);
  const parsed = new Date(`${y}-${m}-${d}T${transTime}+07:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Verify a slip image against an expected amount via SlipOK.
 * Returns { checked, verified, message, raw } — checked is false when
 * SlipOK isn't configured (caller should fall back to manual review).
 */
async function verifySlip(fileInput, expectedAmount, fileOptions = {}, credentials) {
  const { branchId: BRANCH_ID, apiKey: API_KEY } = resolveCredentials(credentials);
  if (!BRANCH_ID || !API_KEY) {
    return { checked: false, verified: false, message: 'ยังไม่ได้ตั้งค่า SlipOK — ใช้การตรวจสอบด้วยแอดมินแทน', raw: null };
  }

  try {
    const form = new FormData();
    if (Buffer.isBuffer(fileInput)) {
      form.append('files', fileInput, {
        filename: fileOptions.filename || 'slip.jpg',
        contentType: fileOptions.contentType || 'image/jpeg',
      });
    } else {
      form.append('files', fs.createReadStream(fileInput));
    }
    form.append('amount', String(expectedAmount));
    form.append('log', 'true');

    const res = await axios.post(
      `https://api.slipok.com/api/line/apikey/${BRANCH_ID}`,
      form,
      { headers: { ...form.getHeaders(), 'x-authorization': API_KEY }, timeout: 300000 }
    );

    const body = res.data;
    if (body && body.success && body.data && body.data.success) {
      return {
        checked: true,
        verified: true,
        message: 'ตรวจสอบสลิปสำเร็จผ่าน SlipOK',
        raw: body.data,
      };
    }

    const code = body && (body.code || (body.data && body.data.code));
    return {
      checked: true,
      verified: false,
      message: ERROR_MESSAGES[code] || (body && body.message) || 'ไม่สามารถยืนยันสลิปนี้ได้',
      raw: body,
    };
  } catch (err) {
    // No response at all (timeout, DNS/network failure) means SlipOK never
    // actually looked at the slip — not the same as a real verification
    // failure, so fall back to manual admin review (checked: false) instead
    // of telling the customer their slip "failed" over a slow API.
    if (!err.response) {
      return {
        checked: false, verified: false,
        message: 'ระบบตรวจสอบสลิปอัตโนมัติไม่ตอบสนอง (อาจช้าชั่วคราว) — แนบสลิปไว้แล้ว รอแอดมินตรวจสอบให้แทน',
        raw: null,
      };
    }
    const body = err.response.data;
    const code = body && (body.code || (body.data && body.data.code));
    return {
      checked: true,
      verified: false,
      message: ERROR_MESSAGES[code] || (body && body.message) || 'เชื่อมต่อ SlipOK ไม่สำเร็จ',
      raw: body || null,
    };
  }
}

module.exports = { verifySlip, isConfigured, parseTransDateTime };
