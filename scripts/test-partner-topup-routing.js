const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const mainDbPath = path.join(os.tmpdir(), `lilteam-partner-topup-${process.pid}.json`);
process.env.NODE_ENV = 'test';
process.env.TEST_DB_PATH = mainDbPath;
// Keep this regression check fully isolated from the production Atlas database.
process.env.MONGODB_URI = '';
const store = require('../src/data/store');
const accountRoutes = require('../src/routes/account');
const topups = require('../src/services/topups');

(async () => {
  const shopId = `test-partner-${process.pid}`;
  let tenantDb;
  try {
    await store.init();
    tenantDb = await store.createTenantDb(shopId, {
      shopName: 'Partner Test Shop',
      adminUsername: 'partner-user',
      adminEmail: 'partner@example.test',
      adminPasswordHash: 'test',
    });
    const user = tenantDb.users[0];
    const created = await store.runInTenant(shopId, tenantDb, () => accountRoutes.createTopupRequest({
      user,
      amount: 125,
      method: 'bank_transfer',
      catalogApiTopup: true,
      tenantShopId: shopId,
      tenantShopName: 'Partner Test Shop',
    }));
    assert.strictEqual(created.ok, true);
    assert.ok(store.platformData.topupRequests.some(item => item.id === created.request.id && item.tenantShopId === shopId));
    assert.ok(!tenantDb.topupRequests.some(item => item.id === created.request.id), 'Partner request must be queued on the platform');

    const approved = await topups.approveTopup(created.request.id);
    assert.strictEqual(approved.ok, true);
    assert.strictEqual(approved.user.id, user.id);
    assert.strictEqual(store.platformData.topupRequests.find(item => item.id === created.request.id).status, 'approved');
    assert.strictEqual(tenantDb.users[0].catalogWalletBalance, 125);
    assert.strictEqual(tenantDb.walletTransactions.filter(item => item.topupRequestId === created.request.id).length, 1);

    const secondApproval = await topups.approveTopup(created.request.id);
    assert.strictEqual(secondApproval.ok, false, 'An approved request must not be credited twice');
    console.log('Partner top-up checks passed: platform queue, tenant wallet credit, idempotent approval');
  } finally {
    try { fs.unlinkSync(path.join(__dirname, '..', 'src', 'data', `db.shop.${shopId}.json`)); } catch {}
    try { fs.unlinkSync(mainDbPath); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
