// Runs against in-memory fixtures only; never loads .env or customer databases.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const root = path.resolve(__dirname, '..');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function load(file, mocks = {}, extra = '') {
  const filename = path.join(root, file), localRequire = createRequire(filename);
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, console, setTimeout, clearTimeout, process: { env: {} },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\n' + extra, sandbox, { filename });
  return module.exports;
}
async function main() {
  const model = load('src/data/store.js', {
    dotenv: { config() {} }, '../services/r2': { isEnabled: () => false },
    fs: { writeFileSync() { throw new Error('Unexpected file write'); } },
  }, 'module.exports.fixture = defaultData; module.exports.migrateFixture = migrateSchema;');
  const legacy = model.fixture();
  delete legacy.settings.payment.slipProvider;
  legacy.settings.payment.slipokApiKey = 'fixture-key';
  legacy.users[0].walletBalance = 123.45;
  legacy.orders.push({ id: 'old-order', total: 12 });
  const preserved = JSON.stringify({ users: legacy.users, orders: legacy.orders });
  model.migrateFixture(legacy);
  check('Migration preserves users, balances and orders', () => assert.equal(JSON.stringify({ users: legacy.users, orders: legacy.orders }), preserved));
  check('Migration preserves legacy provider selection', () => assert.equal(legacy.settings.payment.slipProvider, 'auto'));
  const { resolveSlipProvider } = require('../src/services/slip-provider');
  check('Legacy SlipOK fallback', () => assert.equal(resolveSlipProvider(legacy.settings.payment, false), 'slipok'));
  check('Legacy EasySlip takes precedence', () => assert.equal(resolveSlipProvider({ easyslipAccounts: { bank: { bankNumber: 'fixture' } } }, true), 'easyslip'));
  check('Explicit manual mode is respected', () => assert.equal(resolveSlipProvider({ slipProvider: 'none', slipokApiKey: 'fixture' }, true), 'none'));
  check('Byshop slip setting falls back to the existing provider', () => assert.equal(resolveSlipProvider({ slipProvider: 'byshop' }, false), 'slipok'));
  check('Slip2Go cannot replace configured EasySlip', () => assert.equal(resolveSlipProvider({ slipProvider: 'slip2go', easyslipAccounts: { bank: { bankNumber: 'fixture' } } }, true), 'easyslip'));

  const als = new AsyncLocalStorage();
  let sequence = 0;
  const store = { get data() { return als.getStore(); }, genId: () => 'fixture-' + (++sequence),
    save: async () => {}, isPersistent: () => false, bindTenantContext: fn => AsyncLocalStorage.bind(fn) };
  const auth = { currentUser: req => store.data.users.find(u => u.id === req.session.userId), requireLogin: (req, res, next) => next() };
  const cart = load('src/routes/cart.js', { '../data/store': store, '../middleware/auth': auth });
  const checkout = cart.stack.find(l => l.route?.path === '/checkout').route.stack.at(-1).handle;
  function fixture() {
    const db = model.fixture();
    db.users = [{ id: 'buyer', username: 'fixture', walletBalance: 100 }];
    db.products = [{ id: 'product', title: 'Fixture', slug: 'fixture', status: 'active', price: 25 }];
    db.stockItems = [{ id: 'stock', productId: 'product', status: 'available', username: 'fixture-stock' }];
    db.coupons = []; db.orders = []; db.walletTransactions = [];
    return db;
  }
  function request() { return { session: { userId: 'buyer', cart: [{ productId: 'product', qty: 1 }] }, flash() {} }; }
  function response() { return { redirect(url) { this.url = url; } }; }
  const a = fixture(), b = fixture(); b.users[0].id = 'buyer-b';
  const ra = request(), rb = request(); rb.session.userId = 'buyer-b';
  await Promise.all([als.run(a, () => checkout(ra, response())), als.run(b, () => checkout(rb, response()))]);
  check('Concurrent shops each debit their own balance', () => { assert.equal(a.users[0].walletBalance, 75); assert.equal(b.users[0].walletBalance, 75); });
  check('Concurrent shops keep orders isolated', () => { assert.equal(a.orders[0].userId, 'buyer'); assert.equal(b.orders[0].userId, 'buyer-b'); });
  const c = fixture(); c.users[0].walletBalance = 10;
  await als.run(c, () => checkout(request(), response()));
  check('Insufficient balance never sells stock', () => { assert.equal(c.orders.length, 0); assert.equal(c.stockItems[0].status, 'available'); });
  const d = fixture();
  await Promise.all([als.run(d, () => checkout(request(), response())), als.run(d, () => checkout(request(), response()))]);
  check('Duplicate checkout cannot debit twice', () => { assert.equal(d.orders.length, 1); assert.equal(d.users[0].walletBalance, 75); });

  const account = load('src/routes/account.js', {
    '../data/store': store, '../middleware/auth': auth,
    '../services/easyslip': { isConfigured: () => false }, '../services/discord-bot': {},
  });
  const topup = account.stack.find(l => l.route?.path === '/topup' && l.route.methods.post).route.stack[0].handle;
  const f = fixture(), r = request(); r.body = { amount: '30', method: 'bank_transfer' };
  await als.run(f, () => topup(r, response()));
  check('Creating a topup never credits money before verification', () => { assert.equal(f.users[0].walletBalance, 100); assert.equal(f.topupRequests.at(-1).status, 'pending'); });
  r.body.amount = 'Infinity';
  await als.run(f, () => topup(r, response()));
  check('Non-finite topup amounts are rejected', () => assert.equal(f.topupRequests.length, 1));
  let quotaCalls = 0;
  const easy = { isConfigured: () => false, getBanks: async () => [], getAccountInfo: async () => { quotaCalls++; return { ok: false }; } };
  const admin = load('src/routes/admin.js', { '../data/store': store,
    '../middleware/auth': { ...auth, requireAdmin: (req, res, next) => next() },
    '../services/easyslip': easy, '../services/discord-bot': { isConfigured: () => false, isReady: () => false },
    '../services/license': { isGateOn: () => false }, '../middleware/tenant': { MAIN_DOMAIN: 'fixture.test', MAIN_SITE_URL: 'https://fixture.test' },
  });
  const hubTest = admin.stack.find(l => Array.isArray(l.route?.path) && l.route.path.includes('/easyslip-usage/test')).route.stack[0].handle;
  let status;
  await hubTest({ body: { provider: 'easyslip' }, tenantShop: { id: 'fixture' } }, { status(code) { status = code; return this; }, json() {} });
  check('Tenant cannot retrieve central provider account', () => { assert.equal(status, 403); assert.equal(quotaCalls, 0); });
  const viewData = model.fixture(); model.migrateFixture(viewData);
  const ejs = require('ejs');
  let pages = 0;
  for (const url of ['/', '/products', '/products/new', '/filter-tags', '/home-sections', '/scheduled-products', '/orders', '/users', '/topups', '/easyslip-usage', '/coupons', '/minigame', '/settings', '/appearance']) {
    const handler = admin.stack.find(l => l.route?.path === url && l.route.methods.get).route.stack.at(-1).handle;
    const req = { query: {}, params: {}, body: {}, tenantShop: { id: 'fixture' }, flash: () => [], session: {}, get: () => 'fixture.test', protocol: 'https' };
    if (url === '/easyslip-usage') req.tenantShop = null;
    const locals = { settings: viewData.settings, currentUser: viewData.users[0], messages: { success: [], error: [] },
      isMainSite: false, rentWebsiteEnabled: false, persistentStorageEnabled: false, pendingTopupCount: 0, currentRequestUrl: 'https://fixture.test', cartCount: 0,
      themeCss: '', layout: 'layouts/admin' };
    const res = { locals, redirect() {}, render(view, values) {
      const filename = path.join(root, 'src/views', view + '.ejs');
      const html = ejs.render(fs.readFileSync(filename, 'utf8'), { ...locals, ...values }, { filename });
      const layoutFile = path.join(root, 'src/views/layouts/admin.ejs');
      ejs.render(fs.readFileSync(layoutFile, 'utf8'), { ...locals, ...values, body: html }, { filename: layoutFile });
      assert.ok(html.length > 0); pages++;
    } };
    await als.run(viewData, () => handler(req, res));
  }
  check('Updated admin pages render with migrated fixtures', () => assert.equal(pages, 14));
  check('Only the main provider page calls central quota API', () => assert.equal(quotaCalls, 1));
  let js = 0, templates = 0;
  function scan(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(filename);
    else if (filename.endsWith('.js')) { new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }); js++; }
    else if (filename.endsWith('.ejs')) { require('ejs').compile(fs.readFileSync(filename, 'utf8'), { filename }); templates++; }
  } }
  scan(path.join(root, 'src'));
  console.log(JSON.stringify({ checks, js, templates, customerDataAccessed: false }));
}
main().catch(err => { console.error(err); process.exitCode = 1; });
