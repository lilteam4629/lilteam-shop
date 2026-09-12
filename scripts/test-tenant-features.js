const assert = require('assert');
const { updateTenantFeatures, readFeatureState } = require('../src/services/tenant-features');

function fixture(failOnSave) {
  const shops = [{ id: 'shop-a', name: 'A' }, { id: 'shop-b', name: 'B' }];
  const dbs = new Map(shops.map(shop => [shop.id, {
    settings: { miniGame: { boxEnabled: false, railEnabled: false }, music: { enabled: false }, snow: { enabled: false }, welcomePopup: { enabled: false } },
    products: [{ id: `${shop.id}-product`, images: [`${shop.id}.png`] }],
    orders: [{ id: `${shop.id}-order` }], users: [{ id: `${shop.id}-user` }],
  }]));
  let current = null;
  let saveCount = 0;
  return {
    api: {
      platformData: { shops },
      loadTenantDb: async id => dbs.get(id) || null,
      runInTenant: async (id, db, fn) => { const before = current; current = { id, db }; try { return await fn(); } finally { current = before; } },
      transact: async mutator => {
        saveCount += 1;
        if (failOnSave && saveCount === failOnSave) throw new Error('simulated save failure');
        // Simulate a customer order arriving after the control page loaded.
        const latest = JSON.parse(JSON.stringify(dbs.get(current.id)));
        if (saveCount === 1) latest.orders.push({ id: 'concurrent-order' });
        const result = await mutator(latest);
        dbs.set(current.id, latest);
        current.db = latest;
        return result;
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
  assert.equal(selected.dbs.get('shop-a').products[0].images[0], 'shop-a.png');
  assert.equal(selected.dbs.get('shop-a').orders.some(order => order.id === 'concurrent-order'), true);
  assert.equal(selected.dbs.get('shop-a').users[0].id, 'shop-a-user');

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
  assert.equal(rollback.dbs.get('shop-a').products[0].images[0], 'shop-a.png');
  assert.equal(rollback.dbs.get('shop-a').orders.some(order => order.id === 'concurrent-order'), true);
  console.log('Tenant feature checks passed: selected, all, validation, concurrent data preservation, rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });
