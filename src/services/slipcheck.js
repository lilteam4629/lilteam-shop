const axios = require('axios');
const FormData = require('form-data');
const { receiverMatches, textValues, extractReceiverEvidence } = require('./receiver-match');
const { numberValue, officialEndpoint } = require('./slip-fields');

const DEFAULT_ENDPOINT = 'https://mxrslip.lovable.app/api/public/v1';

const cleanEndpoint = value => officialEndpoint(value, DEFAULT_ENDPOINT, 'mxrslip.lovable.app');
async function getAccountInfo(apiKey, endpoint = DEFAULT_ENDPOINT) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, message: 'กรุณากรอก SlipCheck API Key' };
  try {
    const response = await axios.get(`${cleanEndpoint(endpoint)}/me`, {
      headers: { 'x-api-key': key, Accept: 'application/json' }, timeout: 15000,
    });
    const body = response.data || {};
    const quota = body.quota || body.data?.quota || {};
    return {
      ok: body.success !== false,
      quota: { used: Number(quota.used || 0), max: Number(quota.limit || quota.max || 0) || null },
      message: body.message || 'เชื่อมต่อ SlipCheck สำเร็จ',
    };
  } catch (error) {
    return { ok: false, message: error.response?.data?.message || error.message || 'เชื่อมต่อ SlipCheck ไม่สำเร็จ' };
  }
}

async function verifySlip(fileBuffer, expectedAmount, fileOptions = {}, credentials = {}) {
  const apiKey = String(credentials.apiKey || '').trim();
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
    if (!body.success) return { checked: true, verified: false, message: body.message || 'SlipCheck ไม่สามารถยืนยันสลิปนี้ได้', raw: body };
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
    const definitive = [401, 403, 422, 429].includes(error.response?.status);
    return {
      checked: definitive, verified: false,
      message: body?.message || error.message || 'เชื่อมต่อ SlipCheck ไม่สำเร็จ', raw: body || null,
    };
  }
}

module.exports = { DEFAULT_ENDPOINT, getAccountInfo, verifySlip };
