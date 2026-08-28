const axios = require('axios');
const FormData = require('form-data');

// EasySlip API v2 — one central platform API key (yours) can register bank
// accounts for many different tenants; each account created via
// POST /v2/bank-accounts is auto-linked to the Branch/Service that owns the
// API key. This lets a tenant just type their own bank details into OUR
// site and have EasySlip verification work for their own account, with no
// EasySlip signup/dashboard access required on their end.
//
// Confirmed against https://document.easyslip.com/th/v2 (bank-accounts/create
// and verify/bank docs, screenshots reviewed 2026-08-28).
const API_KEY = process.env.EASYSLIP_API_KEY;
const BASE_URL = 'https://api.easyslip.com/v2';

// Bank account numbers are compared after stripping formatting (dashes/
// spaces) since a shop's own stored bankAccountNumber ("123-4-56789-0") and
// EasySlip's matchedAccount.bankNumber won't necessarily use the same
// separators.
const normalizeAccountNumber = (value) => String(value || '').replace(/[\s-]/g, '');

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

/**
 * Verify a slip image against an expected amount AND expected receiving
 * account via EasySlip (POST /v2/verify/bank). `expectedAccount` should be
 * the CURRENT shop's own registered account ({ bankNumber, bankCode }) —
 * matchAccount:true makes EasySlip resolve the slip's receiver against
 * every bank account registered on our platform's branch (i.e. every
 * tenant shop's account), so we still must confirm the match belongs to
 * THIS shop and not some other tenant sharing the same branch.
 * Returns { checked, verified, message, raw } — checked is false when
 * EasySlip isn't configured (caller should fall back to manual review).
 */
async function verifySlip(fileInput, expectedAmount, fileOptions = {}, expectedAccount = {}) {
  if (!isConfigured()) {
    return { checked: false, verified: false, message: 'ยังไม่ได้ตั้งค่า EasySlip — ใช้การตรวจสอบด้วยแอดมินแทน', raw: null };
  }
  try {
    const form = new FormData();
    form.append('image', fileInput, {
      filename: fileOptions.filename || 'slip.jpg',
      contentType: fileOptions.contentType || 'image/jpeg',
    });
    form.append('matchAmount', String(expectedAmount));
    form.append('matchAccount', 'true');
    form.append('checkDuplicate', 'true');

    const res = await axios.post(`${BASE_URL}/verify/bank`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${API_KEY}` },
      timeout: 20000,
    });

    const body = res.data;
    if (!body || !body.success) {
      return { checked: true, verified: false, message: (body && body.message) || 'ตรวจสอบสลิปไม่สำเร็จ', raw: body };
    }
    const data = body.data;
    if (data.isDuplicate) {
      return { checked: true, verified: false, message: 'สลิปนี้เคยถูกใช้ยืนยันไปแล้ว (สลิปซ้ำ)', raw: data };
    }
    if (data.isAmountMatched === false) {
      return { checked: true, verified: false, message: 'ยอดเงินในสลิปไม่ตรงกับยอดที่แจ้งไว้', raw: data };
    }
    const matched = data.matchedAccount;
    if (!matched) {
      return { checked: true, verified: false, message: 'ไม่พบบัญชีผู้รับที่ตรงกับบัญชีที่ลงทะเบียนไว้', raw: data };
    }
    const accountMatches = !expectedAccount.bankNumber
      || normalizeAccountNumber(matched.bankNumber) === normalizeAccountNumber(expectedAccount.bankNumber);
    if (!accountMatches) {
      return { checked: true, verified: false, message: 'บัญชีผู้รับในสลิปไม่ตรงกับบัญชีร้านค้า', raw: data };
    }
    return { checked: true, verified: true, message: 'ตรวจสอบสลิปสำเร็จผ่าน EasySlip', raw: data };
  } catch (err) {
    const body = err.response && err.response.data;
    const error = body && body.error;
    return {
      checked: true,
      verified: false,
      message: (error && error.message) || err.message || 'เชื่อมต่อ EasySlip ไม่สำเร็จ',
      raw: body || null,
    };
  }
}

module.exports = { isConfigured, createBankAccount, verifySlip };
