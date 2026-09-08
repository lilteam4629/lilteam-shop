const fs = require('fs');
const path = require('path');
require('express-async-errors');
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
const internalApiRoutes = require('./routes/internal-api');
const { tenantResolver, MAIN_DOMAIN } = require('./middleware/tenant');
const license = require('./services/license');
const discordBot = require('./services/discord-bot');
const packageInfo = require('../package.json');

const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

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

// Static assets are served with a 4-hour cache, so an edited stylesheet
// would otherwise keep showing its old version in already-open browsers.
// Stamping each link with the file's own mtime means every deploy that
// actually changes a file busts only that file's cache, automatically —
// no hand-maintained ?v=x.y.z to forget to bump.
const assetVersions = new Map();
app.locals.asset = (publicPath) => {
  if (!assetVersions.has(publicPath)) {
    let stamp = Date.now();
    try {
      stamp = fs.statSync(path.join(__dirname, '..', 'public', publicPath)).mtimeMs;
    } catch { /* missing file: fall back to boot time so links still work */ }
    assetVersions.set(publicPath, Math.floor(stamp).toString(36));
  }
  return `/${publicPath.replace(/^\/+/, '')}?v=${assetVersions.get(publicPath)}`;
};

// Resolves store.data to the right shop's own dataset based on subdomain,
// BEFORE session/auth/every route below — see src/middleware/tenant.js.
// No-ops entirely until MAIN_DOMAIN is set, so this is safe to deploy
// ahead of DNS being finished.
app.use(tenantResolver);

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Persistent session store for local development (prevents getting logged out on server reload)
const SESSION_DIR = path.join(__dirname, '..', 'data', 'sessions');
if (!fs.existsSync(SESSION_DIR)) {
  try { fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch (e) {}
}

class LocalFileSessionStore extends session.Store {
  constructor() {
    super();
  }
  get(sid, cb) {
    const file = path.join(SESSION_DIR, `${sid}.json`);
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) return cb(null, null);
      try {
        const sess = JSON.parse(data);
        if (sess.cookie && sess.cookie.expires && new Date(sess.cookie.expires) <= new Date()) {
          this.destroy(sid, () => {});
          return cb(null, null);
        }
        cb(null, sess);
      } catch (e) {
        cb(null, null);
      }
    });
  }
  set(sid, sess, cb) {
    const file = path.join(SESSION_DIR, `${sid}.json`);
    fs.writeFile(file, JSON.stringify(sess), 'utf8', cb || (() => {}));
  }
  destroy(sid, cb) {
    const file = path.join(SESSION_DIR, `${sid}.json`);
    fs.unlink(file, (err) => {
      if (err && err.code !== 'ENOENT') {
        if (cb) return cb(err);
      }
      if (cb) cb(null);
    });
  }
}

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
    : new LocalFileSessionStore(),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
}));
app.use(flash());
app.use(attachUser);

app.use((req, res, next) => {
  res.locals.messages = {
    success: req.flash('success'),
    error: req.flash('error'),
  };
  // The EasySlip usage/quota page reads the ONE shared EASYSLIP_API_KEY
  // (your own EasySlip account), not anything per-tenant — showing it on a
  // rented shop's own subdomain would leak your account's credit balance
  // to whoever you rented that shop to.
  res.locals.isMainSite = !req.tenantShop;
  // Absolute URL of the current page, for the og:url share tag — falls back
  // to this when a route doesn't pass its own ogUrl.
  res.locals.currentRequestUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  next();
});

// rent.<MAIN_DOMAIN> now points (at the reverse-proxy level, outside this
// app) to a fully separate rent-app deployment — see IMPORT-REVIEW/plan
// notes. This app no longer renders anything for that host itself; it
// only exposes /internal/api for the rent-app to call. 'rent' stays
// reserved (RESERVED_TENANT_SUBDOMAINS in middleware/tenant.js,
// RESERVED_SLUGS in services/shop-provisioning.js) so no tenant shop can
// ever claim that slug even though routing happens at nginx now.
app.use('/internal/api', internalApiRoutes);

// Old rental bookmarks lead to Cloud; all rental writes happen there.
app.use(require('./middleware/cloud-redirects'));
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
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('shop/404', { layout: 'layouts/main', title: 'ไม่พบหน้านี้' });
});

app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]', err);
  if (res.headersSent) return next(err);
  res.status(500).render('shop/404', { layout: 'layouts/main', title: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
});

const PORT = process.env.PORT || 3000;
let server = null;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, draining active requests...`);
  if (!server) return process.exit(0);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 25000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

store.init()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`LilTeam Shop running at http://localhost:${PORT}`);
    });
    discordBot.init().catch((err) => console.error('[discord-bot] init failed:', err));
  })
  .catch((err) => {
    console.error('Failed to initialize data store:', err);
    process.exit(1);
  });
