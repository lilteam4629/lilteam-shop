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

let banksCache = null;

/**
 * Fixed list of the 17 banks EasySlip supports (GET /v2/banks) — cached in
 * memory for the life of the process since the list is documented as
 * static. Returns [] if not configured or the request fails.
 */
async function getBanks() {
  if (banksCache) return banksCache;
  if (!isConfigured()) return [];
  try {
    const res = await axios.get(`${BASE_URL}/banks`, { headers: authHeaders(), timeout: 15000 });
    if (res.data && res.data.success && Array.isArray(res.data.data)) {
      banksCache = res.data.data;
      return banksCache;
    }
    return [];
  } catch (err) {
    return [];
  }
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
 * Fixes up an already-registered account in place (e.g. one created before
 * this app started sending extraVerify, so it exists but with no
 * verification method) — createBankAccount can't do this since a duplicate
 * bankNumber is rejected outright rather than merged. Only fields passed
 * are changed; per EasySlip's docs, omitting extraVerify here keeps
 * whatever it already had, so callers must pass it explicitly (or `null`
 * to clear it) when that's what they mean to change.
 * Returns { ok: true, account } or { ok: false, code, message }.
 */
async function updateBankAccount(accountId, { extraVerify }) {
  if (!isConfigured()) {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY' };
  }
  try {
    const res = await axios.patch(
      `${BASE_URL}/bank-accounts/${accountId}`,
      { extraVerify },
      { headers: authHeaders(), timeout: 15000 }
    );
    if (res.data && res.data.success) {
      return { ok: true, account: res.data.data };
    }
    return { ok: false, code: 'UNKNOWN', message: 'แก้ไขบัญชีไม่สำเร็จ' };
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
 * account via EasySlip (POST /v2/verify/bank). `expectedNumbers` should be
 * every number the CURRENT shop registered its account under (its real
 * bank account number AND, if also registered, its PromptPay number —
 * they can differ, since PromptPay identifies by phone/ID, not the bank
 * account number) — matchAccount:true makes EasySlip resolve the slip's
 * receiver against every bank account registered on our platform's branch
 * (i.e. every tenant shop's account), so we still must confirm the match
 * belongs to THIS shop and not some other tenant sharing the same branch.
 * Returns { checked, verified, message, raw } — checked is false when
 * EasySlip isn't configured (caller should fall back to manual review).
 */
async function verifySlip(fileInput, expectedAmount, fileOptions = {}, expectedNumbers = []) {
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
      timeout: 300000,
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
    const normalizedExpected = expectedNumbers.map(normalizeAccountNumber).filter(Boolean);
    if (!normalizedExpected.length) {
      return { checked: false, verified: false, message: 'ร้านยังไม่ได้ตั้งค่าบัญชีรับเงินสำหรับตรวจอัตโนมัติ — รอแอดมินตรวจสอบ', raw: data };
    }
    const accountMatches = normalizedExpected.includes(normalizeAccountNumber(matched.bankNumber));
    if (!accountMatches) {
      return { checked: true, verified: false, message: 'บัญชีผู้รับในสลิปไม่ตรงกับบัญชีร้านค้า', raw: data };
    }
    return { checked: true, verified: true, message: 'ตรวจสอบสลิปสำเร็จผ่าน EasySlip', raw: data };
  } catch (err) {
    // Landing here at all means the HTTP request/response cycle itself
    // failed (timeout, DNS/network failure, a non-2xx status) — EasySlip
    // never actually reached a real success/fail determination on the
    // slip. A genuine "your slip is wrong" result comes back as a normal
    // 200 response with success:false, handled above in the try block, not
    // here. So every path through this catch is "couldn't check", not
    // "checked and failed" — fall back to manual admin review instead of
    // telling the customer their slip was rejected.
    return {
      checked: false, verified: false,
      message: 'ระบบเติมเงินมีปัญหาจาก ESL ชั่วคราว — แนบสลิปไว้แล้ว รอแอดมินตรวจสอบให้',
      raw: (err.response && err.response.data) || null,
    };
  }
}

/**
 * GET /v2/info — platform-wide account info for the one shared EASYSLIP_API_KEY
 * (yours, not any individual tenant's). Does not deduct quota. Returns
 * { ok: true, quota: {used, max, remaining}, credit, planName } or
 * { ok: false, message }.
 */
async function getAccountInfo() {
  if (!isConfigured()) {
    return { ok: false, message: 'ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY' };
  }
  try {
    const res = await axios.get(`${BASE_URL}/info`, { headers: authHeaders(), timeout: 15000 });
    const data = res.data && res.data.data;
    if (!res.data || !res.data.success || !data) {
      return { ok: false, message: 'ดึงข้อมูลบัญชี EasySlip ไม่สำเร็จ' };
    }
    return {
      ok: true,
      quota: {
        used: data.application && data.application.quota ? data.application.quota.used : null,
        max: data.application && data.application.quota ? data.application.quota.max : null,
        remaining: data.application && data.application.quota ? data.application.quota.remaining : null,
      },
      credit: data.account ? data.account.credit : null,
      planName: data.product ? data.product.name : null,
    };
  } catch (err) {
    const body = err.response && err.response.data;
    const error = body && body.error;
    return { ok: false, message: (error && error.message) || err.message || 'เชื่อมต่อ EasySlip ไม่สำเร็จ' };
  }
}

module.exports = { isConfigured, createBankAccount, updateBankAccount, verifySlip, getBanks, getAccountInfo };
