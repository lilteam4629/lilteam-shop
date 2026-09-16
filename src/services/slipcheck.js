const axios = require('axios');
const FormData = require('form-data');
const { receiverMatches, textValues, extractReceiverEvidence } = require('./receiver-match');
const { numberValue, officialEndpoint } = require('./slip-fields');

const DEFAULT_ENDPOINT = 'https://mxrslip.lovable.app/api/public/v1';

const cleanEndpoint = value => officialEndpoint(value, DEFAULT_ENDPOINT, 'mxrslip.lovable.app');
const keyCursor = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const quotaIsZero = account => account?.ok
  && account.quota?.remaining !== null
  && account.quota?.remaining !== undefined
  && Number.isFinite(Number(account.quota.remaining))
  && Number(account.quota.remaining) <= 0;

function resolveApiKeys(primary, values, maxKeys = 5) {
  const raw = [];
  if (primary) raw.push(primary);
  if (Array.isArray(values)) raw.push(...values);
  else if (values) raw.push(values);
  const keys = raw.flatMap(value => String(value || '').split(/[\r\n,]+/))
    .map(value => value.trim()).filter(Boolean);
  return [...new Set(keys)].slice(0, maxKeys);
}

const maskedKey = key => `••••${String(key || '').slice(-4)}`;

// SlipCheck has returned quota exhaustion in a few different shapes over time
// (HTTP 429, a provider code, or a message containing quota/limit wording).
// Keep this detection in one place so customers see the actionable cause
// instead of a generic receiver or network error.
function isQuotaExhausted(errorOrBody, status) {
  const body = errorOrBody && typeof errorOrBody === 'object' ? errorOrBody : {};
  const values = [
    status,
    body.code, body.errorCode, body.error_code, body.reason,
    body.message, body.error, body.detail,
    body.data && body.data.message, body.data && body.data.error,
  ].filter(value => value !== undefined && value !== null).map(value => String(value).toLowerCase());
  // SlipCheck documents HTTP/code 429 as `quota_exceeded`. Do not reinterpret
  // it as a temporary rate limit: doing so made the pool jump between valid
  // keys even though their /me quota was still available.
  if (Number(status) === 429 || Number(body.code) === 429 || Number(body.errorCode) === 429 || Number(body.error_code) === 429) return true;
  if (values.some(value => /quota.?exceed|quota.*(หมด|ครบ)|limit.?exceed|โควตา.*(หมด|ครบ)/.test(value))) return true;
  const quota = body.quota || (body.data && body.data.quota);
  if (quota && quota.remaining !== undefined && Number(quota.remaining) <= 0) return true;
  return false;
}

function isKeyUnavailable(errorOrBody, status) {
  const body = errorOrBody && typeof errorOrBody === 'object' ? errorOrBody : {};
  if ([401, 403].includes(Number(status)) || [401, 403].includes(Number(body.code))) return true;
  const message = [body.message, body.error, body.detail, body.reason].filter(Boolean).join(' ').toLowerCase();
  return /invalid.*key|api.?key.*invalid|unauthori[sz]ed|forbidden|inactive|disabled|ปิดใช้งาน|คีย์.*ไม่ถูกต้อง/.test(message);
}
async function getAccountInfo(apiKey, endpoint = DEFAULT_ENDPOINT) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, message: 'กรุณากรอก SlipCheck API Key' };
  try {
    const response = await axios.get(`${cleanEndpoint(endpoint)}/me`, {
      headers: { 'x-api-key': key, Accept: 'application/json' }, timeout: 15000,
    });
    const body = response.data || {};
    const quota = body.quota || body.data?.quota || {};
    const used = Number(quota.used || 0);
    const max = Number(quota.limit || quota.max || 0) || null;
    return {
      ok: body.success !== false,
      quota: { used, max, remaining: max === null ? null : Math.max(0, max - used) },
      message: body.message || 'เชื่อมต่อ SlipCheck สำเร็จ',
    };
  } catch (error) {
    return { ok: false, message: error.response?.data?.message || error.message || 'เชื่อมต่อ SlipCheck ไม่สำเร็จ' };
  }
}

async function getPoolAccountInfo(apiKeys, endpoint = DEFAULT_ENDPOINT, options = {}) {
  const keys = resolveApiKeys('', apiKeys, options.independent ? 50 : 5);
  if (!keys.length) return { ok: false, keyCount: 0, accounts: [], totalUsed: 0, totalMax: 0, totalRemaining: 0, message: 'ยังไม่ได้ตั้งค่า SlipCheck API Key' };
  const accounts = await Promise.all(keys.map(async (key, index) => {
    const info = await getAccountInfo(key, endpoint);
    const used = Number(info.quota?.used);
    const max = Number(info.quota?.max);
    const remaining = Number.isFinite(max) ? Math.max(0, max - (Number.isFinite(used) ? used : 0)) : null;
    return { ...info, index: index + 1, key: maskedKey(key), quota: { used: Number.isFinite(used) ? used : 0, max: Number.isFinite(max) ? max : null, remaining } };
  }));
  const quotaAccounts = accounts.filter(account => Number.isFinite(account.quota.remaining));
  // Keys from one account share a quota; keys from separate accounts can be
  // explicitly aggregated by the owner.
  const accountQuota = options.independent
    ? { used: quotaAccounts.reduce((sum, account) => sum + account.quota.used, 0), max: quotaAccounts.reduce((sum, account) => sum + account.quota.max, 0), remaining: quotaAccounts.reduce((sum, account) => sum + account.quota.remaining, 0) }
    : (quotaAccounts[0]?.quota || { used: 0, max: null, remaining: null });
  return {
    ok: accounts.some(account => account.ok), keyCount: keys.length, accounts,
    totalUsed: accountQuota.used,
    totalMax: accountQuota.max,
    totalRemaining: accountQuota.remaining,
    message: accounts.filter(account => !account.ok).map(account => account.message).filter(Boolean).join(' • ') || 'เชื่อมต่อ SlipCheck สำเร็จ',
  };
}

async function verifySlipWithKey(fileBuffer, expectedAmount, fileOptions, credentials, apiKey) {
  if (!apiKey) return { checked: false, verified: false, message: 'ยังไม่ได้ตั้งค่า SlipCheck API Key', raw: null };
  try {
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: fileOptions.filename || 'slip.jpg',
      contentType: fileOptions.contentType || 'image/jpeg',
    });
    const response = await axios.post(`${cleanEndpoint(credentials.endpoint)}/slip/verify`, form, {
      headers: { ...form.getHeaders(), 'x-api-key': apiKey, Accept: 'application/json' }, timeout: 15000,
    });
    const body = response.data || {};
    const data = body.data || {};
    if (!body.success) {
      const quotaExhausted = isQuotaExhausted(body);
      const keyUnavailable = isKeyUnavailable(body);
      return {
        checked: true, verified: false, quotaExhausted, keyUnavailable,
        message: quotaExhausted ? 'โควตาตรวจสลิป SlipCheck หมดแล้ว กรุณาเติมโควตาหรือติดต่อผู้ดูแลระบบ' : (body.message || 'SlipCheck ไม่สามารถยืนยันสลิปนี้ได้'),
        providerCode: body.code || body.errorCode || body.error_code || body.reason || null,
        httpStatus: null,
        raw: body,
      };
    }
    const normalizedRaw = { ...data, transRef: data.ref_no || data.transRef || data.trans_ref || data.reference, date: data.transferred_at || data.date || data.transDateTime, providerResponse: body };
    if (body.duplicate || data.duplicate || data.isDuplicate || data.is_duplicate) return { checked: true, verified: false, message: 'สลิปนี้เคยถูกใช้แล้ว (สลิปซ้ำ)', raw: normalizedRaw };
    const amount = numberValue(data.amount ?? data.transferAmount ?? data.transAmount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(expectedAmount)) > 0.009) {
      return { checked: true, verified: false, message: 'ยอดเงินในสลิปไม่ตรงกับยอดที่แจ้งไว้', raw: normalizedRaw };
    }
    const receiver = data.receiver || data.receiving || data.payee || {};
    const receiverAccount = receiver.account || data.receiver_account || {};
    const discovered = extractReceiverEvidence(data);
    const receiverCheck = receiverMatches({
      actualNames: textValues(data.receiver_name, data.receiverName, receiver.name, receiver.displayName, receiverAccount.name, receiverAccount.displayName, discovered.names),
      actualNumbers: textValues(data.receiver_account_number, data.receiverAccountNumber, receiver.number, receiver.accountNumber, receiverAccount.number, receiverAccount.account, receiverAccount.bankNumber, discovered.numbers),
      expectedNames: credentials.expectedReceiverNames,
      expectedNumbers: credentials.expectedReceiverNumbers,
      allowMaskedNumber: true,
    });
    if (!receiverCheck.matched) {
      return { checked: true, verified: false, message: 'SlipCheck: ผู้รับในสลิปไม่ตรงกับบัญชีร้านค้า', raw: normalizedRaw };
    }
    return {
      checked: true, verified: true, message: 'ตรวจสอบสลิปสำเร็จผ่าน SlipCheck',
      raw: normalizedRaw,
    };
  } catch (error) {
    const body = error.response?.data;
    const status = error.response?.status;
    const quotaExhausted = isQuotaExhausted(body, status);
    const keyUnavailable = isKeyUnavailable(body, status);
    return {
      checked: [401, 403, 422, 429].includes(status) || quotaExhausted, verified: false, quotaExhausted, keyUnavailable,
      message: quotaExhausted ? 'โควตาตรวจสลิป SlipCheck หมดแล้ว กรุณาเติมโควตาหรือติดต่อผู้ดูแลระบบ' : (body?.message || error.message || 'เชื่อมต่อ SlipCheck ไม่สำเร็จ'), raw: body || null,
      providerCode: body?.code || body?.errorCode || body?.error_code || body?.reason || null,
      httpStatus: Number(status) || null,
    };
  }
}

async function verifySlip(fileBuffer, expectedAmount, fileOptions = {}, credentials = {}) {
  const apiKeys = resolveApiKeys(credentials.apiKey, credentials.apiKeys, credentials.independentQuota ? 50 : 5);
  if (!apiKeys.length) return { checked: false, verified: false, message: 'ยังไม่ได้ตั้งค่า SlipCheck API Key', raw: null };
  const cursorKey = `${cleanEndpoint(credentials.endpoint)}|${apiKeys.join('|')}`;
  const start = (keyCursor.get(cursorKey) || 0) % apiKeys.length;
  let lastResult = null;
  for (let offset = 0; offset < apiKeys.length; offset += 1) {
    const index = (start + offset) % apiKeys.length;
    let result = await verifySlipWithKey(fileBuffer, expectedAmount, fileOptions, credentials, apiKeys[index]);
    lastResult = result;

    if (result.quotaExhausted) {
      const after = await getAccountInfo(apiKeys[index], credentials.endpoint);
      if (quotaIsZero(after)) {
        keyCursor.set(cursorKey, (index + 1) % apiKeys.length);
        if (offset < apiKeys.length - 1) continue;
        return result;
      } else if (after.ok && Number(after.quota?.remaining) > 0) {
        // A fresh /me response says this key is usable. Retry this same key
        // once to recover from a stale/transient 429 without touching the
        // next configured key or leaving the customer waiting for minutes.
        await wait(500);
        result = await verifySlipWithKey(fileBuffer, expectedAmount, fileOptions, credentials, apiKeys[index]);
        if (!result.quotaExhausted) {
          keyCursor.set(cursorKey, index);
          return result;
        }
      }
      // Provider returned 429 while /me still says this exact key has quota.
      // Keep the cursor on it; switching here violates configured key order
      // and hides a provider inconsistency behind a misleading rate-limit UI.
      keyCursor.set(cursorKey, index);
      return {
        ...result,
        quotaExhausted: false,
        quotaMismatch: true,
        message: after.ok && Number(after.quota?.remaining) > 0
          ? 'SlipCheck ตอบว่าโควตาหมด แต่คีย์ปัจจุบันยังมีโควตา ระบบยังคงใช้คีย์เดิม กรุณากดตรวจสลิปเดิมอีกครั้ง'
          : 'SlipCheck ตอบว่าโควตาหมด แต่ยังยืนยันไม่ได้ว่าโควตาคีย์ปัจจุบันเหลือ 0 ระบบจึงยังไม่ข้ามคีย์ กรุณากดตรวจสลิปเดิมอีกครั้ง',
      };
    }
    if (result.keyUnavailable) {
      // A bad/disabled key is a configuration error, not permission to skip
      // the configured order. Keep it selected so an operator can fix it.
      keyCursor.set(cursorKey, index);
      return result;
    }
    // Keep using the same working key. Advance only after that key runs out
    // of quota or becomes unavailable, so usage follows the configured order.
    keyCursor.set(cursorKey, index);
    return result;
  }
  return lastResult;
}

module.exports = { DEFAULT_ENDPOINT, getAccountInfo, getPoolAccountInfo, resolveApiKeys, verifySlip };
