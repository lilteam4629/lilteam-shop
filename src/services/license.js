const crypto = require('crypto');

const SECRET = process.env.LICENSE_SECRET;
const PREFIX = 'LTS1-';

// isEnabled: this deployment can sign/verify keys (needed by a "seller" shop
// that issues keys for sale, even though that shop itself is never gated).
// isGateOn: this deployment additionally requires a valid key to be usable
// at all — a separate opt-in so the seller's own storefront never locks
// itself out just because it has LICENSE_SECRET set to issue keys.
const isEnabled = () => Boolean(SECRET);
const isGateOn = () => isEnabled() && process.env.LICENSE_GATE === 'on';

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
 * @param {number} days - how many days this key is worth once redeemed
 */
function generateKey(label, days) {
  if (!isEnabled()) throw new Error('LICENSE_SECRET is not set');
  // `exp` doubles as the redeem-by deadline (this key must be entered
  // before then) AND the estimate shown in sales history assuming it's
  // redeemed right away. `days` is what actually gets added to the site's
  // remaining time when redeemed — see routes/license.js, which stacks it
  // on top of any time still remaining instead of overwriting it.
  const exp = Date.now() + Math.round(days * 24 * 60 * 60 * 1000);
  const payloadB64 = base64urlEncode(JSON.stringify({ label, days, exp }));
  const sig = sign(payloadB64);
  return `${PREFIX}${payloadB64}.${sig}`;
}

/**
 * Verify a license key against LICENSE_SECRET.
 * @returns {{ valid: boolean, label?: string, exp?: number, days?: number, error?: string }}
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

  return { valid: true, label: payload.label, exp: payload.exp, days: payload.days };
}

module.exports = { isEnabled, isGateOn, generateKey, verifyKey };
