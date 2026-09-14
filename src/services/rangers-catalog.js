const fallbackRangers = require('../catalog/rangers-source.json');
const https = require('https');
const API_ROOT = 'https://rangers.lerico.net';
let rangers = fallbackRangers, gears = [], updatedAt = null, refreshPromise = null, lastError = '';
let byCode = new Map(rangers.map(item => [item.code, item]));

const rangerImageUrl = code => `${API_ROOT}/res/${encodeURIComponent(code)}/${encodeURIComponent(code)}-thum.png`;
const gearImageUrl = code => `${API_ROOT}/res/gear_icon/${encodeURIComponent(code)}_icon.png`;
const imageUrl = item => item.kind === 'gear' ? gearImageUrl(item.code) : rangerImageUrl(item.imageCode || item.code);
const cleanName = (value, fallback) => String(value || fallback || '').replace(/\\n/g, ' ').replace(/<#[0-9a-f]{6}>/gi, '').replace(/<->/g, '').trim();
const rangerScore = row => Number(row.initialHp || 0) + 8 * (Number(row.initialAttack || 0) + Number(row.specialAttack || 0)) + 4 * (Number(row.defence || 0) + Number(row.specialDefence || 0));
const rebuildIndex = () => { byCode = new Map([...rangers, ...gears].map(item => [item.code, item])); };

async function getJson(path) {
  return new Promise((resolve, reject) => {
    const request = https.get(`${API_ROOT}${path}`, { headers: { accept: 'application/json', 'user-agent': 'LILTeam-System-Lab/1.0' } }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); return reject(new Error(`HTTP ${response.statusCode}`)); }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });
    });
    request.setTimeout(20000, () => request.destroy(new Error('API timeout')));
    request.on('error', reject);
  });
}
async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const [rawRangers, unitT, rawGears, equipT] = await Promise.all([
        getJson('/api/getRangersBasics'), getJson('/api/v2/translate?keys=en%3AUNIT'),
        getJson('/api/v2/equipments'), getJson('/api/v2/translate?keys=en%3AEQUIP'),
      ]);
      const names = unitT['en:UNIT'] || {}, equipNames = equipT['en:EQUIP'] || {};
      const nextRangers = rawRangers.filter(row => !/(?:test|tuto)/i.test(row.unitCode || '') && names[row.unitNameCode]).map(row => ({
        code: row.unitCode, name: cleanName(names[row.unitNameCode], row.unitCode), grade: row.grade,
        form: row.isHyperUnit ? 'hyper' : row.isTranscendentUnit ? 'ultra' : 'normal', element: row.unitElement || 'none',
        role: row.unitCategoryType || '', score: rangerScore(row), imageCode: row.unitCode, kind: 'ranger',
      })).sort((a, b) => b.score - a.score || b.code.localeCompare(a.code));
      const nextGears = (rawGears.equipments || []).map(row => ({
        code: row.itemCode, name: cleanName(equipNames[row.itemNameCode] || equipNames[`${row.itemCode}_nm`], row.itemCode),
        grade: row.equipGrade, gearType: row.equipType, kind: 'gear', score: Number(row.equipGrade || 0), imageCode: row.itemCode,
      })).sort((a, b) => b.grade - a.grade || b.code.localeCompare(a.code));
      if (nextRangers.length < 100 || nextGears.length < 10) throw new Error('ข้อมูลสดไม่ครบ');
      rangers = nextRangers; gears = nextGears; updatedAt = new Date().toISOString(); lastError = ''; rebuildIndex();
      return status();
    } catch (error) { lastError = error.message || String(error); throw error; }
    finally { refreshPromise = null; }
  })();
  return refreshPromise;
}
function rowsForView(view) {
  if (view === 'top100') return rangers.slice(0, 100).map((item, index) => ({ ...item, rank: index + 1 }));
  if (view === 'new') return [...rangers].sort((a, b) => b.code.localeCompare(a.code)).slice(0, 100);
  if (view === 'gear' || ['WEAPON', 'ARMOR', 'ACC'].includes(view)) return view === 'gear' ? gears : gears.filter(x => x.gearType === view);
  return rangers;
}
function queryCatalog({ q = '', view = 'all', page = 1, limit = 60 } = {}) {
  const normalized = String(q).trim().toLowerCase().slice(0, 80), safeLimit = Math.min(100, Math.max(12, Number(limit) || 60)), safePage = Math.max(1, Number(page) || 1);
  let rows = rowsForView(view);
  if (normalized) rows = rows.filter(item => `${item.name} ${item.code}`.toLowerCase().includes(normalized));
  const total = rows.length, start = (safePage - 1) * safeLimit;
  return { items: rows.slice(start, start + safeLimit).map(item => ({ ...item, imageUrl: imageUrl(item) })), total, page: safePage, pages: Math.max(1, Math.ceil(total / safeLimit)), updatedAt, view };
}
function validCodes(values, max = 20) { return [...new Set([].concat(values || []).map(String))].filter(code => byCode.has(code)).slice(0, max); }
function resolveCodes(values) { return validCodes(values).map(code => ({ ...byCode.get(code), imageUrl: imageUrl(byCode.get(code)) })); }
function status() { return { rangerCount: rangers.length, gearCount: gears.length, updatedAt, lastError }; }
function msUntilBangkokMidnight() {
  const now = new Date(), parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
  return Math.max(1000, Date.UTC(+parts.year, +parts.month - 1, +parts.day + 1, -7, 0, 3) - now.getTime());
}
function scheduleRefresh() { const timer = setTimeout(() => refresh().catch(() => {}).finally(scheduleRefresh), msUntilBangkokMidnight()); timer.unref?.(); }
setImmediate(() => refresh().catch(() => {})); scheduleRefresh();

module.exports = { get sourceCount() { return rangers.length; }, queryCatalog, validCodes, resolveCodes, refresh, status };
