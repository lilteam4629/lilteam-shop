// Regression checks for the TrueMoney redeem -> wallet credit handoff.
// The provider call is intentionally not made here: the test exercises the
// durable claim state machine that protects a voucher after the provider has
// already accepted it.
const assert = require('node:assert/strict');
const store = require('../src/data/store');
const accountRoutes = require('../src/routes/account');

let id = 0;
store.genId = () => `test-${++id}`;

function useFixture(fixture) {
  store.transact = async mutator => mutator(fixture);
  return fixture;
}

(async () => {
  const first = useFixture({
    users: [{ id: 'user-1', walletBalance: 10 }],
    walletTransactions: [], topupRequests: [], truemoneyRedemptions: [],
  });
  const reservation = await accountRoutes.reserveTrueMoneyClaim('voucher-1', 'user-1');
  assert.equal(reservation.retryExisting, false);
  await accountRoutes.rememberTrueMoneyResult('voucher-1', 'user-1', { amount: 25, senderName: 'Tester' });
  const credit = await accountRoutes.creditTrueMoneyClaim({
    voucherCode: 'voucher-1', userId: 'user-1', result: { amount: 25, senderName: 'Tester' },
  });
  assert.equal(credit.alreadyCredited, false);
  assert.equal(first.users[0].walletBalance, 35);
  assert.equal(first.walletTransactions.length, 1);
  assert.equal(first.topupRequests[0].status, 'approved');

  const replay = await accountRoutes.creditTrueMoneyClaim({
    voucherCode: 'voucher-1', userId: 'user-1', result: { amount: 25, senderName: 'Tester' },
  });
  assert.equal(replay.alreadyCredited, true, 'a voucher must never credit twice');
  assert.equal(first.users[0].walletBalance, 35);

  const pending = useFixture({
    users: [{ id: 'user-2', walletBalance: 0 }],
    walletTransactions: [], topupRequests: [],
    truemoneyRedemptions: [{ voucherCode: 'voucher-2', userId: 'user-2', status: 'processing', amount: 40, senderName: 'Tester' }],
  });
  const recovered = await accountRoutes.reserveTrueMoneyClaim('voucher-2', 'user-2');
  assert.equal(recovered.retryExisting, true);
  assert.equal(recovered.amount, 40);
  await accountRoutes.creditTrueMoneyClaim({
    voucherCode: 'voucher-2', userId: 'user-2', result: { amount: 40, recovered: true, senderName: 'Tester' },
  });
  assert.equal(pending.users[0].walletBalance, 40);
  assert.equal(pending.truemoneyRedemptions[0].status, 'approved');

  const uncredited = useFixture({
    users: [{ id: 'user-2', walletBalance: 0 }],
    walletTransactions: [], topupRequests: [],
    truemoneyRedemptions: [{ voucherCode: 'voucher-3', userId: 'user-2', status: 'failed', amount: 0 }],
  });
  const otherUser = await accountRoutes.reserveTrueMoneyClaim('voucher-3', 'user-3');
  assert.equal(otherUser, null, 'a failed or pending voucher cannot be reassigned');
  console.log('TrueMoney recovery checks passed: durable credit, idempotency, and ownership isolation');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
