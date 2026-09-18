// Keep provider implementation details out of customer-facing and delegated
// API responses while preserving the internal provider id for verification.
function publicSlipMessage(message) {
  return String(message || '')
    .replace(/Slip\s*XEPHT/gi, 'ระบบตรวจสอบ')
    .replace(/slip\.xepht\.com/gi, 'ระบบภายนอก')
    .replace(/XEPHT/gi, 'ระบบตรวจสอบ');
}

function publicSlipCheck(slipCheck) {
  if (!slipCheck || typeof slipCheck !== 'object') return slipCheck;
  const safe = { ...slipCheck };
  if (safe.provider === 'xepht') safe.provider = 'automatic';
  if (typeof safe.message === 'string') safe.message = publicSlipMessage(safe.message);
  return safe;
}

function publicTopupRequest(request) {
  if (!request || typeof request !== 'object') return request;
  return { ...request, slipCheck: publicSlipCheck(request.slipCheck) };
}

module.exports = { publicSlipMessage, publicSlipCheck, publicTopupRequest };
