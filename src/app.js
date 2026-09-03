const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');

const store = require('./data/store');
const { attachUser } = require('./middleware/auth');
const shopRoutes = require('./routes/shop');
const authRoutes = require('./routes/auth');
const cartRoutes = require('./routes/cart');
const accountRoutes = require('./routes/account');
const minigameRoutes = require('./routes/minigame');
const adminRoutes = require('./routes/admin');
const licenseRoutes = require('./routes/license');
const rentWebsiteRoutes = require('./routes/rent-website');
const tenantRoutes = require('./routes/tenant');
const { tenantResolver } = require('./middleware/tenant');
const license = require('./services/license');
const discordBot = require('./services/discord-bot');
const packageInfo = require('../package.json');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: packageInfo.version,
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || '').slice(0, 12) || null,
    ...store.getSystemStatus(),
  });
});
app.get('/media/:id/:filename?', async (req, res, next) => {
  try {
    const media = await store.getMedia(req.params.id);
    if (!media) return res.sendStatus(404);
    res.setHeader('Content-Type', media.file.metadata?.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', media.file.length);
    // GridFS ids never change their underlying bytes. Let browsers and CDNs
    // keep product images instead of downloading the same full-size files on
    // every page visit, which is especially important for tenant storefronts.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (media.file.uploadDate) res.setHeader('Last-Modified', new Date(media.file.uploadDate).toUTCString());
    media.stream.on('error', next).pipe(res);
  } catch (err) {
    next(err);
  }
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// Resolves store.data to the right shop's own dataset based on subdomain,
// BEFORE session/auth/every route below — see src/middleware/tenant.js.
// No-ops entirely until MAIN_DOMAIN is set, so this is safe to deploy
// ahead of DNS being finished.
app.use(tenantResolver);

app.use(session({
  secret: process.env.SESSION_SECRET || 'lilteam-shop-demo-secret',
  resave: false,
  saveUninitialized: false,
  store: process.env.MONGODB_URI
    ? MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: process.env.MONGODB_DB_NAME || 'lilteam_shop',
        collectionName: 'sessions',
      })
    : undefined,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));
app.use(flash());
app.use(attachUser);

app.use((req, res, next) => {
  res.locals.messages = {
    success: req.flash('success'),
    error: req.flash('error'),
  };
  // The reseller system (/rent-website) only exists on YOUR OWN main shop.
  // Rented deployments (LICENSE_GATE=on) never get it, and neither does a
  // multi-tenant shop's own subdomain (req.tenantShop) — otherwise a shop
  // you rented out could turn around and "open a new shop" itself.
  res.locals.rentWebsiteEnabled = !license.isGateOn() && !req.tenantShop;
  // The EasySlip usage/quota page reads the ONE shared EASYSLIP_API_KEY
  // (your own EasySlip account), not anything per-tenant — showing it on a
  // rented shop's own subdomain would leak your account's credit balance
  // to whoever you rented that shop to.
  res.locals.isMainSite = !req.tenantShop;
  next();
});

// /start and /my-shops (opening/renewing a multi-tenant shop) only make
// sense on the MAIN site — a rented shop's own subdomain shouldn't be able
// to turn around and open another shop from inside itself.
app.use('/', (req, res, next) => {
  if (req.tenantShop) return next();
  tenantRoutes(req, res, next);
});
app.use('/', licenseRoutes);
app.use((req, res, next) => {
  if (!license.isGateOn()) return next();
  const current = store.data.settings.license;
  const active = current.key && current.expiresAt && Date.now() < current.expiresAt;
  if (active) return next();
  res.redirect('/license');
});

app.use('/', shopRoutes);
app.use('/', authRoutes);
app.use('/cart', cartRoutes);
app.use('/account', accountRoutes);
app.use('/minigame', minigameRoutes);
if (!license.isGateOn()) {
  app.use('/rent-website', (req, res, next) => {
    if (req.tenantShop) return next();
    rentWebsiteRoutes(req, res, next);
  });
}
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('shop/404', { layout: 'layouts/main', title: 'ไม่พบหน้านี้' });
});

const PORT = process.env.PORT || 3000;
store.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`LilTeam Shop running at http://localhost:${PORT}`);
    });
    discordBot.init().catch((err) => console.error('[discord-bot] init failed:', err));
  })
  .catch((err) => {
    console.error('Failed to initialize data store:', err);
    process.exit(1);
  });
