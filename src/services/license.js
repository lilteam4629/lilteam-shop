const crypto = require('crypto');

const SECRET = process.env.LICENSE_SECRET;
const PREFIX = 'LTS1-';

const isEnabled = () => Boolean(SECRET);

function base64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

/**
 * Generate a signed license key. Requires LICENSE_SECRET to be set in the
 * environment running this — the same secret must be set on the rented
 * deployment that will verify the key.
 * @param {string} label - who the key was issued to (shown in admin)
 * @param {number} days - how many days from now the key is valid for
 */
function generateKey(label, days) {
  if (!isEnabled()) throw new Error('LICENSE_SECRET is not set');
  const exp = Date.now() + Math.round(days * 24 * 60 * 60 * 1000);
  const payloadB64 = base64urlEncode(JSON.stringify({ label, exp }));
  const sig = sign(payloadB64);
  return `${PREFIX}${payloadB64}.${sig}`;
}

/**
 * Verify a license key against LICENSE_SECRET.
 * @returns {{ valid: boolean, label?: string, exp?: number, error?: string }}
 */
function verifyKey(key) {
  if (!isEnabled()) return { valid: false, error: 'ยังไม่ได้ตั้งค่าระบบใบอนุญาต' };
  const trimmed = String(key || '').trim();
  if (!trimmed.startsWith(PREFIX)) return { valid: false, error: 'รูปแบบคีย์ไม่ถูกต้อง' };

  const body = trimmed.slice(PREFIX.length);
  const dotIndex = body.lastIndexOf('.');
  if (dotIndex === -1) return { valid: false, error: 'รูปแบบคีย์ไม่ถูกต้อง' };

  const payloadB64 = body.slice(0, dotIndex);
  const sig = body.slice(dotIndex + 1);
  const expectedSig = sign(payloadB64);

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, error: 'คีย์ไม่ถูกต้อง' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch (err) {
    return { valid: false, error: 'คีย์เสียหาย' };
  }

  if (!payload.exp || Date.now() > payload.exp) {
    return { valid: false, error: 'คีย์หมดอายุแล้ว', label: payload.label, exp: payload.exp };
  }

  return { valid: true, label: payload.label, exp: payload.exp };
}

module.exports = { isEnabled, generateKey, verifyKey };
