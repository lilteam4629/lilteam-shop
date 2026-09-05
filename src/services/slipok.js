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
    // Landing here at all means the HTTP request/response cycle itself
    // failed (timeout, DNS/network failure, a non-2xx status) — SlipOK
    // never actually reached a real success/fail determination on the
    // slip. A genuine "your slip is wrong" result comes back as a normal
    return {
      checked: false,
      verified: false,
      message: 'ระบบเติมเงินมีปัญหาชั่วคราว — แนบสลิปไว้แล้ว รอแอดมินตรวจสอบให้',
      raw: (err.response && err.response.data) || null,
    };
  }
}

/**
 * Test SlipOK connection and credentials.
 */
async function testConnection(credentials = {}) {
  const { branchId, apiKey } = resolveCredentials(credentials);
  const cleanBranch = String(branchId || '').trim();
  const cleanKey = String(apiKey || '').trim();

  if (!cleanBranch || !cleanKey) {
    return { ok: false, message: 'กรุณากรอก Branch ID และ API Key ของ SlipOK' };
  }

  if (cleanKey.startsWith('test_') || cleanKey.startsWith('demo_') || cleanKey === 'SLIPOK_DEMO_KEY' || cleanBranch === 'demo') {
    return {
      ok: true,
      quota: 1000,
      branchId: cleanBranch,
      isDemo: true,
      message: 'เชื่อมต่อ SlipOK สำเร็จ (โหมดจำลอง Test/Demo Key)'
    };
  }

  try {
    const res = await axios.get(`https://api.slipok.com/api/line/apikey/${cleanBranch}/quota`, {
      headers: { 'x-authorization': cleanKey },
      timeout: 10000
    });

    if (res.data && (res.data.success || res.data.quota !== undefined)) {
      return {
        ok: true,
        quota: res.data.quota || res.data.data?.quota || 'ไม่จำกัด',
        message: 'เชื่อมต่อ SlipOK สำเร็จ'
      };
    }
    return {
      ok: true,
      message: 'เชื่อมต่อ SlipOK สำเร็จ'
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    return {
      ok: false,
      message: `ไม่สามารถเชื่อมต่อ SlipOK: ${msg}`
    };
  }
}

module.exports = { verifySlip, isConfigured, parseTransDateTime, resolveCredentials, testConnection };
