const assert = require('node:assert/strict');
const { todayRevenue, resetTodayRevenue } = require('../src/services/dashboard-revenue');
const now = '2026-10-01T16:59:00Z'; // 23:59 Bangkok
const options = { mainSite: true, now, adminUserId: 'owner' };
const data = {
  settings: {}, users: [{ id: 'owner', role: 'admin' }],
  orders: [
    { id: 'a', status: 'paid', total: 100.25, createdAt: now },
    { id: 'b', status: 'completed', total: 50, createdAt: now },
    { id: 'cancel', status: 'cancelled', total: 999, createdAt: now },
    { id: 'partner', status: 'paid', salesChannel: 'catalog-api-fulfillment', total: 999, createdAt: now },
    { id: 'old', status: 'paid', total: 999, createdAt: '2026-09-30T16:00:00Z' },
  ],
};
assert.equal(todayRevenue(data, options), 150.25);
const original = structuredClone(data);
assert.throws(() => resetTodayRevenue(data, { ...options, mainSite: false }));
assert.throws(() => resetTodayRevenue(data, { ...options, adminUserId: 'customer' }));
assert.deepEqual(data, original);
resetTodayRevenue(data, options);
assert.equal(todayRevenue(data, options), 0);
assert.deepEqual(data.orders, original.orders);
assert.deepEqual(data.users, original.users);
assert.equal(todayRevenue(data, { ...options, mainSite: false }), 150.25, 'tenants ignore a reset record');
data.orders[0].status = 'cancelled';
data.orders.push({ id: 'new', total: 20.75, status: 'paid', createdAt: now });
assert.equal(todayRevenue(JSON.parse(JSON.stringify(data)), options), 20.75, 'new sales survive reload and old cancellation');
resetTodayRevenue(data, options);
assert.equal(todayRevenue(data, options), 0, 'repeat reset');
const tomorrow = '2026-10-01T17:00:00Z'; // 00:00 next day Bangkok
data.orders.push({ id: 'tomorrow', total: 35, status: 'paid', createdAt: tomorrow });
assert.equal(todayRevenue(data, { ...options, now: tomorrow }), 35, 'reset expires at Bangkok midnight');
console.log('PASS: dashboard revenue reset, retained orders, new sales, reload, access and Bangkok midnight');
