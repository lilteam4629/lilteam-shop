const axios = require('axios');
const FormData = require('form-data');
const { receiverMatches, textValues, extractReceiverEvidence } = require('./receiver-match');
const { numberValue, officialEndpoint } = require('./slip-fields');

const DEFAULT_ENDPOINT = 'https://suba.rdcw.co.th/v2/inquiry';
async function verifySlip(fileBuffer, expectedAmount, fileOptions = {}, credentials = {}) {
  const clientId = String(credentials.clientId || '').trim();
  const clientSecret = String(credentials.clientSecret || '').trim();
  const endpoint = officialEndpoint(credentials.endpoint, DEFAULT_ENDPOINT, 'suba.rdcw.co.th');
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
    const responseCode = Number(body.code ?? body.statusCode);
    if (body.success === false || (Number.isFinite(responseCode) && responseCode >= 1000)) {
      const messages = { 1003: 'IP ของเซิร์ฟเวอร์ยังไม่ได้รับอนุญาตใน SlipRDCW', 1007: 'โควตา SlipRDCW หมดแล้ว', 1008: 'แพ็กเกจ SlipRDCW หมดอายุแล้ว' };
      return { checked: [1004, 1005, 1006, 1007, 1008].includes(responseCode), verified: false, message: messages[responseCode] || body.message || 'ตรวจสลิปผ่าน SlipRDCW ไม่สำเร็จ', raw: body };
    }
    const transRef = data.transRef || data.trans_ref || data.ref || data.reference || null;
    const normalizedRaw = { ...data, transRef, transDate: data.transDate, transTime: data.transTime, providerResponse: body };
    const amountRaw = data.amount ?? data.transferAmount ?? data.transAmount;
    // RDCW responses commonly use satang; accept baht when already equal.
    const parsed = numberValue(amountRaw);
    const amount = Math.abs(parsed - Number(expectedAmount)) < 0.009 ? parsed : parsed / 100;
    if (!Number.isFinite(amount) || Math.abs(amount - Number(expectedAmount)) > 0.009) {
      return { checked: true, verified: false, message: 'ยอดเงินในสลิปไม่ตรงกับยอดที่แจ้งไว้', raw: normalizedRaw };
    }
    if (data.duplicate || data.isDuplicate || data.is_duplicate) {
      return { checked: true, verified: false, message: 'สลิปนี้เคยถูกใช้แล้ว (สลิปซ้ำ)', raw: normalizedRaw };
    }
    const receiver = data.receiver || data.receiving || data.receiverAccount || {};
    const receiverAccount = receiver.account || {};
    const discovered = extractReceiverEvidence(data);
    const receiverCheck = receiverMatches({
      actualNames: textValues(receiver.name, receiver.displayName, receiverAccount.name, data.receiverName, discovered.names),
      actualNumbers: textValues(receiver.number, receiver.accountNumber, receiverAccount.number, receiverAccount.account, receiverAccount.bankNumber, data.receiverAccountNumber, discovered.numbers),
      expectedNames: credentials.expectedReceiverNames,
      expectedNumbers: credentials.expectedReceiverNumbers,
    });
    if (!receiverCheck.matched) {
      return { checked: true, verified: false, message: 'SlipRDCW: ผู้รับในสลิปไม่ตรงกับบัญชีร้านค้า', raw: normalizedRaw };
    }
    return {
      checked: true, verified: true, message: 'ตรวจสอบสลิปสำเร็จผ่าน SlipRDCW',
      raw: normalizedRaw,
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
