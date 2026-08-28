const axios = require('axios');

// EasySlip API v2 — one central platform API key (yours) can register bank
// accounts for many different tenants; each account created via
// POST /v2/bank-accounts is auto-linked to the Branch/Service that owns the
// API key. This lets a tenant just type their own bank details into OUR
// site and have EasySlip verification work for their own account, with no
// EasySlip signup/dashboard access required on their end.
//
// Confirmed against https://document.easyslip.com/th/v2/bank-accounts/create
// (screenshots reviewed 2026-08-28). The slip-verification endpoint itself
// is NOT yet wired up here — its request/response shape hasn't been
// confirmed against real documentation, so calling it would mean guessing.
// Do not add a verifySlip() here until that's confirmed.
const API_KEY = process.env.EASYSLIP_API_KEY;
const BASE_URL = 'https://api.easyslip.com/v2';

const isConfigured = () => Boolean(API_KEY);

function authHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
}

/**
 * Register a tenant's own bank account with EasySlip, linked automatically
 * to our platform's Branch (serviceId is derived server-side from API_KEY —
 * cannot and does not need to be passed).
 * Returns { ok: true, account } or { ok: false, code, message }.
 */
async function createBankAccount({ bankCode, bankNumber, nameTh, nameEn, type, extraVerify }) {
  if (!isConfigured()) {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY' };
  }
  try {
    const res = await axios.post(
      `${BASE_URL}/bank-accounts`,
      { bankCode, bankNumber, nameTh, nameEn, type, ...(extraVerify ? { extraVerify } : {}) },
      { headers: authHeaders(), timeout: 15000 }
    );
    if (res.data && res.data.success) {
      return { ok: true, account: res.data.data };
    }
    return { ok: false, code: 'UNKNOWN', message: 'สร้างบัญชีไม่สำเร็จ' };
  } catch (err) {
    const body = err.response && err.response.data;
    const error = body && body.error;
    return {
      ok: false,
      code: (error && error.code) || 'REQUEST_FAILED',
      message: (error && error.message) || err.message || 'เชื่อมต่อ EasySlip ไม่สำเร็จ',
    };
  }
}

module.exports = { isConfigured, createBankAccount };
