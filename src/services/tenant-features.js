const store = require('../data/store');
const { cleanupLegacyLabRain } = require('./system-modules');

const FEATURE_CATALOG = Object.freeze([
  { key: 'boxGame', label: 'กล่องสุ่ม', description: 'เกมเปิดกล่องลุ้นรางวัลบนหน้าร้าน' },
  { key: 'railGame', label: 'รางสุ่ม', description: 'เกมรางเลื่อนลุ้นรางวัลบนหน้าร้าน' },
  { key: 'music', label: 'เพลงหน้าเว็บ', description: 'เครื่องเล่นเพลงที่ตั้งค่าไว้ในร้าน' },
  { key: 'snow', label: 'เอฟเฟกต์หิมะ', description: 'หิมะตกบนหน้าร้าน' },
  { key: 'welcomePopup', label: 'ป๊อปอัปต้อนรับ', description: 'ป๊อปอัปภาพหรือข้อความเมื่อเข้าหน้าร้าน' },
  { key: 'rain', label: 'ฝนตกหน้าเว็บ', description: 'ฝนแบบ Canvas ปรับสีและความเข้ม รองรับมือถือ' },
]);

const FEATURE_KEYS = new Set(FEATURE_CATALOG.map(feature => feature.key));
const RELEASE_LIMIT = 100;
function readFeatureState(db) {
  const settings = db?.settings || {};
  return {
    boxGame: settings.miniGame?.boxEnabled === true,
    railGame: settings.miniGame?.railEnabled === true,
    music: settings.music?.enabled === true,
    snow: settings.snow?.enabled === true,
    welcomePopup: settings.welcomePopup?.enabled === true,
    rain: settings.rain?.enabled === true,
  };
}

function captureFeature(db, feature) {
  const settings = db?.settings || {};
  const parentKey = feature === 'boxGame' || feature === 'railGame' ? 'miniGame' : feature;
  const property = feature === 'boxGame' ? 'boxEnabled' : feature === 'railGame' ? 'railEnabled' : 'enabled';
  const parent = settings[parentKey];
  const snapshot = {
    parentKey,
    property,
    parentExisted: Boolean(parent && typeof parent === 'object'),
    propertyExisted: Boolean(parent && Object.prototype.hasOwnProperty.call(parent, property)),
    value: parent?.[property],
  };
  if (parentKey === 'miniGame') {
    snapshot.enabledExisted = Boolean(parent && Object.prototype.hasOwnProperty.call(parent, 'enabled'));
    snapshot.enabled = parent?.enabled;
  }
  const modules = settings.systemModules;
  snapshot.modulesExisted = Boolean(modules && typeof modules === 'object');
  snapshot.moduleExisted = Boolean(modules && Object.prototype.hasOwnProperty.call(modules, feature));
  snapshot.module = snapshot.moduleExisted ? JSON.parse(JSON.stringify(modules[feature])) : undefined;
  return snapshot;
}

function restoreFeature(db, snapshot) {
  const settings = db.settings ||= {};
  const parent = settings[snapshot.parentKey] ||= {};
  if (snapshot.propertyExisted) parent[snapshot.property] = snapshot.value;
  else delete parent[snapshot.property];
  if (snapshot.parentKey === 'miniGame') {
    if (snapshot.enabledExisted) parent.enabled = snapshot.enabled;
    else delete parent.enabled;
  }
  if (!snapshot.parentExisted && Object.keys(parent).length === 0) delete settings[snapshot.parentKey];
  const modules = settings.systemModules ||= {};
  if (snapshot.moduleExisted) modules[snapshot.property === 'enabled' ? snapshot.parentKey : (snapshot.property === 'boxEnabled' ? 'boxGame' : 'railGame')] = snapshot.module;
  else {
    const feature = snapshot.property === 'enabled' ? snapshot.parentKey : (snapshot.property === 'boxEnabled' ? 'boxGame' : 'railGame');
    delete modules[feature];
  }
  if (!snapshot.modulesExisted && Object.keys(modules).length === 0) delete settings.systemModules;
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
  if (feature === 'rain') (settings.rain ||= { color: '#78c8ff', intensity: 'medium' }).enabled = enabled;
}

function selectShops(platformShops, scope, requestedIds) {
  const shops = Array.isArray(platformShops) ? platformShops : [];
  // The system lab is the canary used before release. "All" always means
  // customer shops and must never change the lab or use it as customer data.
  if (scope === 'all') return shops.filter(shop => !shop.isSystemLab);
  if (scope !== 'selected') throw new Error('ขอบเขตการแก้ไขไม่ถูกต้อง');
  const ids = [...new Set([].concat(requestedIds || []).map(String).filter(Boolean))];
  if (!ids.length) throw new Error('กรุณาเลือกร้านอย่างน้อย 1 ร้าน');
  const selected = ids.map(id => shops.find(shop => String(shop.id) === id));
  if (selected.some(shop => !shop)) throw new Error('พบร้านที่ไม่มีอยู่ในระบบ กรุณาโหลดหน้าใหม่');
  return selected;
}

function assertExplicitScope(payload) {
  if (payload.scope === 'all' && payload.confirmAll !== 'CONFIRM_ALL_TENANTS') {
    throw new Error('การนำส่งทุกร้านต้องยืนยันคำสั่งอัปเดตทั้งหมดโดยตรง');
  }
}

async function updateTenantFeatures(payload, storeApi = store) {
  const feature = String(payload.feature || '');
  if (!FEATURE_KEYS.has(feature)) throw new Error('ฟีเจอร์ที่เลือกไม่ถูกต้อง');
  if (!['enable', 'disable'].includes(payload.action)) throw new Error('คำสั่งเปิดหรือปิดฟีเจอร์ไม่ถูกต้อง');
  assertExplicitScope(payload);
  const targets = selectShops(storeApi.platformData.shops, payload.scope, payload.shopIds);
  if (!targets.length) throw new Error('ยังไม่มีร้านเช่าในระบบ');

  // Validate every target before writing anything. The actual write below uses
  // store.transact so a concurrent order/product/customer update is merged
  // against the latest stored tenant document instead of being overwritten by
  // an older full-document snapshot.
  for (const shop of targets) {
    const db = await storeApi.loadTenantDb(shop.id);
    if (!db) throw new Error(`โหลดข้อมูลร้าน "${shop.name}" ไม่สำเร็จ`);
  }

  const enabled = payload.action === 'enable';
  const saved = [];
  try {
    for (const shop of targets) {
      const tenantDb = await storeApi.loadTenantDb(shop.id);
      const before = await storeApi.runInTenant(shop.id, tenantDb, () => storeApi.transact(db => {
        const snapshot = captureFeature(db, feature);
        applyFeature(db, feature, enabled);
        if (payload.releaseMeta) {
          const modules = (db.settings ||= {}).systemModules ||= {};
          modules[feature] = {
            releaseId: payload.releaseMeta.id,
            name: payload.releaseMeta.name,
            version: payload.releaseMeta.version,
            enabled,
            deployedAt: new Date().toISOString(),
          };
        }
        return snapshot;
      }));
      saved.push({ shop, before });
    }
  } catch (error) {
    for (const item of saved.reverse()) {
      try {
        const tenantDb = await storeApi.loadTenantDb(item.shop.id);
        await storeApi.runInTenant(item.shop.id, tenantDb, () => storeApi.transact(db => restoreFeature(db, item.before)));
      }
      catch (rollbackError) { console.error('[tenant-features] rollback failed:', item.shop.id, rollbackError.message); }
    }
    throw new Error('บันทึกฟีเจอร์ไม่ครบ ระบบคืนค่าร้านที่แก้ไปแล้ว กรุณาลองใหม่');
  }
  return { feature, enabled, updatedCount: saved.length, shopIds: saved.map(item => item.shop.id) };
}

function listReleases(storeApi = store) {
  return [...(storeApi.platformData.tenantFeatureReleases || [])]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function createRelease(payload, storeApi = store) {
  const name = String(payload.name || '').trim().slice(0, 100);
  const version = String(payload.version || '').trim().slice(0, 30);
  const feature = String(payload.feature || '');
  const action = payload.action === 'disable' ? 'disable' : 'enable';
  if (!name) throw new Error('กรุณาตั้งชื่อระบบ');
  if (!version) throw new Error('กรุณาระบุเวอร์ชัน');
  if (!FEATURE_KEYS.has(feature)) throw new Error('ระบบต้นแบบที่เลือกไม่ถูกต้อง');
  const release = {
    id: storeApi.genId(10), name, version, feature, action,
    createdAt: new Date().toISOString(), deployments: [],
  };
  await storeApi.transact(data => {
    data.tenantFeatureReleases ||= [];
    if (data.tenantFeatureReleases.some(item => item.name.toLowerCase() === name.toLowerCase() && item.version === version)) {
      throw new Error('ชื่อระบบและเวอร์ชันนี้มีอยู่แล้ว');
    }
    data.tenantFeatureReleases.unshift(release);
    if (data.tenantFeatureReleases.length > RELEASE_LIMIT) data.tenantFeatureReleases.length = RELEASE_LIMIT;
  });
  return release;
}

async function deployRelease(payload, storeApi = store) {
  const release = (storeApi.platformData.tenantFeatureReleases || []).find(item => item.id === String(payload.releaseId || ''));
  if (!release) throw new Error('ไม่พบแพ็กเกจระบบ กรุณาโหลดหน้าใหม่');
  const result = await updateTenantFeatures({ ...payload, feature: release.feature, action: release.action, releaseMeta: release }, storeApi);
  const deployment = {
    id: storeApi.genId(10), releaseId: release.id, releaseName: release.name, version: release.version,
    shopIds: result.shopIds, scope: payload.scope, createdAt: new Date().toISOString(),
  };
  await storeApi.transact(data => {
    const current = (data.tenantFeatureReleases || []).find(item => item.id === release.id);
    if (current) {
      current.deployments ||= [];
      current.deployments.unshift(deployment);
      current.deployments = current.deployments.slice(0, 30);
    }
  });
  return { ...result, releaseName: release.name, version: release.version };
}

async function ensureSystemLab(storeApi = store) {
  const slug = 'system-lab';
  let shop = storeApi.platformData.shops.find(item => item.slug === slug);
  if (shop && !shop.isSystemLab) throw new Error('ชื่อ system-lab ถูกใช้งานโดยร้านอื่นแล้ว');
  const admin = storeApi.platformData.users.find(user => user.role === 'admin' && user.status === 'active' && user.passwordHash);
  if (!admin) throw new Error('ไม่พบบัญชีผู้ดูแลสำหรับสร้างเว็บทดลอง');
  let created = false;
  if (!shop) {
    shop = {
      id: storeApi.genId(10), slug, name: 'LILTeam System Lab', ownerId: admin.id,
      ownerUsername: admin.username, isSystemLab: true,
      expiresAt: Date.now() + (10 * 365 * 24 * 60 * 60 * 1000), createdAt: new Date().toISOString(),
    };
    await storeApi.transact(data => {
      if (data.shops.some(item => item.slug === slug)) throw new Error('มีการสร้างเว็บทดลองพร้อมกัน กรุณาลองใหม่');
      data.shops.push(shop);
    });
    try {
      await storeApi.createTenantDb(shop.id, {
        shopName: shop.name, adminUsername: admin.username,
        adminEmail: admin.email || 'admin@system-lab.local', adminPasswordHash: admin.passwordHash,
      });
      created = true;
    } catch (error) {
      await storeApi.transact(data => { data.shops = data.shops.filter(item => item.id !== shop.id); });
      throw error;
    }
  }
  const labDb = await storeApi.loadTenantDb(shop.id);
  if (!labDb) throw new Error('ฐานข้อมูลเว็บทดลองไม่พร้อมใช้งาน');
  await storeApi.runInTenant(shop.id, labDb, () => storeApi.transact(data => {
    // LAB starts clean. Older builds installed rain here automatically; remove
    // only that generated marker so explicitly deployed releases stay intact.
    cleanupLegacyLabRain(data);
  }));
  return { shop, created };
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

module.exports = { FEATURE_CATALOG, readFeatureState, applyFeature, captureFeature, restoreFeature, selectShops, assertExplicitScope, updateTenantFeatures, listTenantFeatures, listReleases, createRelease, deployRelease, ensureSystemLab };
