/**
 * TrueMoney Angpao (Gift Voucher) Redemption Service
 * Uses https://api.xpluem.com/:link/:phone
 */
const https = require('https');
const http = require('http');

/**
 * Extracts voucher code from various formats:
 * - Full URL: https://gift.truemoney.com/campaign/?v=3857329582739485739
 * - Query format: ?v=3857329582739485739
 * - Raw voucher hash: 3857329582739485739
 */
function extractVoucherCode(input) {
  if (!input) return '';
  const trimmed = String(input).trim();
  const match = trimmed.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const urlMatch = trimmed.match(/campaign\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // If it's already a clean alphanumeric voucher code
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Normalizes Thai phone number to 10 digits (e.g. 0801234567)
 */
function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.startsWith('66') && digits.length === 11) {
    digits = '0' + digits.slice(2);
  }
  return digits;
}

/**
 * Redeems a TrueMoney gift voucher link using receiver phone number
 * @param {string} voucherInput - Full link or voucher hash
 * @param {string} receiverPhone - 10-digit TrueMoney wallet phone number
 * @returns {Promise<{ success: boolean, amount: number, message: string, senderName?: string, raw?: any }>}
 */
async function redeemAngpao(voucherInput, receiverPhone) {
  const voucherCode = extractVoucherCode(voucherInput);
  const phone = normalizePhone(receiverPhone);

  if (!voucherCode) {
    return { success: false, amount: 0, message: 'ลิงก์ซองของขวัญไม่ถูกต้อง' };
  }

  if (!phone || phone.length !== 10) {
    return { success: false, amount: 0, message: 'เบอร์รับเงิน TrueMoney ไม่ถูกต้อง (ต้องเป็นเบอร์ 10 หลัก)' };
  }

  const targetUrl = `https://api.xpluem.com/${encodeURIComponent(voucherCode)}/${encodeURIComponent(phone)}`;

  try {
    const data = await new Promise((resolve, reject) => {
      const parsedUrl = new URL(targetUrl);
      const req = https.request({
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'LilTeamShop-TrueMoneyClient/1.0',
          'Accept': 'application/json',
        },
        timeout: 15000,
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve(json);
          } catch (e) {
            resolve({ success: false, message: 'รูปแบบข้อมูลตอบกลับจากระบบไม่ถูกต้อง', raw: body });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, message: 'การเชื่อมต่อไปยังระบบ TrueMoney หมดเวลา (Timeout) กรุณาลองใหม่อีกครั้ง' });
      });

      req.on('error', (err) => {
        resolve({ success: false, message: `เกิดข้อผิดพลาดในการเชื่อมต่อ: ${err.message}` });
      });

      req.end();
    });

    if (data && data.success && data.data && data.data.amount) {
      const amount = parseFloat(data.data.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { success: false, amount: 0, message: 'จำนวนเงินในซองไม่ถูกต้อง' };
      }
      return {
        success: true,
        amount,
        senderName: data.data.name || 'ไม่ระบุชื่อ',
        message: data.message || 'รับเงินสำเร็จ',
        raw: data,
      };
    }

    return {
      success: false,
      amount: 0,
      message: data.message || 'ไม่สามารถรับเงินจากซองของขวัญนี้ได้',
      raw: data,
    };
  } catch (err) {
    return {
      success: false,
      amount: 0,
      message: `เกิดข้อผิดพลาด: ${err.message}`,
    };
  }
}

module.exports = {
  extractVoucherCode,
  normalizePhone,
  redeemAngpao,
};
