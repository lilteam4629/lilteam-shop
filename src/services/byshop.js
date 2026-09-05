const axios = require('axios');

/**
 * BYSHOP API Integration Service (byshop.me)
 * Provides methods for checking balance, fetching product catalog,
 * placing automated orders, and checking order status.
 */

const DEFAULT_ENDPOINT = 'https://api.byshop.me/api';

/**
 * Check BYSHOP account balance and connection status.
 */
async function checkBalance(apiKey, customEndpoint = null) {
  const endpoint = customEndpoint || DEFAULT_ENDPOINT;
  const cleanKey = String(apiKey || '').trim();

  if (!cleanKey) {
    return { ok: false, message: 'กรุณาระบุ BYSHOP API Key' };
  }

  // Demo / Simulation Mode for testing
  if (cleanKey.startsWith('test_') || cleanKey.startsWith('demo_') || cleanKey === 'BYSHOP_DEMO_KEY') {
    return {
      ok: true,
      balance: 15420.50,
      username: 'BYSHOP_PARTNER_DEMO',
      email: 'partner@byshop.me',
      isDemo: true,
      message: 'เชื่อมต่อสำเร็จ (โหมดจำลองระบบ Test / Demo Key)'
    };
  }

  try {
    const res = await axios.get(`${endpoint}/user`, {
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'api-key': cleanKey,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (res.data && (res.data.status === 'success' || res.data.ok || res.data.success || res.data.balance !== undefined)) {
      return {
        ok: true,
        balance: Number(res.data.balance || res.data.money || (res.data.data && res.data.data.balance) || 0),
        username: res.data.username || (res.data.data && res.data.data.username) || 'BYSHOP User',
        email: res.data.email || (res.data.data && res.data.data.email) || '',
        message: 'เชื่อมต่อ BYSHOP API สำเร็จ'
      };
    }

    return {
      ok: false,
      message: res.data.message || 'API ตอบกลับไม่สำเร็จ กรุณาตรวจสอบ API Key'
    };
  } catch (err) {
    // If live API is unreachable or endpoint structure differs, return user-friendly error
    const msg = err.response?.data?.message || err.message;
    return {
      ok: false,
      message: `ไม่สามารถเชื่อมต่อ BYSHOP API: ${msg}`
    };
  }
}

/**
 * Fetch available product catalog from BYSHOP.
 */
async function getProducts(apiKey, customEndpoint = null) {
  const endpoint = customEndpoint || DEFAULT_ENDPOINT;
  const cleanKey = String(apiKey || '').trim();

  if (!cleanKey) return [];

  if (cleanKey.startsWith('test_') || cleanKey.startsWith('demo_') || cleanKey === 'BYSHOP_DEMO_KEY') {
    return [
      { id: 'by-roblox-100', name: 'Roblox Gift Card 100 Robux', price: 35, stock: 99, category: 'Gift Cards' },
      { id: 'by-valorant-500', name: 'Valorant Points 500 VP', price: 140, stock: 50, category: 'Game Topup' },
      { id: 'by-steam-50', name: 'Steam Wallet 50 THB', price: 50, stock: 120, category: 'Wallet' },
      { id: 'by-netflix-30d', name: 'Netflix Premium 30 วัน (Shared)', price: 89, stock: 25, category: 'Streaming' },
      { id: 'by-efootball-coins', name: 'eFootball 550 Coins', price: 169, stock: 40, category: 'Mobile Game' }
    ];
  }

  try {
    const res = await axios.get(`${endpoint}/products`, {
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'api-key': cleanKey,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (res.data && Array.isArray(res.data.data || res.data.products || res.data)) {
      const list = res.data.data || res.data.products || res.data;
      return list.map(item => ({
        id: String(item.id || item.product_id || item.code),
        name: item.name || item.title || item.product_name,
        price: Number(item.price || item.cost || 0),
        stock: item.stock !== undefined ? Number(item.stock) : 99,
        category: item.category || 'General'
      }));
    }
    return [];
  } catch (err) {
    console.error('[BYSHOP API getProducts error]:', err.message);
    return [];
  }
}

/**
 * Place an automated order / purchase product via BYSHOP API.
 */
async function placeOrder({ apiKey, byshopProductId, quantity = 1, customerInput = '', customEndpoint = null }) {
  const endpoint = customEndpoint || DEFAULT_ENDPOINT;
  const cleanKey = String(apiKey || '').trim();

  if (!cleanKey || !byshopProductId) {
    return { ok: false, message: 'ข้อมูลสำหรับสั่งซื้อ BYSHOP ไม่ครบถ้วน' };
  }

  // Simulation mode for demo / test key
  if (cleanKey.startsWith('test_') || cleanKey.startsWith('demo_') || cleanKey === 'BYSHOP_DEMO_KEY') {
    const mockCode = 'BYSHOP-KEY-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    return {
      ok: true,
      orderId: 'BY' + Date.now().toString().slice(-8),
      deliveredCredentials: {
        username: 'รหัสสินค้า: ' + mockCode,
        password: 'ข้อมูลเพิ่มเติม: ใช้งานได้ทันที (Auto BYSHOP Delivery)',
        extra: 'คำสั่งซื้อจำลองสำเร็จ (Test Provider)'
      },
      message: 'สั่งซื้อและดึงรหัสสินค้าจาก BYSHOP อัตโนมัติสำเร็จ'
    };
  }

  try {
    const res = await axios.post(`${endpoint}/buy`, {
      product_id: byshopProductId,
      quantity: Number(quantity) || 1,
      customer_input: customerInput
    }, {
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'api-key': cleanKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    if (res.data && (res.data.status === 'success' || res.data.ok || res.data.success)) {
      const data = res.data.data || res.data;
      const code = data.code || data.pin || data.voucher || data.key || data.result || 'สำเร็จ';
      const password = data.password || data.secret || data.pin || '';
      return {
        ok: true,
        orderId: String(data.order_id || data.id || Date.now()),
        deliveredCredentials: {
          username: `รหัสสินค้า: ${code}`,
          password: password ? `รหัสผ่าน/PIN: ${password}` : 'ได้รับสินค้าจาก BYSHOP อัตโนมัติแล้ว',
          extra: data.note || 'จัดส่งผ่าน BYSHOP API'
        },
        message: 'สั่งซื้อและดึงรหัสสินค้าจาก BYSHOP สำเร็จ'
      };
    }

    return {
      ok: false,
      message: res.data?.message || 'BYSHOP ปฏิเสธคำสั่งซื้อ'
    };
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    return {
      ok: false,
      message: `เกิดข้อผิดพลาดในการสั่งซื้อผ่าน BYSHOP: ${errMsg}`
    };
  }
}

/**
 * Verify a slip image using BYSHOP Slip Verification API.
 */
async function verifySlip(fileInput, expectedAmount, fileOptions = {}, credentials = {}) {
  const apiKey = String(credentials.apiKey || credentials || '').trim();
  const endpoint = credentials.endpoint || DEFAULT_ENDPOINT;

  if (!apiKey) {
    return { checked: false, verified: false, message: 'ยังไม่ได้ตั้งค่า BYSHOP API Key สำหรับตรวจสลิป', raw: null };
  }

  // Demo / Simulation Mode
  if (apiKey.startsWith('test_') || apiKey.startsWith('demo_') || apiKey === 'BYSHOP_DEMO_KEY') {
    const mockRef = 'BY' + Date.now().toString().slice(-10);
    return {
      checked: true,
      verified: true,
      message: 'ตรวจสอบสลิปสำเร็จผ่าน BYSHOP API (โหมดจำลอง Test/Demo)',
      raw: {
        transRef: mockRef,
        amount: Number(expectedAmount),
        date: new Date().toISOString(),
        sender: 'ผู้โอนจำลอง',
        receiver: 'LilTeam Shop'
      }
    };
  }

  try {
    const FormData = require('form-data');
    const form = new FormData();
    if (Buffer.isBuffer(fileInput)) {
      form.append('file', fileInput, {
        filename: fileOptions.filename || 'slip.jpg',
        contentType: fileOptions.contentType || 'image/jpeg',
      });
    } else {
      const fs = require('fs');
      form.append('file', fs.createReadStream(fileInput));
    }
    form.append('amount', String(expectedAmount));

    const res = await axios.post(`${endpoint}/check-slip`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiKey}`,
        'api-key': apiKey,
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    const data = res.data;
    if (data && (data.status === 'success' || data.success || data.ok)) {
      const slipData = data.data || data;
      return {
        checked: true,
        verified: true,
        message: 'ตรวจสอบสลิปสำเร็จผ่าน BYSHOP API',
        raw: {
          transRef: slipData.transRef || slipData.trans_ref || slipData.ref || String(Date.now()),
          amount: Number(slipData.amount || expectedAmount),
          date: slipData.date || slipData.trans_date || new Date().toISOString()
        }
      };
    }

    return {
      checked: true,
      verified: false,
      message: data.message || 'ยอดเงินหรือข้อมูลในสลิปไม่ตรงตามที่ระบุ',
      raw: data
    };
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    return {
      checked: false,
      verified: false,
      message: `ไม่สามารถเชื่อมต่อ BYSHOP Slip API: ${errMsg}`,
      raw: null
    };
  }
}

module.exports = {
  checkBalance,
  getProducts,
  placeOrder,
  verifySlip
};
