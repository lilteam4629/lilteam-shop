const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const {
  adjustCustomerWallet,
  parseMoneyCents,
  WalletAdjustmentError,
} = require('../src/services/admin-wallet-adjustment');

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

const usersView = ejs.render(fs.readFileSync(require.resolve('../src/views/admin/users-experiment.ejs'), 'utf8'), {
  asset: path => `/${path}`,
  q: '', status: '', role: '', registered: '', pageSize: 10,
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

console.log('Admin wallet adjustment checks passed: member-only control, add/subtract, audit ledger, stale balance, and validation');
