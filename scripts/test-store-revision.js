'use strict';
const assert = require('node:assert/strict');
const { snapshotRevision } = require('../src/services/store-revision');

function matches(doc, filter) {
  if (doc._id !== filter._id) return false;
  const wanted = filter._revision;
  if (wanted?.$exists === false) return !Object.hasOwn(doc, '_revision');
  if (wanted?.$type === 10) return Object.hasOwn(doc, '_revision') && doc._revision === null;
  return doc._revision === wanted;
}
for (const original of [{ _id: 'main' }, { _id: 'main', _revision: null },
  { _id: 'main', _revision: 0 }, { _id: 'main', _revision: 7 }, { _id: 'main', _revision: '7' }]) {
  const plan = snapshotRevision(original, 'main');
  assert.equal(matches(original, plan.filter), true, 'first checkout must accept legacy representation');
  const saved = { _id: 'main', _revision: plan.revision + 1 };
  assert.equal(matches(saved, plan.filter), false, 'a stale checkout must not overwrite a competing checkout');
  assert.equal(snapshotRevision(saved, 'main').revision, plan.revision + 1);
  assert.equal(matches({ ...original, _id: 'shop:other' }, plan.filter), false);
}
assert.equal(matches({ _id: 'main', _revision: 0 }, snapshotRevision({ _id: 'main' }, 'main').filter), false);
assert.equal(matches({ _id: 'main' }, snapshotRevision({ _id: 'main', _revision: null }, 'main').filter), false);
for (const value of [-1, 'bad', {}, [], 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
  assert.throws(() => snapshotRevision({ _revision: value }, 'main'), { code: 'INVALID_STORE_REVISION' });
}
console.log('PASS: missing/null/string/numeric revisions, stale writes and shop isolation');
