const axios = require('axios');
const FormData = require('form-data');
const { receiverMatches, textValues, extractReceiverEvidence } = require('./receiver-match');
const { numberValue, officialEndpoint } = require('./slip-fields');

const DEFAULT_ENDPOINT = 'https://mxrslip.lovable.app/api/public/v1';

const cleanEndpoint = value => officialEndpoint(value, DEFAULT_ENDPOINT, 'mxrslip.lovable.app');
const keyCursor = new Map();

function resolveApiKeys(primary, values) {
  const raw = [];
  if (primary) raw.push(primary);
  if (Array.isArray(values)) raw.push(...values);
  else if (values) raw.push(values);
  const keys = raw.flatMap(value => String(value || '').split(/[\r\n,]+/))
    .map(value => value.trim()).filter(Boolean);
  return [...new Set(keys)].slice(0, 50);
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
  if (Number(status) === 429 || Number(body.code) === 429 || Number(body.errorCode) === 429 || Number(body.error_code) === 429) return true;
  if (values.some(value => /quota|rate.?limit|too many|limit.?exceed|เครดิต|โควตา|จำกัดการใช้งาน/.test(value))) return true;
  const quota = body.quota || (body.data && body.data.quota);
  if (quota && quota.remaining !== undefined && Number(quota.remaining) <= 0) return true;
  return false;
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

async function getPoolAccountInfo(apiKeys, endpoint = DEFAULT_ENDPOINT) {
  const keys = resolveApiKeys('', apiKeys);
  if (!keys.length) return { ok: false, keyCount: 0, accounts: [], totalUsed: 0, totalMax: 0, totalRemaining: 0, message: 'ยังไม่ได้ตั้งค่า SlipCheck API Key' };
  const accounts = await Promise.all(keys.map(async (key, index) => {
    const info = await getAccountInfo(key, endpoint);
    const used = Number(info.quota?.used);
    const max = Number(info.quota?.max);
    const remaining = Number.isFinite(max) ? Math.max(0, max - (Number.isFinite(used) ? used : 0)) : null;
    return { ...info, index: index + 1, key: maskedKey(key), quota: { used: Number.isFinite(used) ? used : 0, max: Number.isFinite(max) ? max : null, remaining } };
  }));
  const quotaAccounts = accounts.filter(account => Number.isFinite(account.quota.remaining));
  // SlipCheck's dashboard exposes one monthly quota per account. Multiple API
  // keys are failover credentials for that account, so do not multiply the
  // account quota by the number of keys.
  const accountQuota = quotaAccounts[0]?.quota || { used: 0, max: null, remaining: null };
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
      headers: { ...form.getHeaders(), 'x-api-key': apiKey, Accept: 'application/json' }, timeout: 60000,
    });
    const body = response.data || {};
    const data = body.data || {};
    if (!body.success) {
      const quotaExhausted = isQuotaExhausted(body);
      return {
        checked: true, verified: false, quotaExhausted,
        message: quotaExhausted ? 'โควตาตรวจสลิป SlipCheck หมดแล้ว กรุณาเติมโควตาหรือติดต่อผู้ดูแลระบบ' : (body.message || 'SlipCheck ไม่สามารถยืนยันสลิปนี้ได้'),
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
    return {
      checked: [401, 403, 422, 429].includes(status) || quotaExhausted, verified: false, quotaExhausted,
      message: quotaExhausted ? 'โควตาตรวจสลิป SlipCheck หมดแล้ว กรุณาเติมโควตาหรือติดต่อผู้ดูแลระบบ' : (body?.message || error.message || 'เชื่อมต่อ SlipCheck ไม่สำเร็จ'), raw: body || null,
    };
  }
}

async function verifySlip(fileBuffer, expectedAmount, fileOptions = {}, credentials = {}) {
  const apiKeys = resolveApiKeys(credentials.apiKey, credentials.apiKeys);
  if (!apiKeys.length) return { checked: false, verified: false, message: 'ยังไม่ได้ตั้งค่า SlipCheck API Key', raw: null };
  const cursorKey = `${cleanEndpoint(credentials.endpoint)}|${apiKeys.join('|')}`;
  const start = (keyCursor.get(cursorKey) || 0) % apiKeys.length;
  let lastResult = null;
  for (let offset = 0; offset < apiKeys.length; offset += 1) {
    const index = (start + offset) % apiKeys.length;
    const result = await verifySlipWithKey(fileBuffer, expectedAmount, fileOptions, credentials, apiKeys[index]);
    lastResult = result;
    keyCursor.set(cursorKey, (index + 1) % apiKeys.length);
    if (!result.quotaExhausted || offset === apiKeys.length - 1) return result;
  }
  return lastResult;
}

module.exports = { DEFAULT_ENDPOINT, getAccountInfo, getPoolAccountInfo, resolveApiKeys, verifySlip };
