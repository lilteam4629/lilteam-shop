function numberValue(value) {
  const raw = value && typeof value === 'object' ? (value.amount ?? value.value ?? value.total) : value;
  const parsed = Number(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseSlipDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  let text = String(value).trim();
  if (!text) return null;
  if (/^\d{10,13}$/.test(text)) return parseSlipDate(Number(text));
  text = text.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) text += ':00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) text += '+07:00';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function officialEndpoint(value, fallback, allowedHost) {
  try {
    const url = new URL(String(value || fallback));
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== allowedHost) return fallback;
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return fallback;
  }
}

module.exports = { numberValue, parseSlipDate, officialEndpoint };
