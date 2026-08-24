// Generates a standard Thai PromptPay EMV QR payload string.
// This is the same public spec every Thai banking app reads — no API or
// account signup required, it just encodes the merchant's own PromptPay ID.

function tlv(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * @param {string} promptpayId - phone number (e.g. 081-234-5678) or 13-digit national ID / e-wallet ID
 * @param {number} [amount] - fixed amount in THB, omit for an open-amount QR
 * @returns {string} the raw payload to encode into a QR image
 */
function generatePayload(promptpayId, amount) {
  const digits = String(promptpayId).replace(/[^0-9]/g, '');

  let subTag;
  let subValue;
  if (digits.length === 13) {
    // national ID or e-wallet ID
    subTag = '02';
    subValue = digits;
  } else {
    // mobile number -> 00 66 XXXXXXXXX (13 chars, country code 66 + 9 digits, no leading 0)
    const local = digits.startsWith('0') ? digits.slice(1) : digits;
    subTag = '01';
    subValue = '66' + local;
  }

  const merchantAccountInfo = tlv('29', tlv('00', 'A000000677010111') + tlv(subTag, subValue));

  let payload = '';
  payload += tlv('00', '01'); // payload format indicator
  payload += tlv('01', amount ? '12' : '11'); // point of initiation (dynamic if amount fixed)
  payload += merchantAccountInfo;
  payload += tlv('52', '0000'); // merchant category code (unspecified)
  payload += tlv('53', '764'); // currency: THB
  if (amount) payload += tlv('54', Number(amount).toFixed(2));
  payload += tlv('58', 'TH');
  payload += '6304'; // CRC tag + length, value appended below
  return payload + crc16(payload);
}

module.exports = { generatePayload };
