const store = require('../data/store');

const FEATURE_CATALOG = Object.freeze([
  { key: 'boxGame', label: 'กล่องสุ่ม', description: 'เกมเปิดกล่องลุ้นรางวัลบนหน้าร้าน' },
  { key: 'railGame', label: 'รางสุ่ม', description: 'เกมรางเลื่อนลุ้นรางวัลบนหน้าร้าน' },
  { key: 'music', label: 'เพลงหน้าเว็บ', description: 'เครื่องเล่นเพลงที่ตั้งค่าไว้ในร้าน' },
  { key: 'snow', label: 'เอฟเฟกต์หิมะ', description: 'หิมะตกบนหน้าร้าน' },
  { key: 'welcomePopup', label: 'ป๊อปอัปต้อนรับ', description: 'ป๊อปอัปภาพหรือข้อความเมื่อเข้าหน้าร้าน' },
]);

const FEATURE_KEYS = new Set(FEATURE_CATALOG.map(feature => feature.key));
const clone = value => JSON.parse(JSON.stringify(value));

function readFeatureState(db) {
  const settings = db?.settings || {};
  return {
    boxGame: settings.miniGame?.boxEnabled === true,
    railGame: settings.miniGame?.railEnabled === true,
    music: settings.music?.enabled === true,
    snow: settings.snow?.enabled === true,
    welcomePopup: settings.welcomePopup?.enabled === true,
  };
}

function applyFeature(db, feature, enabled) {
  const settings = db.settings ||= {};
  if (feature === 'boxGame' || feature === 'railGame') {
    const game = settings.miniGame ||= {};
    game[feature === 'boxGame' ? 'boxEnabled' : 'railEnabled'] = enabled;
    game.enabled = game.boxEnabled === true || game.railEnabled === true;
    return;
  }
  if (feature === 'music') (settings.music ||= {}).enabled = enabled;
  if (feature === 'snow') (settings.snow ||= {}).enabled = enabled;
  if (feature === 'welcomePopup') (settings.welcomePopup ||= {}).enabled = enabled;
}

function selectShops(platformShops, scope, requestedIds) {
  const shops = Array.isArray(platformShops) ? platformShops : [];
  if (scope === 'all') return shops;
  if (scope !== 'selected') throw new Error('ขอบเขตการแก้ไขไม่ถูกต้อง');
  const ids = [...new Set([].concat(requestedIds || []).map(String).filter(Boolean))];
  if (!ids.length) throw new Error('กรุณาเลือกร้านอย่างน้อย 1 ร้าน');
  const selected = ids.map(id => shops.find(shop => String(shop.id) === id));
  if (selected.some(shop => !shop)) throw new Error('พบร้านที่ไม่มีอยู่ในระบบ กรุณาโหลดหน้าใหม่');
  return selected;
}

async function updateTenantFeatures(payload, storeApi = store) {
  const feature = String(payload.feature || '');
  if (!FEATURE_KEYS.has(feature)) throw new Error('ฟีเจอร์ที่เลือกไม่ถูกต้อง');
  if (!['enable', 'disable'].includes(payload.action)) throw new Error('คำสั่งเปิดหรือปิดฟีเจอร์ไม่ถูกต้อง');
  const targets = selectShops(storeApi.platformData.shops, payload.scope, payload.shopIds);
  if (!targets.length) throw new Error('ยังไม่มีร้านเช่าในระบบ');

  const loaded = [];
  for (const shop of targets) {
    const db = await storeApi.loadTenantDb(shop.id);
    if (!db) throw new Error(`โหลดข้อมูลร้าน "${shop.name}" ไม่สำเร็จ`);
    loaded.push({ shop, original: clone(db), updated: clone(db) });
  }

  const enabled = payload.action === 'enable';
  loaded.forEach(item => applyFeature(item.updated, feature, enabled));
  const saved = [];
  try {
    for (const item of loaded) {
      await storeApi.runInTenant(item.shop.id, item.updated, () => storeApi.save());
      saved.push(item);
    }
  } catch (error) {
    for (const item of saved.reverse()) {
      try { await storeApi.runInTenant(item.shop.id, item.original, () => storeApi.save()); }
      catch (rollbackError) { console.error('[tenant-features] rollback failed:', item.shop.id, rollbackError.message); }
    }
    throw new Error('บันทึกฟีเจอร์ไม่ครบ ระบบคืนค่าร้านที่แก้ไปแล้ว กรุณาลองใหม่');
  }
  return { feature, enabled, updatedCount: saved.length, shopIds: saved.map(item => item.shop.id) };
}

async function listTenantFeatures(shops, storeApi = store) {
  const queue = [...(shops || [])];
  const results = new Map();
  async function worker() {
    while (queue.length) {
      const shop = queue.shift();
      try {
        const db = await storeApi.loadTenantDb(shop.id);
        results.set(String(shop.id), db ? readFeatureState(db) : null);
      } catch (error) {
        console.error('[tenant-features] unable to read shop:', shop.id, error.message);
        results.set(String(shop.id), null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  return results;
}

module.exports = { FEATURE_CATALOG, readFeatureState, applyFeature, selectShops, updateTenantFeatures, listTenantFeatures };
