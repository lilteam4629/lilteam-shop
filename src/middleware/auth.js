const store = require('../data/store');
const theme = require('../services/theme');

function currentUser(req) {
  if (!req.session.userId) return null;
  return store.data.users.find(u => u.id === req.session.userId) || null;
}

// A contact link saved without "http(s)://" (e.g. just "m.me/page") resolves
// as a path on this site itself when used as a raw <a href>, leading to a
// 404 instead of opening Messenger/Facebook. Normalized here too (not just
// on save in admin.js) so a link already saved that way before this fix
// existed starts working immediately, without needing anyone to resave it.
function normalizeExternalLink(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function attachUser(req, res, next) {
  res.locals.currentUser = currentUser(req);
  res.locals.cartCount = (req.session.cart || []).length;
  res.locals.settings = {
    ...store.data.settings,
    contactFacebook: normalizeExternalLink(store.data.settings.contactFacebook),
    contactMessenger: normalizeExternalLink(store.data.settings.contactMessenger),
  };
  res.locals.themeCss = theme.renderCss(store.data.settings.theme);
  next();
}

function requireLogin(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    req.flash('error', 'กรุณาเข้าสู่ระบบก่อน');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== 'admin') {
    req.flash('error', 'ไม่มีสิทธิ์เข้าถึงหน้านี้');
    return res.redirect('/login');
  }
  next();
}

module.exports = { currentUser, attachUser, requireLogin, requireAdmin };
