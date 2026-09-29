const store = require('../data/store');
const theme = require('../services/theme');
const { visibleStorefrontCategories } = require('../services/storefront-category-visibility');
const { requestShopSettings } = require('../services/shop-branding');

function currentUser(req) {
  if (!req.session.userId) return null;
  const user = store.data.users.find(u => u.id === req.session.userId) || null;
  if (user && user.status === 'banned') {
    delete req.session.userId;
    return null;
  }
  return user;
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
    ...requestShopSettings(store.data.settings, req.tenantShop),
    // Rangers Market is an isolated System Lab experiment. A stale value
    // previously saved on another shop must never activate the trial UI.
    storefrontModel: req.tenantShop?.isSystemLab
      ? store.data.settings.storefrontModel
      : (store.data.settings.storefrontModel === 'rangers-market' ? 'classic' : store.data.settings.storefrontModel),
    contactFacebook: normalizeExternalLink(store.data.settings.contactFacebook),
    contactMessenger: normalizeExternalLink(store.data.settings.contactMessenger),
  };
  // Keep the mini-game category configured in storage; omit it only from public storefront navigation.
  res.locals.navFilterTags = visibleStorefrontCategories(store.data.filterTags);
  // Customer-facing storefronts are intentionally limited to black/white.
  // Normalize legacy tenant theme records before rendering so saved accent,
  // coloured background, and effect settings cannot bleed into any rental
  // shop or product route.
  res.locals.storefrontMonochrome = true;
  res.locals.themeCss = theme.renderCss(theme.toMonochromeStorefrontTheme(store.data.settings.theme));
  res.locals.adminBrandCss = theme.renderAdminAccentCss(store.data.settings.theme);
  next();
}

function requireLogin(req, res, next) {
  if (req.session.userId) {
    const rawUser = store.data.users.find(u => u.id === req.session.userId);
    if (rawUser && rawUser.status === 'banned') {
      return req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/login');
      });
    }
  }
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
