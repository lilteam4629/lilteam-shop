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
const adminRoutes = require('./routes/admin');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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
  next();
});

app.use('/', shopRoutes);
app.use('/', authRoutes);
app.use('/cart', cartRoutes);
app.use('/account', accountRoutes);
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
  })
  .catch((err) => {
    console.error('Failed to initialize data store:', err);
    process.exit(1);
  });
