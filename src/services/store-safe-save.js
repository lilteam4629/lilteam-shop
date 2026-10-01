'use strict';
const { snapshotRevision } = require('./store-revision');
async function saveSnapshot(collection, documentId, snapshot) {
  const { revision, filter } = snapshotRevision(snapshot, documentId);
  const value = { ...snapshot, _id: documentId, _revision: revision + 1 };
  let result;
  try {
    result = await collection.replaceOne(filter, value, { upsert: !Object.hasOwn(snapshot, '_revision') });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  if (!result || (!result.modifiedCount && !result.upsertedCount)) {
    const conflict = new Error('ข้อมูลเปลี่ยนแปลงพร้อมกัน กรุณารีเฟรชแล้วลองใหม่');
    conflict.code = 'STORE_WRITE_CONFLICT';
    throw conflict;
  }
  return revision + 1;
}
module.exports = { saveSnapshot };
