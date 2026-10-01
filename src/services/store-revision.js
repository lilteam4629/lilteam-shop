'use strict';

function snapshotRevision(document, documentId) {
  const present = Object.hasOwn(document, '_revision');
  const raw = document._revision;
  const legacy = present && (raw === null || typeof raw === 'string');
  const revision = !present || raw === null ? 0 :
    typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    const error = new Error('INVALID_STORE_REVISION');
    error.code = 'INVALID_STORE_REVISION';
    throw error;
  }
  // Match the exact representation read from MongoDB. A legacy null/string
  // must not be compared to a numeric 0/version, or every retry will fail.
  const filter = { _id: documentId, _revision: !present ? { $exists: false } : raw === null ? { $type: 10 } : raw };
  return { revision, filter, legacy };
}

module.exports = { snapshotRevision };
