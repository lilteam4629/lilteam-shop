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

const MAIN_DOMAIN = (process.env.MAIN_DOMAIN || '').trim().toLowerCase();

async function tenantResolver(req, res, next) {
  if (!MAIN_DOMAIN) return next();
  const host = (req.hostname || '').toLowerCase();
  if (host === MAIN_DOMAIN || host === `www.${MAIN_DOMAIN}`) return next();
  const suffix = `.${MAIN_DOMAIN}`;
  if (!host.endsWith(suffix)) return next(); // e.g. the Railway *.up.railway.app domain -> main site

  const slug = host.slice(0, -suffix.length);
  const shop = store.data.shops.find(s => s.slug === slug);
  if (!shop) {
    return res.status(404).send('ไม่พบร้านนี้');
  }
  if (shop.expiresAt && Date.now() > shop.expiresAt) {
    return res.status(402).send(
      `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">` +
      `<title>ร้านหมดอายุ</title><style>body{font-family:sans-serif;background:#100e08;color:#f3ecd8;display:flex;align-items:center;` +
      `justify-content:center;min-height:100vh;margin:0;padding:16px;text-align:center}a{color:#c8a63f}</style></head><body>` +
      `<div><h1>ร้าน "${shop.name}" หมดอายุแล้ว</h1><p>เจ้าของร้านต้องต่ออายุก่อนถึงจะใช้งานต่อได้</p>` +
      `<p><a href="https://${MAIN_DOMAIN}/my-shops">ไปหน้าต่ออายุ →</a></p></div></body></html>`
    );
  }
  try {
    const tenantDb = await store.loadTenantDb(shop.id);
    if (!tenantDb) {
      return res.status(404).send('ร้านนี้ยังไม่พร้อมใช้งาน');
    }
    store.runInTenant(shop.id, tenantDb, next);
  } catch (err) {
    next(err);
  }
}

module.exports = { tenantResolver, MAIN_DOMAIN };
