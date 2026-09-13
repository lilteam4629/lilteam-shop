function responseValues(body) {
  const data = body && typeof body === 'object' ? body : {};
  return [
    data.code, data.errorCode, data.error_code, data.reason,
    data.message, data.error, data.detail,
    data.data && data.data.code, data.data && data.data.message,
    data.data && data.data.error,
  ].filter(value => value !== undefined && value !== null).map(value => String(value).toLowerCase());
}

function isQuotaExhausted(body, status) {
  if (Number(status) === 429) return true;
  if (responseValues(body).some(value => /quota|rate.?limit|too many|limit.?exceed|เครดิต|โควตา|จำกัดการใช้งาน/.test(value))) return true;
  const data = body && typeof body === 'object' ? body : {};
  const quota = data.quota || data.data?.quota || data.usage || data.data?.usage;
  return Boolean(quota && quota.remaining !== undefined && Number(quota.remaining) <= 0);
}

function quotaMessage(provider) {
  return `โควตาตรวจสลิป ${provider} หมดแล้ว กรุณาเติมโควตาหรือติดต่อผู้ดูแลระบบ`;
}

module.exports = { isQuotaExhausted, quotaMessage };
