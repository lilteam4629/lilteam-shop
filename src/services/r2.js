const crypto = require('crypto');
const path = require('path');
const { S3Client, PutObjectCommand, HeadObjectCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

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
let directUploadCorsReady = false;

async function ensureDirectUploadCors() {
  if (directUploadCorsReady || !enabled) return;
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [{
    AllowedOrigins: ['*'], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type'], ExposeHeaders: ['etag'], MaxAgeSeconds: 3600,
  }] } }));
  directUploadCorsReady = true;
}

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

async function createDirectUpload(filename, contentType) {
  if (!enabled) throw new Error('R2 ยังไม่ได้ตั้งค่า');
  await ensureDirectUploadCors();
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const mime = String(contentType || '').toLowerCase();
  if (!allowed.has(mime)) throw new Error('รองรับเฉพาะ PNG, JPG, WEBP และ GIF');
  const safe = safeFilename(filename);
  const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
  const date = new Date();
  const key = `media/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}-${safe.base}${extensions[mime]}`;
  const uploadUrl = await getSignedUrl(client, new PutObjectCommand({
    Bucket: bucket, Key: key, ContentType: mime,
  }), { expiresIn: 300 });
  return { uploadUrl, publicUrl: publicUrlForKey(key) };
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
  createDirectUpload,
  objectExists,
  publicUrlForKey,
};
