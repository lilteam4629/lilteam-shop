// The redesigned, production admin is exclusive to the main shop. Tenant
// shops intentionally continue to use the established admin interface.
function usesMainAdminUi(req) {
  return !req?.tenantShop;
}

function normalizeTenantAdminUi(req, res, next) {
  if (!req?.tenantShop || req.query?.ui !== 'experiment') return next();

  if (req.method === 'GET' || req.method === 'HEAD') {
    const cleanUrl = new URL(req.originalUrl || req.url || req.path || '/admin', 'http://admin.local');
    cleanUrl.searchParams.delete('ui');
    return res.redirect(302, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }

  const legacyQuery = { ...req.query, ui: 'legacy' };
  Object.defineProperty(req, 'query', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: legacyQuery,
  });
  return next();
}

function normalizeMainAdminUi(req, res, next) {
  if (!usesMainAdminUi(req) || !['GET', 'HEAD'].includes(req.method) || !req.query?.ui) return next();
  const cleanUrl = new URL(req.originalUrl || req.url || req.path || '/admin', 'http://admin.local');
  cleanUrl.searchParams.delete('ui');
  return res.redirect(302, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

module.exports = { usesMainAdminUi, normalizeTenantAdminUi, normalizeMainAdminUi };
