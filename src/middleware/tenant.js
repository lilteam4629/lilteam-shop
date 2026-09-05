// Resolves which shop's data a request should operate on, based on
// subdomain (e.g. manae.lilteam.shop). Must run before session/auth and
// before any route, since everything downstream reads/writes via
// store.data, which only resolves to the right tenant once this has run.
//
// Requires MAIN_DOMAIN (e.g. "lilteam.shop") to be set on the seller's own
// shop, with a wildcard DNS record (*.lilteam.shop) pointed at this same
// Railway service, and that domain (plus the wildcard) added under
// Railway's Settings -> Networking -> Custom Domain. Until MAIN_DOMAIN is
// set, this middleware does nothing and every request behaves exactly as
// it always has — safe to deploy before DNS is finished.
const store = require('../data/store');

function getMainDomain(req) {
  if (process.env.MAIN_DOMAIN && process.env.MAIN_DOMAIN.trim()) {
    return process.env.MAIN_DOMAIN.trim().toLowerCase();
  }
  if (req) {
    const host = (req.hostname || req.get('host') || '').toLowerCase().split(':')[0];
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) {
      return 'localhost';
    }
  }
  return 'localhost';
}

function getShopUrl(slug, req) {
  const mainDomain = getMainDomain(req);
  if (mainDomain === 'localhost') {
    const rawHost = req ? (req.get('host') || '') : '';
    const port = rawHost.includes(':') ? rawHost.split(':')[1] : (process.env.PORT || '3000');
    const portPart = port && port !== '80' && port !== '443' ? `:${port}` : '';
    return `http://${slug}.localhost${portPart}`;
  }
  const protocol = req && req.protocol === 'http' && process.env.NODE_ENV !== 'production' ? 'http' : 'https';
  return `${protocol}://${slug}.${mainDomain}`;
}

const MAIN_DOMAIN = (process.env.MAIN_DOMAIN || '').trim().toLowerCase();
const MAIN_SITE_URL = (process.env.MAIN_SITE_URL || '').trim().replace(/\/$/, '') || (MAIN_DOMAIN ? `https://${MAIN_DOMAIN}` : '');

async function tenantResolver(req, res, next) {
  const host = (req.hostname || '').toLowerCase();
  let slug = null;

  // 1. Configured custom domain (e.g. *.lilteam.shop)
  if (MAIN_DOMAIN && MAIN_DOMAIN !== 'localhost') {
    if (host === MAIN_DOMAIN || host === `www.${MAIN_DOMAIN}`) return next();
    const suffix = `.${MAIN_DOMAIN}`;
    if (host.endsWith(suffix)) {
      slug = host.slice(0, -suffix.length);
    }
  }

  // 2. Localhost testing mode (e.g. myshop.localhost)
  if (!slug && (host.endsWith('.localhost') || host.endsWith('.127.0.0.1.nip.io') || host.endsWith('.lvh.me'))) {
    if (host.endsWith('.localhost')) {
      slug = host.slice(0, -'.localhost'.length);
    } else if (host.endsWith('.127.0.0.1.nip.io')) {
      slug = host.slice(0, -'.127.0.0.1.nip.io'.length);
    } else if (host.endsWith('.lvh.me')) {
      slug = host.slice(0, -'.lvh.me'.length);
    }
  }

  // If no subdomain slug is matched, treat as main site
  if (!slug) return next();

  const shop = store.data.shops.find(s => (s.slug || '').toLowerCase() === slug.toLowerCase());
  if (!shop) {
    return res.status(404).send('ไม่พบร้านค้านี้ในระบบ');
  }

  if (shop.expiresAt && Date.now() > shop.expiresAt) {
    const mainUrl = MAIN_SITE_URL || `${req.protocol}://${req.get('host')}`;
    return res.status(402).send(
      `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">` +
      `<title>ร้านหมดอายุ</title><style>body{font-family:sans-serif;background:#100e08;color:#f3ecd8;display:flex;align-items:center;` +
      `justify-content:center;min-height:100vh;margin:0;padding:16px;text-align:center}a{color:#c8a63f}</style></head><body>` +
      `<div><h1>ร้าน "${shop.name}" หมดอายุแล้ว</h1><p>เจ้าของร้านต้องต่ออายุก่อนถึงจะใช้งานต่อได้</p>` +
      `<p><a href="${mainUrl}/my-shops">ไปหน้าต่ออายุ →</a></p></div></body></html>`
    );
  }

  try {
    const tenantDb = await store.loadTenantDb(shop.id);
    if (!tenantDb) {
      return res.status(404).send('ร้านนี้ยังไม่พร้อมใช้งาน');
    }
    req.tenantShop = shop;
    store.runInTenant(shop.id, tenantDb, next);
  } catch (err) {
    next(err);
  }
}

module.exports = { tenantResolver, getMainDomain, getShopUrl, MAIN_DOMAIN, MAIN_SITE_URL };
