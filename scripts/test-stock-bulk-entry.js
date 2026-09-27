const assert = require('node:assert/strict');
const { parseBulkStockEntries } = require('../src/services/stock-bulk-entry');

assert.deepEqual(parseBulkStockEntries('ไอดีสินค้า 1\r\nไอดีสินค้า 2\n\n  ไอดีสินค้า 3  '), [
  { username: 'ไอดีสินค้า 1', password: '', extra: '' },
  { username: 'ไอดีสินค้า 2', password: '', extra: '' },
  { username: 'ไอดีสินค้า 3', password: '', extra: '' },
]);

assert.deepEqual(parseBulkStockEntries('user01:pass01:หมายเหตุ:เพิ่มเติม\nuser02:pass02\n:ไม่มีชื่อ'), [
  { username: 'user01', password: 'pass01', extra: 'หมายเหตุ:เพิ่มเติม' },
  { username: 'user02', password: 'pass02', extra: '' },
]);

console.log('Stock bulk-entry checks passed: one plain line per item and legacy colon-separated credentials');
