const assert = require('assert');
const { updateTenantFeatures, readFeatureState, createRelease, deployRelease, ensureSystemLab } = require('../src/services/tenant-features');
const { ensureLabRainModule } = require('../src/services/system-modules');

function fixture(failOnSave) {
  const shops = [{ id: 'shop-a', name: 'A' }, { id: 'shop-b', name: 'B' }, { id: 'shop-lab', name: 'LAB', isSystemLab: true }];
  const dbs = new Map(shops.map(shop => [shop.id, {
    settings: { miniGame: { boxEnabled: false, railEnabled: false }, music: { enabled: false }, snow: { enabled: false }, welcomePopup: { enabled: false } },
    products: [{ id: `${shop.id}-product`, images: [`${shop.id}.png`] }],
    orders: [{ id: `${shop.id}-order` }], users: [{ id: `${shop.id}-user` }],
  }]));
  let current = null;
  let saveCount = 0;
  const platformData = { shops };
  const api = {
      platformData,
      loadTenantDb: async id => dbs.get(id) || null,
      runInTenant: async (id, db, fn) => { const before = current; current = { id, db }; try { return await fn(); } finally { current = before; } },
      transact: async mutator => {
        saveCount += 1;
        if (failOnSave && saveCount === failOnSave) throw new Error('simulated save failure');
        if (!current) return mutator(platformData);
        // Simulate a customer order arriving after the control page loaded.
        const latest = JSON.parse(JSON.stringify(dbs.get(current.id)));
        if (saveCount === 1) latest.orders.push({ id: 'concurrent-order' });
        const result = await mutator(latest);
        dbs.set(current.id, latest);
        current.db = latest;
        return result;
      },
      genId: () => `id-${saveCount + 1}`,
      createTenantDb: async (id, details) => {
        dbs.set(id, { settings: {}, products: [], orders: [], users: [{ username: details.adminUsername, passwordHash: details.adminPasswordHash }] });
        return dbs.get(id);
      },
  };
  return {
    api, dbs, get saveCount() { return saveCount; },
  };
}

(async () => {
  const selected = fixture();
  const one = await updateTenantFeatures({ scope: 'selected', shopIds: ['shop-a'], feature: 'snow', action: 'enable' }, selected.api);
  assert.equal(one.updatedCount, 1);
  assert.equal(readFeatureState(selected.dbs.get('shop-a')).snow, true);
  assert.equal(readFeatureState(selected.dbs.get('shop-b')).snow, false);
  assert.equal(readFeatureState(selected.dbs.get('shop-b')).rain, null);
  assert.equal(selected.dbs.get('shop-a').products[0].images[0], 'shop-a.png');
  assert.equal(selected.dbs.get('shop-a').orders.some(order => order.id === 'concurrent-order'), true);
  assert.equal(selected.dbs.get('shop-a').users[0].id, 'shop-a-user');

  const all = fixture();
  await assert.rejects(() => updateTenantFeatures({ scope: 'all', feature: 'boxGame', action: 'enable' }, all.api));
  assert.equal(all.saveCount, 0);
  const every = await updateTenantFeatures({ scope: 'all', confirmAll: 'CONFIRM_ALL_TENANTS', feature: 'boxGame', action: 'enable' }, all.api);
  assert.equal(every.updatedCount, 2);
  assert.equal(readFeatureState(all.dbs.get('shop-a')).boxGame, true);
  assert.equal(readFeatureState(all.dbs.get('shop-b')).boxGame, true);
  assert.equal(readFeatureState(all.dbs.get('shop-lab')).boxGame, false);

  const invalid = fixture();
  await assert.rejects(() => updateTenantFeatures({ scope: 'selected', shopIds: ['missing'], feature: 'snow', action: 'enable' }, invalid.api));
  assert.equal(invalid.saveCount, 0);

  const rollback = fixture(2);
  await assert.rejects(() => updateTenantFeatures({ scope: 'all', confirmAll: 'CONFIRM_ALL_TENANTS', feature: 'music', action: 'enable' }, rollback.api));
  assert.equal(readFeatureState(rollback.dbs.get('shop-a')).music, false);
  assert.equal(readFeatureState(rollback.dbs.get('shop-b')).music, false);
  assert.equal(rollback.dbs.get('shop-a').products[0].images[0], 'shop-a.png');
  assert.equal(rollback.dbs.get('shop-a').orders.some(order => order.id === 'concurrent-order'), true);

  const releases = fixture();
  releases.api.platformData.tenantFeatureReleases = [];
  const release = await createRelease({ name: 'ระบบหิมะใหม่', version: '1.0.0', feature: 'snow', action: 'enable' }, releases.api);
  assert.equal(releases.api.platformData.tenantFeatureReleases[0].id, release.id);
  const deployed = await deployRelease({ releaseId: release.id, scope: 'selected', shopIds: ['shop-b'] }, releases.api);
  assert.equal(deployed.updatedCount, 1);
  assert.equal(deployed.verifiedCount, 1);
  assert.equal(readFeatureState(releases.dbs.get('shop-a')).snow, false);
  assert.equal(readFeatureState(releases.dbs.get('shop-b')).snow, true);
  assert.equal(releases.dbs.get('shop-b').settings.systemModules.snow.version, '1.0.0');
  assert.equal(releases.api.platformData.tenantFeatureReleases[0].deployments[0].shopIds[0], 'shop-b');

  const rain = fixture();
  await updateTenantFeatures({ scope: 'selected', shopIds: ['shop-a'], feature: 'rain', action: 'enable' }, rain.api);
  assert.deepEqual(rain.dbs.get('shop-a').settings.rain, { color: '#78c8ff', intensity: 'medium', enabled: true });
  assert.equal(rain.dbs.get('shop-b').settings.rain, undefined);
  assert.equal(readFeatureState(rain.dbs.get('shop-b')).rain, null);
  // Calling the raw feature toggle for 'rain' (no release attached) sets
  // settings.rain but deliberately does NOT install settings.systemModules.rain
  // — readFeatureState reports null (not installed), matching effects.ejs /
  // main.ejs which both gate on systemModules.rain.enabled, not settings.rain
  // alone. This is intentional: rain must be delivered as a real release.
  assert.equal(rain.dbs.get('shop-a').settings.systemModules, undefined);
  assert.equal(readFeatureState(rain.dbs.get('shop-a')).rain, null);

  // The ACTUAL admin-facing delivery flow ("นำส่งระบบ" in rent-app) always
  // goes through createRelease + deployRelease, never the raw toggle above.
  // This must set BOTH settings.rain.enabled and settings.systemModules.rain
  // together on the targeted shop only, so effects.ejs shows the rain
  // settings card and main.ejs renders <canvas id="store-rain">.
  const rainRelease = fixture();
  rainRelease.api.platformData.tenantFeatureReleases = [];
  const rainRel = await createRelease({ name: 'ระบบฝนตกทดสอบ', version: '1.0.0', feature: 'rain', action: 'enable' }, rainRelease.api);
  const rainDeployed = await deployRelease({ releaseId: rainRel.id, scope: 'selected', shopIds: ['shop-a'] }, rainRelease.api);
  assert.equal(rainDeployed.updatedCount, 1);
  const shopA = rainRelease.dbs.get('shop-a');
  assert.equal(shopA.settings.rain.enabled, true);
  assert.equal(shopA.settings.systemModules.rain.enabled, true);
  assert.equal(shopA.settings.systemModules.rain.releaseId, rainRel.id);
  assert.equal(readFeatureState(shopA).rain, true);
  // Untargeted shop and system-lab must be completely untouched.
  assert.equal(rainRelease.dbs.get('shop-b').settings.rain, undefined);
  assert.equal(rainRelease.dbs.get('shop-b').settings.systemModules, undefined);
  assert.equal(rainRelease.dbs.get('shop-lab').settings.rain, undefined);

  // Disabling the same release for the same shop must flip both fields back
  // off, not delete them (so the module stays "installed" but off).
  const disableRelease = await createRelease({ name: 'ระบบฝนตกทดสอบ', version: '1.0.1', feature: 'rain', action: 'disable' }, rainRelease.api);
  await deployRelease({ releaseId: disableRelease.id, scope: 'selected', shopIds: ['shop-a'] }, rainRelease.api);
  const shopAAfterDisable = rainRelease.dbs.get('shop-a');
  assert.equal(shopAAfterDisable.settings.rain.enabled, false);
  assert.equal(shopAAfterDisable.settings.systemModules.rain.enabled, false);
  assert.equal(readFeatureState(shopAAfterDisable).rain, false);

  const lab = fixture();
  lab.api.platformData.users = [{ id: 'admin', username: 'owner', email: 'owner@test', role: 'admin', status: 'active', passwordHash: 'hash' }];
  lab.api.platformData.shops = lab.api.platformData.shops.filter(shop => !shop.isSystemLab);
  const ensuredLab = await ensureSystemLab(lab.api);
  assert.equal(ensuredLab.shop.isSystemLab, true);
  assert.equal(lab.dbs.get(ensuredLab.shop.id).settings.rain.enabled, true);

  const disabledLab = { settings: { rain: { enabled: false }, systemModules: { rain: { version: '2.0.0', enabled: false, releaseId: 'release-disable' } } } };
  assert.equal(ensureLabRainModule(disabledLab), false);
  assert.equal(disabledLab.settings.rain.enabled, false);
  console.log('Tenant delivery checks passed: selected, all, releases, concurrent data preservation, rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });
