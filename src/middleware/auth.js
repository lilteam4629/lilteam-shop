const store = require('../data/store');
const theme = require('../services/theme');

function currentUser(req) {
  if (!req.session.userId) return null;
  return store.data.users.find(u => u.id === req.session.userId) || null;
}

function attachUser(req, res, next) {
  res.locals.currentUser = currentUser(req);
  res.locals.cartCount = (req.session.cart || []).length;
  res.locals.settings = store.data.settings;
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
