const { getCloudUrl } = require('../services/cloud-url');
module.exports = (req, res, next) => {
  if (req.tenantShop) return next();
  let target;
  if (req.path === '/start') target = '/start' + (typeof req.query.plan === 'string' ? '?plan=' + encodeURIComponent(req.query.plan) : '');
  else if (req.path === '/my-shops' || req.path.startsWith('/my-shops/')) target = '/my-shops';
  else if (/^\/rent-website(?:\/|$)/.test(req.path)) {
    const sale = req.path.match(/^\/rent-website\/sale\/([^/]+)(\/status)?$/);
    target = sale ? '/sales/' + encodeURIComponent(sale[1]) + (sale[2] || '') : '/';
  } else if (/^\/admin\/(?:license-plans|rented-shops|discord)(?:\/|$)/.test(req.path)) {
    target = req.path.startsWith('/admin/license-plans') ? '/admin/plans' : '/admin/rentals';
  }
  if (!target) return next();
  // Never forward old POST bodies or credentials between applications.
  res.redirect(303, getCloudUrl() + target);
};
