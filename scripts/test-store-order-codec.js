'use strict';
const assert = require('node:assert/strict');
const { BSON } = require('mongodb');
const { encodeStoreSnapshot, decodeStoreSnapshot } = require('../src/services/store-order-codec');
const fixture = { users: [{ id: 'buyer', walletBalance: 500 }], stockItems: [{ id: 'delivered', status: 'sold' }],
  orders: Array.from({ length: 60 }, (_, orderIndex) => ({ id: `order-${orderIndex}`, randomBoxOrder: true, total: 500,
    items: Array.from({ length: 500 }, (_, index) => ({ productId: 'box', title: 'กล่องสุ่ม'.repeat(12), price: 1,
      productImage: 'https://example.test/' + 'image'.repeat(80), stockItemId: index === 109 ? 'delivered' : null,
      randomBoxDraw: { isWin: index === 109, prizeCount: index === 109 ? 1 : 0,
        prizeItems: index === 109 ? [{ stockItemId: 'delivered', productTitle: 'รางวัล' }] : [],
        missMessage: index === 109 ? null : 'ยังไม่ได้รับรางวัลในครั้งนี้', walletBalance: 0 } })) })) };
fixture.orders.push({ id: 'normal', randomBoxOrder: false, total: 25, items: [{ productId: 'normal', price: 25 }] });
const before = BSON.calculateObjectSize(fixture);
const packed = encodeStoreSnapshot(fixture);
const after = BSON.calculateObjectSize(packed);
assert.ok(before > 16 * 1024 * 1024, 'fixture must reproduce the document-size failure');
assert.ok(after < 16 * 1024 * 1024, 'lossless encoding must make the same history writable');
assert.deepEqual(decodeStoreSnapshot(packed), fixture, 'all amounts, draws, reward IDs and non-box orders must round-trip');
assert.ok(Array.isArray(fixture.orders[0].items), 'encoding must not mutate the live order');
assert.deepEqual(encodeStoreSnapshot(packed), packed, 'already packed documents remain stable');
const tampered = structuredClone(packed);
tampered.orders[0].randomBoxItemsPackedV1.sha256 = '0'.repeat(64);
assert.throws(() => decodeStoreSnapshot(tampered), /CHECKSUM/);
console.log(`PASS: oversized history ${before} bytes -> ${after} bytes; exact round-trip of 30000 draw results`);
