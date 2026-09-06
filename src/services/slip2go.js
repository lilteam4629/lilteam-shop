const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { receiverMatches, textValues, extractReceiverEvidence } = require('./receiver-match');
const { numberValue, officialEndpoint } = require('./slip-fields');

/**
 * Slip2Go API Integration Service (slip2go.com)
 * Provides methods for verifying bank & PromptPay slips via Slip2Go API.
 */

const DEFAULT_ENDPOINT = 'https://connect.slip2go.com/api';

/**
 * Test Slip2Go connection and check balance / status.
 */
async function checkBalance(apiKey, customEndpoint = null) {
  const endpoint = officialEndpoint(customEndpoint, DEFAULT_ENDPOINT, 'connect.slip2go.com');
  const cleanKey = String(apiKey || '').trim();

  if (!cleanKey) {
    return { ok: false, message: 'กรุณาระบุ Slip2Go API Key' };
  }

  try {
    const res = await axios.get(`${endpoint}/account/info`, {
      headers: {
        'Authorization': cleanKey,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (res.data && (res.data.code === '200001' || res.data.success || res.data.ok)) {
      const info = res.data.data || res.data;
      return {
        ok: true,
        quota: Number(info.estimatedQuotaSlip ?? info.tokenLimit ?? 0),
        used: Math.max(0, Number(info.tokenLimit || 0) - Number(info.tokenRemaining || 0)),
        message: 'เชื่อมต่อ Slip2Go API สำเร็จ'
      };
    }

    return {
      ok: false,
      message: res.data?.message || 'ไม่สามารถเชื่อมต่อ Slip2Go ได้ กรุณาตรวจสอบ API Key'
    };
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    return {
      ok: false,
      message: `ไม่สามารถเชื่อมต่อ Slip2Go: ${errMsg}`
    };
  }
}

/**
 * Verify a slip image using Slip2Go API.
 */
async function verifySlip(fileInput, expectedAmount, fileOptions = {}, credentials = {}) {
  const apiKey = String(credentials.apiKey || credentials || '').trim();
  const endpoint = officialEndpoint(credentials.endpoint, DEFAULT_ENDPOINT, 'connect.slip2go.com');

  if (!apiKey) {
    return { checked: false, verified: false, message: 'ยังไม่ได้ตั้งค่า Slip2Go API Key สำหรับตรวจสลิป', raw: null };
  }

  try {
    const form = new FormData();
    if (Buffer.isBuffer(fileInput)) {
      form.append('file', fileInput, {
        filename: fileOptions.filename || 'slip.jpg',
        contentType: fileOptions.contentType || 'image/jpeg',
      });
    } else {
      form.append('file', fs.createReadStream(fileInput));
    }
    form.append('payload', JSON.stringify({ checkDuplicate: true, checkAmount: { type: 'eq', amount: String(expectedAmount) } }));

    const res = await axios.post(`${endpoint}/verify-slip/qr-image/info`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': apiKey,
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    const data = res.data;
    if (data && (data.code === '200000' || data.success || data.ok || data.status === 'success')) {
      const result = data.data || data;
      const amount = numberValue(result.amount ?? result.transferAmount ?? result.transAmount);
      const transRef = result.transRef || result.trans_ref || result.ref || result.reference;
      const normalizedRaw = { ...result, transRef, amount, date: result.date || result.trans_date || result.transferred_at || null, providerResponse: data };
      const receiver = result.receiver || result.receiving || result.payee || {};
      const receiverAccount = receiver.account || {};
      const receiverName = result.receiverName || result.receiver_name || receiver.name || receiver.displayName || receiverAccount.name;
      if (!Number.isFinite(amount) || Math.abs(amount - Number(expectedAmount)) > 0.009) {
        return { checked: true, verified: false, message: 'ยอดเงินในสลิปไม่ตรงกับยอดที่แจ้งไว้', raw: normalizedRaw };
      }
      if (data.duplicate || result.duplicate || result.isDuplicate || result.is_duplicate) return { checked: true, verified: false, message: 'สลิปนี้เคยถูกใช้แล้ว (สลิปซ้ำ)', raw: normalizedRaw };
      if (!transRef) {
        return { checked: false, verified: false, message: 'Slip2Go ไม่ได้ส่งเลขอ้างอิงธุรกรรมกลับมา รอแอดมินตรวจสอบ', raw: normalizedRaw };
      }
      if ((credentials.expectedReceiverNames || []).length || (credentials.expectedReceiverNumbers || []).length) {
        const discovered = extractReceiverEvidence(result);
        const receiverCheck = receiverMatches({
          actualNames: textValues(receiverName, receiverAccount.displayName, discovered.names),
          actualNumbers: textValues(result.receiverAccountNumber, receiver.number, receiver.accountNumber, receiverAccount.number, receiverAccount.account, receiverAccount.bankNumber, discovered.numbers),
          expectedNames: credentials.expectedReceiverNames,
          expectedNumbers: credentials.expectedReceiverNumbers,
        });
        if (!receiverCheck.hasEvidence) return { checked: false, verified: false, message: 'Slip2Go ไม่ได้ส่งข้อมูลผู้รับกลับมา จึงยังไม่เติมเงินอัตโนมัติ', raw: normalizedRaw };
        if (!receiverCheck.matched) return { checked: true, verified: false, message: 'Slip2Go: ผู้รับในสลิปไม่ตรงกับบัญชีของร้าน', raw: normalizedRaw };
      }
      return {
        checked: true,
        verified: true,
        message: 'ตรวจสอบสลิปสำเร็จผ่าน Slip2Go API',
        raw: { ...normalizedRaw, receiverName }
      };
    }

    return {
      checked: true,
      verified: false,
      message: data.message || 'สลิปไม่ถูกต้อง หรือยอดเงินไม่ตรง',
      raw: data
    };
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    return {
      checked: false,
      verified: false,
      message: `ไม่สามารถเชื่อมต่อ Slip2Go API: ${errMsg}`,
      raw: null
    };
  }
}

module.exports = { DEFAULT_ENDPOINT, checkBalance, verifySlip };
