const assert = require('assert');
const { updateTenantFeatures, readFeatureState } = require('../src/services/tenant-features');

function fixture(failOnSave) {
  const shops = [{ id: 'shop-a', name: 'A' }, { id: 'shop-b', name: 'B' }];
  const dbs = new Map(shops.map(shop => [shop.id, { settings: { miniGame: { boxEnabled: false, railEnabled: false }, music: { enabled: false }, snow: { enabled: false }, welcomePopup: { enabled: false } } }]));
  let current = null;
  let saveCount = 0;
  return {
    api: {
      platformData: { shops },
      loadTenantDb: async id => dbs.get(id) || null,
      runInTenant: async (id, db, fn) => { const before = current; current = { id, db }; try { return await fn(); } finally { current = before; } },
      save: async () => {
        saveCount += 1;
        if (failOnSave && saveCount === failOnSave) throw new Error('simulated save failure');
        dbs.set(current.id, JSON.parse(JSON.stringify(current.db)));
      },
    }, dbs, get saveCount() { return saveCount; },
  };
}

(async () => {
  const selected = fixture();
  const one = await updateTenantFeatures({ scope: 'selected', shopIds: ['shop-a'], feature: 'snow', action: 'enable' }, selected.api);
  assert.equal(one.updatedCount, 1);
  assert.equal(readFeatureState(selected.dbs.get('shop-a')).snow, true);
  assert.equal(readFeatureState(selected.dbs.get('shop-b')).snow, false);

  const all = fixture();
  const every = await updateTenantFeatures({ scope: 'all', feature: 'boxGame', action: 'enable' }, all.api);
  assert.equal(every.updatedCount, 2);
  assert.equal(readFeatureState(all.dbs.get('shop-a')).boxGame, true);
  assert.equal(readFeatureState(all.dbs.get('shop-b')).boxGame, true);

  const invalid = fixture();
  await assert.rejects(() => updateTenantFeatures({ scope: 'selected', shopIds: ['missing'], feature: 'snow', action: 'enable' }, invalid.api));
  assert.equal(invalid.saveCount, 0);

  const rollback = fixture(2);
  await assert.rejects(() => updateTenantFeatures({ scope: 'all', feature: 'music', action: 'enable' }, rollback.api));
  assert.equal(readFeatureState(rollback.dbs.get('shop-a')).music, false);
  assert.equal(readFeatureState(rollback.dbs.get('shop-b')).music, false);
  console.log('Tenant feature checks passed: selected, all, validation, rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });
