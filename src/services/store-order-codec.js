'use strict';
const { deflateRawSync, inflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Lossless storage encoding only. Every route still receives the original
// order items, including draw numbers, amounts and every delivered stock ID.
function encodeStoreSnapshot(data) {
  if (!Array.isArray(data.orders)) return data;
  return { ...data, orders: data.orders.map(order => {
    if (!order.randomBoxOrder || !Array.isArray(order.items)) return order;
    const raw = Buffer.from(JSON.stringify(order.items));
    if (raw.length < 1024) return order;
    const compressed = deflateRawSync(raw, { level: 1 });
    if (compressed.length * 4 / 3 + 180 >= raw.length) return order;
    const packed = { ...order, randomBoxItemsPackedV1: {
      codec: 'deflate-raw-json-v1', sha256: digest(raw), data: compressed.toString('base64'),
    } };
    delete packed.items;
    return packed;
  }) };
}

function decodeStoreSnapshot(data) {
  if (!Array.isArray(data.orders)) return data;
  return { ...data, orders: data.orders.map(order => {
    const packed = order.randomBoxItemsPackedV1;
    if (!packed) return order;
    if (!order.randomBoxOrder || packed.codec !== 'deflate-raw-json-v1' || typeof packed.data !== 'string') {
      throw new Error('INVALID_PACKED_ORDER');
    }
    const raw = inflateRawSync(Buffer.from(packed.data, 'base64'), { maxOutputLength: 32 * 1024 * 1024 });
    if (digest(raw) !== packed.sha256) throw new Error('INVALID_PACKED_ORDER_CHECKSUM');
    const items = JSON.parse(raw.toString('utf8'));
    if (!Array.isArray(items)) throw new Error('INVALID_PACKED_ORDER_ITEMS');
    const restored = { ...order, items };
    delete restored.randomBoxItemsPackedV1;
    return restored;
  }) };
}

module.exports = { encodeStoreSnapshot, decodeStoreSnapshot };
