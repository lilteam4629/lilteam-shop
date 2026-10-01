'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbPath = path.join(os.tmpdir(), `gacha-local-transaction-${process.pid}.json`);
process.env.NODE_ENV = 'test';
process.env.TEST_DB_PATH = dbPath;
process.env.MONGODB_URI = '';
const store = require('../src/data/store');
const originalWrite = fs.writeFileSync;
(async () => {
  try {
    await store.init();
    const initial = JSON.stringify(store.data);
    const disk = fs.readFileSync(dbPath, 'utf8');
    await assert.rejects(store.transact(data => {
      data.users[0].walletBalance -= 5;
      data.orders.push({ id: 'failed-order' });
      throw new Error('mutation failed');
    }), /mutation failed/);
    assert.ok(JSON.stringify(store.data) === initial, 'failed checkout must not change the live wallet/orders');
    assert.equal(fs.readFileSync(dbPath, 'utf8'), disk);
    fs.writeFileSync = function (filename, ...args) {
      if (String(filename).startsWith(dbPath)) {
        const error = new Error('simulated disk full'); error.code = 'ENOSPC'; throw error;
      }
      return originalWrite.call(this, filename, ...args);
    };
    await assert.rejects(store.transact(data => {
      data.users[0].walletBalance -= 7;
      data.orders.push({ id: 'unpersisted-order' });
    }), { code: 'ENOSPC' });
    fs.writeFileSync = originalWrite;
    assert.ok(JSON.stringify(store.data) === initial, 'storage failure must roll back memory');
    assert.equal(fs.readFileSync(dbPath, 'utf8'), disk, 'storage failure must preserve the previous file');
    await store.transact(data => { data.users[0].walletBalance += 10; });
    assert.equal(JSON.parse(fs.readFileSync(dbPath, 'utf8')).users[0].walletBalance, store.data.users[0].walletBalance);
    const beforePreview = JSON.stringify(store.data);
    await store.previewTransaction(data => { data.users[0].walletBalance = 0; });
    assert.equal(JSON.stringify(store.data), beforePreview);
    const items = Array.from({ length: 500 }, (_, index) => ({ price: 1, productId: 'box',
      randomBoxDraw: { isWin: index === 109, prizeCount: index === 109 ? 1 : 0, prizeItems: [], missMessage: 'ไม่ได้รับรางวัล' } }));
    await store.transact(data => { data.orders.push({ id: 'packed-order', randomBoxOrder: true, total: 500, items }); });
    const savedOrder = JSON.parse(fs.readFileSync(dbPath, 'utf8')).orders.find(order => order.id === 'packed-order');
    assert.ok(savedOrder.randomBoxItemsPackedV1 && !savedOrder.items);
    await store.init();
    assert.deepEqual(store.data.orders.find(order => order.id === 'packed-order').items, items, 'restart must restore every original draw');
    console.log('PASS: local JSON rollback on mutation/storage failure, atomic commit and read-only preview');
  } finally {
    fs.writeFileSync = originalWrite;
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
