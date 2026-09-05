const axios = require('axios');
const FormData = require('form-data');

const DEFAULT_ENDPOINT = 'https://suba.rdcw.co.th/v2/inquiry';
const normalize = value => String(value || '').toLocaleLowerCase('th-TH').replace(/(นาย|นางสาว|นาง|คุณ)/g, '').replace(/[^a-z0-9ก-๙]/g, '');

async function verifySlip(fileBuffer, expectedAmount, fileOptions = {}, credentials = {}) {
  const clientId = String(credentials.clientId || '').trim();
  const clientSecret = String(credentials.clientSecret || '').trim();
  const endpoint = String(credentials.endpoint || DEFAULT_ENDPOINT).trim();
  if (!clientId || !clientSecret) {
    return { checked: false, verified: false, message: 'ยังไม่ได้ตั้งค่า SlipRDCW Client ID และ Client Secret', raw: null };
  }
  try {
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: fileOptions.filename || 'slip.jpg',
      contentType: fileOptions.contentType || 'image/jpeg',
    });
    const response = await axios.post(endpoint, form, {
      auth: { username: clientId, password: clientSecret },
      headers: { ...form.getHeaders(), Accept: 'application/json' }, timeout: 60000,
    });
    const body = response.data || {};
    const data = body.data?.data || body.data || body;
    const amountRaw = data.amount ?? data.transferAmount ?? data.transAmount;
    // RDCW responses commonly use satang; accept baht when already equal.
    const parsed = Number(amountRaw);
    const amount = Math.abs(parsed - Number(expectedAmount)) < 0.009 ? parsed : parsed / 100;
    if (!Number.isFinite(amount) || Math.abs(amount - Number(expectedAmount)) > 0.009) {
      return { checked: true, verified: false, message: 'ยอดเงินในสลิปไม่ตรงกับยอดที่แจ้งไว้', raw: body };
    }
    const receiver = data.receiver || data.receiving || data.receiverAccount || {};
    const receiverName = normalize(receiver.name || receiver.displayName || data.receiverName);
    const expectedNames = (credentials.expectedReceiverNames || []).map(normalize).filter(Boolean);
    if (!receiverName || !expectedNames.some(name => receiverName === name || receiverName.includes(name) || name.includes(receiverName))) {
      return { checked: true, verified: false, message: 'ชื่อผู้รับในสลิปไม่ตรงกับชื่อบัญชีร้านค้า', raw: body };
    }
    const transRef = data.transRef || data.trans_ref || data.ref || data.reference || null;
    return {
      checked: true, verified: true, message: 'ตรวจสอบสลิปสำเร็จผ่าน SlipRDCW',
      raw: { ...data, transRef, transDate: data.transDate, transTime: data.transTime, providerResponse: body },
    };
  } catch (error) {
    const body = error.response?.data;
    const code = Number(body?.code);
    const definitive = error.response?.status === 400 && [1004, 1005, 1006, 1007, 1008].includes(code);
    const messages = {
      1003: 'IP ของเซิร์ฟเวอร์ยังไม่ได้รับอนุญาตใน SlipRDCW',
      1007: 'โควตา SlipRDCW หมดแล้ว',
      1008: 'แพ็กเกจ SlipRDCW หมดอายุแล้ว',
    };
    return {
      checked: definitive, verified: false,
      message: messages[code] || body?.message || error.message || 'เชื่อมต่อ SlipRDCW ไม่สำเร็จ', raw: body || null,
    };
  }
}

function validateCredentials(clientId, clientSecret) {
  if (!String(clientId || '').trim() || !String(clientSecret || '').trim()) {
    return { ok: false, message: 'กรุณากรอก Client ID และ Client Secret ให้ครบ' };
  }
  return { ok: true, message: 'รูปแบบข้อมูลครบแล้ว ระบบจะตรวจการเชื่อมต่อเมื่อใช้สลิปจริงครั้งแรก' };
}

module.exports = { DEFAULT_ENDPOINT, verifySlip, validateCredentials };
