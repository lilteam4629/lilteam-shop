const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

/**
 * Slip2Go API Integration Service (slip2go.com)
 * Provides methods for verifying bank & PromptPay slips via Slip2Go API.
 */

const DEFAULT_ENDPOINT = 'https://api.slip2go.com/api';

/**
 * Test Slip2Go connection and check balance / status.
 */
async function checkBalance(apiKey, customEndpoint = null) {
  const endpoint = customEndpoint || DEFAULT_ENDPOINT;
  const cleanKey = String(apiKey || '').trim();

  if (!cleanKey) {
    return { ok: false, message: 'กรุณาระบุ Slip2Go API Key' };
  }

  // Demo / Simulation mode
  if (cleanKey.startsWith('test_') || cleanKey.startsWith('demo_') || cleanKey === 'SLIP2GO_DEMO_KEY') {
    return {
      ok: true,
      quota: 500,
      used: 42,
      isDemo: true,
      message: 'เชื่อมต่อ Slip2Go สำเร็จ (โหมดจำลอง Test/Demo Key)'
    };
  }

  try {
    const res = await axios.get(`${endpoint}/user/quota`, {
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'x-api-key': cleanKey,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (res.data && (res.data.success || res.data.ok || res.data.status === 'success')) {
      return {
        ok: true,
        quota: Number(res.data.quota || res.data.data?.quota || 0),
        used: Number(res.data.used || res.data.data?.used || 0),
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
  const endpoint = credentials.endpoint || DEFAULT_ENDPOINT;

  if (!apiKey) {
    return { checked: false, verified: false, message: 'ยังไม่ได้ตั้งค่า Slip2Go API Key สำหรับตรวจสลิป', raw: null };
  }

  // Demo mode
  if (apiKey.startsWith('test_') || apiKey.startsWith('demo_') || apiKey === 'SLIP2GO_DEMO_KEY') {
    const mockRef = 'S2G' + Date.now().toString().slice(-10);
    return {
      checked: true,
      verified: true,
      message: 'ตรวจสอบสลิปสำเร็จผ่าน Slip2Go API (โหมดจำลอง Test/Demo)',
      raw: {
        transRef: mockRef,
        amount: Number(expectedAmount),
        date: new Date().toISOString()
      }
    };
  }

  try {
    const form = new FormData();
    if (Buffer.isBuffer(fileInput)) {
      form.append('slip', fileInput, {
        filename: fileOptions.filename || 'slip.jpg',
        contentType: fileOptions.contentType || 'image/jpeg',
      });
    } else {
      form.append('slip', fs.createReadStream(fileInput));
    }
    form.append('amount', String(expectedAmount));

    const res = await axios.post(`${endpoint}/verify`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    const data = res.data;
    if (data && (data.success || data.ok || data.status === 'success')) {
      const result = data.data || data;
      return {
        checked: true,
        verified: true,
        message: 'ตรวจสอบสลิปสำเร็จผ่าน Slip2Go API',
        raw: {
          transRef: result.transRef || result.trans_ref || result.ref || String(Date.now()),
          amount: Number(result.amount || expectedAmount),
          date: result.date || result.trans_date || new Date().toISOString()
        }
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

module.exports = {
  checkBalance,
  verifySlip
};
