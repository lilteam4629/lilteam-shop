function getCloudUrl() {
  const configured = (process.env.CLOUD_SITE_URL || '').trim();
  const domain = (process.env.MAIN_DOMAIN || '').trim();
  const value = configured || (domain && domain !== 'localhost' ? `https://rent.${domain}` : 'http://localhost:3001');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CLOUD_SITE_URL must be an HTTP(S) origin');
  }
  return url.origin;
}
module.exports = { getCloudUrl };
