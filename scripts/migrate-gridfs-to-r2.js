require('dotenv').config({ quiet: true });
const { MongoClient, GridFSBucket } = require('mongodb');
const r2 = require('../src/services/r2');

const apply = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'lilteam_shop';

function replaceLegacyUrls(value, replacements) {
  if (typeof value === 'string') {
    const exact = replacements.get(value);
    if (exact) return exact;
    for (const [oldUrl, newUrl] of replacements) {
      if (value.startsWith(`${oldUrl}/`)) return newUrl;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => replaceLegacyUrls(item, replacements));
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = replaceLegacyUrls(value[key], replacements);
  }
  return value;
}

function readGridFsFile(bucket, id) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    bucket.openDownloadStream(id)
      .on('data', chunk => chunks.push(chunk))
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function main() {
  if (!uri) throw new Error('MONGODB_URI is required');
  if (!r2.isEnabled()) throw new Error('All R2_* environment variables are required');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const files = await db.collection('media.files').find({}).sort({ uploadDate: 1 }).toArray();
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: found ${files.length} GridFS files`);
    if (!apply) {
      console.log('No data changed. Re-run with --apply during a maintenance window.');
      return;
    }

    const bucket = new GridFSBucket(db, { bucketName: 'media' });
    const replacements = new Map();
    let sourceBytes = 0;
    let destinationBytes = 0;

    for (const [index, file] of files.entries()) {
      const buffer = await readGridFsFile(bucket, file._id);
      const uploaded = await r2.uploadMedia(
        buffer,
        file.filename,
        file.metadata?.contentType || 'application/octet-stream',
        { prefix: 'legacy', stableId: file._id.toString() },
      );
      const oldPrefix = `/media/${file._id.toString()}`;
      replacements.set(oldPrefix, uploaded.url);
      replacements.set(`${oldPrefix}/${encodeURIComponent(file.filename)}`, uploaded.url);
      sourceBytes += file.length || buffer.length;
      destinationBytes += uploaded.bytes;
      console.log(`[${index + 1}/${files.length}] ${file.filename}`);
    }

    const collection = db.collection('app_data');
    const documents = await collection.find({}).toArray();
    for (const document of documents) {
      const id = document._id;
      delete document._id;
      replaceLegacyUrls(document, replacements);
      await collection.replaceOne({ _id: id }, { _id: id, ...document });
    }

    console.log(JSON.stringify({
      migratedFiles: files.length,
      updatedDocuments: documents.length,
      sourceBytes,
      destinationBytes,
      gridFsDeleted: false,
    }, null, 2));
    console.log('GridFS originals were kept for rollback. Delete them only after production verification and a database backup.');
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
