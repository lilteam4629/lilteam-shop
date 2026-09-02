const crypto = require('crypto');
const path = require('path');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const accountId = String(process.env.R2_ACCOUNT_ID || '').trim();
const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
const bucket = String(process.env.R2_BUCKET || '').trim();
const endpoint = String(process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).replace(/\/$/, '');
const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');

const enabled = Boolean(endpoint && accessKeyId && secretAccessKey && bucket && publicBaseUrl);
const client = enabled
  ? new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    })
  : null;

function safeFilename(filename) {
  const parsed = path.parse(String(filename || 'upload'));
  const base = parsed.name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'upload';
  return { base, extension: parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, '') };
}

async function prepareUpload(buffer, filename, contentType) {
  const isImage = /^image\/(jpeg|png|webp|avif|tiff)$/i.test(String(contentType || ''));
  const safe = safeFilename(filename);
  if (!isImage) {
    return {
      body: buffer,
      contentType: contentType || 'application/octet-stream',
      filename: `${safe.base}${safe.extension}`,
    };
  }

  const sharp = require('sharp');
  // Store one browser-friendly source image. This removes oversized camera
  // metadata, auto-rotates, and prevents multi-megapixel uploads from making
  // storefront pages slow. Existing animated GIFs are deliberately untouched.
  const body = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 })
    .toBuffer();
  return { body, contentType: 'image/webp', filename: `${safe.base}.webp` };
}

function publicUrlForKey(key) {
  return `${publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function uploadMedia(buffer, filename, contentType, options = {}) {
  if (!enabled) return null;
  const prepared = await prepareUpload(buffer, filename, contentType);
  const date = new Date();
  const prefix = options.prefix || `media/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const id = options.stableId || crypto.randomUUID();
  const key = `${prefix}/${id}-${prepared.filename}`;

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: prepared.body,
    ContentType: prepared.contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    ContentDisposition: 'inline',
  }));

  return { url: publicUrlForKey(key), key, bytes: prepared.body.length, contentType: prepared.contentType };
}

async function objectExists(key) {
  if (!enabled) return false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err && (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound')) return false;
    throw err;
  }
}

module.exports = {
  isEnabled: () => enabled,
  uploadMedia,
  objectExists,
  publicUrlForKey,
};
