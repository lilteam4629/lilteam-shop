// This flag controls owner-only actions and platform-wide information. It is
// deliberately separate from the shared admin presentation.
function usesMainAdminUi(req) {
  return !req?.tenantShop;
}

function normalizeMainAdminUi(req, res, next) {
  if (!usesMainAdminUi(req) || !['GET', 'HEAD'].includes(req.method) || !req.query?.ui) return next();
  const cleanUrl = new URL(req.originalUrl || req.url || req.path || '/admin', 'http://admin.local');
  cleanUrl.searchParams.delete('ui');
  return res.redirect(302, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

module.exports = { usesMainAdminUi, normalizeMainAdminUi };
