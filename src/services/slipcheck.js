const axios = require('axios');
const FormData = require('form-data');

const DEFAULT_ENDPOINT = 'https://mxrslip.lovable.app/api/public/v1';

const cleanEndpoint = value => String(value || DEFAULT_ENDPOINT).trim().replace(/\/$/, '');
const normalizeName = value => String(value || '').toLocaleLowerCase('th-TH').replace(/(นาย|นางสาว|นาง|คุณ)/g, '').replace(/[^a-z0-9ก-๙]/g, '');

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
    if (body.duplicate) return { checked: true, verified: false, message: 'สลิปนี้เคยถูกใช้แล้ว (สลิปซ้ำ)', raw: body };
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(expectedAmount)) > 0.009) {
      return { checked: true, verified: false, message: 'ยอดเงินในสลิปไม่ตรงกับยอดที่แจ้งไว้', raw: body };
    }
    const receiver = normalizeName(data.receiver_name);
    const expectedNames = (credentials.expectedReceiverNames || []).map(normalizeName).filter(Boolean);
    if (!receiver || !expectedNames.some(name => receiver === name || receiver.includes(name) || name.includes(receiver))) {
      return { checked: true, verified: false, message: 'ชื่อผู้รับในสลิปไม่ตรงกับชื่อบัญชีร้านค้า', raw: body };
    }
    return {
      checked: true, verified: true, message: 'ตรวจสอบสลิปสำเร็จผ่าน SlipCheck',
      raw: { ...data, transRef: data.ref_no, date: data.transferred_at, providerResponse: body },
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
