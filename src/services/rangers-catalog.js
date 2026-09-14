const source = require('../catalog/rangers-source.json');

const byCode = new Map(source.map(item => [item.code, item]));

function imageUrl(item) {
  const code = typeof item === 'string' ? item : item.imageCode;
  return `https://rangers.lerico.net/res/${encodeURIComponent(code)}/${encodeURIComponent(code)}-thum.png`;
}

function queryCatalog({ q = '', view = 'all', page = 1, limit = 60 } = {}) {
  const normalized = String(q).trim().toLowerCase().slice(0, 80);
  const safeLimit = Math.min(100, Math.max(12, Number(limit) || 60));
  const safePage = Math.max(1, Number(page) || 1);
  let rows = view === 'top100' ? source.slice(0, 100) : source;
  if (normalized) rows = rows.filter(item => `${item.name} ${item.code}`.toLowerCase().includes(normalized));
  const total = rows.length;
  const start = (safePage - 1) * safeLimit;
  return {
    items: rows.slice(start, start + safeLimit).map(item => ({ ...item, imageUrl: imageUrl(item) })),
    total, page: safePage, pages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

function validCodes(values, max = 20) {
  return [...new Set([].concat(values || []).map(String))].filter(code => byCode.has(code)).slice(0, max);
}

function resolveCodes(values) {
  return validCodes(values).map(itemCode => {
    const item = byCode.get(itemCode);
    return { ...item, imageUrl: imageUrl(item) };
  });
}

module.exports = { sourceCount: source.length, queryCatalog, validCodes, resolveCodes };

