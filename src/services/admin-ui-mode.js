// Experimental admin screens are reserved for the platform's own shop.
// Tenant shops keep their existing admin interface even if an experiment URL
// is copied or bookmarked.
function usesExperimentalAdminUi(req) {
  return !req?.tenantShop && req?.query?.ui === 'experiment';
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

module.exports = { usesExperimentalAdminUi, normalizeTenantAdminUi };
