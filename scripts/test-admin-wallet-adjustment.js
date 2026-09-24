const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const {
  adjustCustomerWallet,
  parseMoneyCents,
  WalletAdjustmentError,
} = require('../src/services/admin-wallet-adjustment');
const { collectCatalogApiMembers } = require('../src/services/admin-catalog-wallet-members');

function fixture(balance = 25) {
  return {
    users: [
      { id: 'admin-1', username: 'owner', role: 'admin', walletBalance: 0 },
      { id: 'user-1', username: 'member', role: 'customer', walletBalance: balance },
    ],
    walletTransactions: [],
  };
}

const fixed = {
  userId: 'user-1',
  adminUserId: 'admin-1',
  operation: 'add',
  amount: '10.25',
  expectedBalance: '25.00',
  note: 'ชดเชยยอดที่ตกหล่น',
  now: '2026-09-23T10:00:00.000Z',
  transactionId: 'wallet-test-1',
};

const data = fixture();
const credited = adjustCustomerWallet(data, fixed);
assert.deepEqual(credited, {
  userId: 'user-1', username: 'member', operation: 'add', amount: 10.25,
  previousBalance: 25, balanceAfter: 35.25,
});
assert.equal(data.users[1].walletBalance, 35.25);
assert.equal(data.walletTransactions[0].amount, 10.25);
assert.equal(data.walletTransactions[0].previousBalance, 25);
assert.equal(data.walletTransactions[0].balanceAfter, 35.25);
assert.equal(data.walletTransactions[0].adminUserId, 'admin-1');
assert.match(data.walletTransactions[0].note, /ชดเชยยอดที่ตกหล่น/);

const debited = adjustCustomerWallet(data, {
  ...fixed, operation: 'subtract', amount: '5.25', expectedBalance: '35.25', transactionId: 'wallet-test-2',
});
assert.equal(debited.balanceAfter, 30);
assert.equal(data.walletTransactions[1].amount, -5.25);

for (const invalid of ['-1', '+1', '1e3', '1.001', '0', '1000000.01', '']) {
  assert.throws(() => parseMoneyCents(invalid), WalletAdjustmentError, `reject ${invalid}`);
}
assert.equal(parseMoneyCents('0.00', { allowZero: true }), 0);

const rejectWithoutMutation = (params, expectedMessage) => {
  const untouched = fixture(5);
  const before = structuredClone(untouched);
  assert.throws(() => adjustCustomerWallet(untouched, { ...fixed, expectedBalance: '5.00', ...params }),
    error => error instanceof WalletAdjustmentError && error.message.includes(expectedMessage));
  assert.deepEqual(untouched, before);
};

rejectWithoutMutation({ operation: 'subtract', amount: '6.00' }, 'เครดิตไม่พอ');
rejectWithoutMutation({ expectedBalance: '4.00' }, 'เปลี่ยนไประหว่าง');
rejectWithoutMutation({ userId: 'admin-1' }, 'เฉพาะบัญชีสมาชิก');
rejectWithoutMutation({ userId: 'missing' }, 'ไม่พบสมาชิก');
rejectWithoutMutation({ note: 'x' }, 'เหตุผล');

const apiWalletData = {
  users: [
    { id: 'tenant-admin', username: 'shop-owner', role: 'admin', walletBalance: 0, catalogWalletBalance: 500 },
    { id: 'api-customer', username: 'api-buyer', role: 'customer', walletBalance: 77, catalogWalletBalance: 12.5 },
  ],
  walletTransactions: [],
};
const apiCredited = adjustCustomerWallet(apiWalletData, {
  ...fixed, userId: 'api-customer', adminUserId: 'admin-1', adminUsername: 'owner',
  walletType: 'catalog', tenantShopId: 'tenant-1', amount: '2.50', expectedBalance: '12.50',
  transactionId: 'catalog-wallet-test-1',
});
assert.equal(apiCredited.balanceAfter, 15);
assert.equal(apiWalletData.users[1].catalogWalletBalance, 15);
assert.equal(apiWalletData.users[1].walletBalance, 77, 'API adjustment must not change the normal storefront wallet');
assert.equal(apiWalletData.users[0].catalogWalletBalance, 500, 'API admins must not be eligible for wallet adjustment');
assert.equal(apiWalletData.walletTransactions[0].type, 'catalog-adjust');
assert.equal(apiWalletData.walletTransactions[0].catalogApiTopup, true);
assert.equal(apiWalletData.walletTransactions[0].tenantShopId, 'tenant-1');
assert.equal(apiWalletData.walletTransactions[0].adminUserId, 'admin-1');
assert.match(apiWalletData.walletTransactions[0].note, /owner เพิ่มเครดิต API: ชดเชยยอดที่ตกหล่น/);
assert.throws(() => adjustCustomerWallet(apiWalletData, {
  ...fixed, userId: 'api-customer', walletType: 'catalog', operation: 'subtract', amount: '16',
  expectedBalance: '15.00', transactionId: 'catalog-wallet-test-invalid',
}), error => error instanceof WalletAdjustmentError && error.message.includes('เครดิตไม่พอ'));

(async () => {
const apiMembers = await collectCatalogApiMembers({
  platformData: {
    settings: { shopName: 'LiTeam Shop' },
    users: [
      { id: 'main-api', username: 'main-api', role: 'customer', walletBalance: 90, catalogWalletBalance: 8, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'main-pending', username: 'pending', role: 'customer', walletBalance: 0, catalogWalletBalance: 0, createdAt: '2026-09-02T00:00:00.000Z' },
      { id: 'main-regular', username: 'regular', role: 'customer', walletBalance: 90, catalogWalletBalance: 0, createdAt: '2026-09-03T00:00:00.000Z' },
      { id: 'main-admin', username: 'admin', role: 'admin', walletBalance: 0, catalogWalletBalance: 900, createdAt: '2026-09-04T00:00:00.000Z' },
    ],
    walletTransactions: [{ userId: 'main-api', type: 'catalog-topup' }, { userId: 'main-regular', type: 'topup' }],
    topupRequests: [
      { catalogApiTopup: true, userId: 'main-pending' },
      { catalogApiTopup: true, tenantShopId: 'tenant-1', tenantUserId: 'shared-id' },
    ],
    shops: [{ id: 'tenant-1', name: 'ร้านหนึ่ง', slug: 'shop-one' }, { id: 'tenant-2', name: 'ร้านสอง', slug: 'shop-two' }],
  },
  loadTenantDb: async shopId => shopId === 'tenant-1' ? {
    users: [
      { id: 'shop-admin', username: 'shop-admin', role: 'admin', catalogWalletBalance: 300 },
      { id: 'shared-id', username: 'buyer-one', role: 'customer', email: 'one@example.test', walletBalance: 41, catalogWalletBalance: 14, createdAt: '2026-09-05T00:00:00.000Z' },
    ],
    walletTransactions: [{ userId: 'shared-id', type: 'catalog-purchase' }],
  } : {
    users: [{ id: 'shared-id', username: 'buyer-two', role: 'customer', walletBalance: 41, catalogWalletBalance: 0, createdAt: '2026-09-06T00:00:00.000Z' }],
    walletTransactions: [{ userId: 'shared-id', type: 'catalog-purchase' }],
  },
});
assert.deepEqual(apiMembers.map(member => `${member.tenantShopId}:${member.id}`), [
  'main:main-api', 'main:main-pending', 'tenant-1:shared-id', 'tenant-2:shared-id',
]);
assert.equal(apiMembers.find(member => member.tenantShopId === 'tenant-1').catalogWalletBalance, 14);
assert.equal(apiMembers.find(member => member.tenantShopId === 'tenant-1').apiTransactionCount, 1);
assert.ok(!apiMembers.some(member => member.id === 'main-regular' || member.id === 'main-admin' || member.id === 'shop-admin'));

const usersView = ejs.render(fs.readFileSync(require.resolve('../src/views/admin/users-experiment.ejs'), 'utf8'), {
  asset: path => `/${path}`,
  q: '', status: '', role: '', registered: '', pageSize: 10, source: 'store', shopFilter: '', apiShops: [], platformMemberCount: 2,
  users: [
    { id: 'user-1', username: 'member', email: 'member@example.com', role: 'customer', status: 'active', walletBalance: 25, createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'admin-1', username: 'owner', email: 'owner@example.com', role: 'admin', status: 'active', walletBalance: 0, createdAt: '2026-09-01T00:00:00.000Z' },
  ],
  matchedCount: 2, totalWalletBalance: 25, page: 1, totalPages: 1, pageSizeOptions: [10, 25, 50, 100],
  memberCounts: { all: 2, active: 2, banned: 0, admins: 1, today: 0 },
});
assert.equal((usersView.match(/<button\b[^>]*\bdata-users-adjust\b/g) || []).length, 1, 'only customer rows show a wallet adjustment action');
assert.match(usersView, /name="expectedBalance"/);
assert.match(usersView, /name="operation"/);
assert.match(usersView, /name="note"/);
assert.match(usersView, /ลูกค้าเติม API/);

const apiUsersView = ejs.render(fs.readFileSync(require.resolve('../src/views/admin/users-experiment.ejs'), 'utf8'), {
  asset: path => `/${path}`,
  q: '', status: '', role: '', registered: '', pageSize: 10, source: 'api', shopFilter: 'tenant-1',
  apiShops: [{ id: 'main', name: 'LiTeam Shop' }, { id: 'tenant-1', name: 'ร้านหนึ่ง' }], platformMemberCount: 2,
  users: [{ id: 'buyer-1', tenantShopId: 'tenant-1', username: 'api-buyer', email: 'buyer@example.test', role: 'customer', status: 'active', shopName: 'ร้านหนึ่ง', shopSlug: 'shop-one', createdAt: '2026-09-05T00:00:00.000Z', catalogWalletBalance: 14, apiTransactionCount: 2 }],
  matchedCount: 1, totalWalletBalance: 14, page: 1, totalPages: 1, pageSizeOptions: [10, 25, 50, 100],
  memberCounts: { all: 1, active: 1, banned: 0, admins: 0, today: 0, shops: 1 },
});
assert.match(apiUsersView, /data-wallet-scope="catalog"/);
assert.match(apiUsersView, /data-shop-id="tenant-1"/);
assert.match(apiUsersView, /ยอดกระเป๋า API/);
assert.match(apiUsersView, /14\.00/);
assert.match(apiUsersView, /กระเป๋าสินค้า API/);

console.log('Admin wallet checks passed: storefront/API wallet isolation, tenant-scoped member discovery, audited adjustment, stale balance, and validation');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
