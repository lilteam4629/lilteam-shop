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
  const resetFixture = model.fixture();
  resetFixture.settings.payment.receivingAccountResetVersion = 0;
  resetFixture.settings.payment.promptpayId = 'fixture-sensitive';
  resetFixture.settings.payment.bankAccountNumber = 'fixture-sensitive';
  model.migrateFixture(resetFixture);
  check('One-time receiving account reset clears payment identifiers', () => {
    assert.equal(resetFixture.settings.payment.promptpayId, '');
    assert.equal(resetFixture.settings.payment.bankAccountNumber, '');
    assert.equal(resetFixture.settings.payment.receivingAccountResetVersion, 1);
  });
  const { resolveSlipProvider } = require('../src/services/slip-provider');
  check('Legacy SlipOK fallback', () => assert.equal(resolveSlipProvider(legacy.settings.payment, false), 'slipok'));
  check('Legacy EasySlip takes precedence', () => assert.equal(resolveSlipProvider({ easyslipAccounts: { bank: { bankNumber: 'fixture' } } }, true), 'easyslip'));
  check('Explicit manual mode is respected', () => assert.equal(resolveSlipProvider({ slipProvider: 'none', slipokApiKey: 'fixture' }, true), 'none'));
  check('Byshop slip setting falls back to the existing provider', () => assert.equal(resolveSlipProvider({ slipProvider: 'byshop' }, false), 'slipok'));
  check('Explicit tenant-owned Slip2Go is respected', () => assert.equal(resolveSlipProvider({ slipProvider: 'slip2go', easyslipAccounts: { bank: { bankNumber: 'fixture' } } }, true), 'slip2go'));
  const { effectiveSlipConfig } = require('../src/services/slip-config');
  const tenantPayment = { slipApiMode: 'shared', slipProvider: 'slipcheck', slipcheckApiKey: 'tenant-key', promptpayId: 'tenant-receiver' };
  const platformPayment = { slipProvider: 'easyslip', easyslipApiKey: 'platform-key' };
  check('Shared mode uses platform provider but keeps tenant receiving account', () => {
    const effective = effectiveSlipConfig(tenantPayment, platformPayment, true);
    assert.equal(effective.slipProvider, 'easyslip');
    assert.equal(effective.easyslipApiKey, 'platform-key');
    assert.equal(effective.promptpayId, 'tenant-receiver');
  });
  check('Own mode never falls back to platform credentials', () => {
    const effective = effectiveSlipConfig({ ...tenantPayment, slipApiMode: 'own' }, platformPayment, true);
    assert.equal(effective.slipProvider, 'slipcheck');
    assert.equal(effective.slipcheckApiKey, 'tenant-key');
    assert.equal(effective.easyslipApiKey, undefined);
  });
  const receiverProfiles = require('../src/services/receiver-profiles');
  check('Each slip provider keeps an isolated receiving profile', () => {
    const payment = { slipProvider: 'easyslip', promptpayId: 'easy-phone', promptpayName: 'Easy Owner', easyslipAccounts: { easy: { bankNumber: '111111' } } };
    receiverProfiles.save(payment, 'easyslip', receiverProfiles.snapshot(payment));
    receiverProfiles.saveAndActivate(payment, 'slipcheck', { promptpayId: 'check-phone', promptpayName: 'Check Owner', easyslipAccounts: {} });
    assert.equal(receiverProfiles.view(payment, 'easyslip').promptpayId, 'easy-phone');
    assert.equal(receiverProfiles.view(payment, 'slipcheck').promptpayId, 'check-phone');
    assert.equal(receiverProfiles.view(payment, 'slipcheck').easyslipAccounts.easy, undefined);
  });
  let slip2goCalls = 0;
  let slip2goRequest = null;
  class FakeFormData { append() {} getHeaders() { return {}; } }
  const slip2goService = load('src/services/slip2go.js', {
    axios: { post: async (url, form, options) => { slip2goCalls++; slip2goRequest = { url, authorization: options.headers.Authorization }; return { data: { success: true, data: { amount: 10, transRef: 'fixture-ref', receiverName: 'คนละร้าน' } } }; } },
    'form-data': FakeFormData,
  });
  const demoResult = await slip2goService.verifySlip(Buffer.from('fixture'), 10, {}, { apiKey: 'demo_fixture', expectedReceiverNames: ['ร้านทดสอบ'] });
  check('Slip2Go demo-looking keys still call the real API and validate receiver', () => {
    assert.equal(slip2goCalls, 1);
    assert.equal(demoResult.verified, false);
  });
  check('Slip2Go uses the documented Connect endpoint and raw Secret header', () => {
    assert.equal(slip2goRequest.url, 'https://connect.slip2go.com/api/verify-slip/qr-image/info');
    assert.equal(slip2goRequest.authorization, 'demo_fixture');
  });
  const { receiverMatches } = require('../src/services/receiver-match');
  check('Receiver matching accepts Thai titles but rejects unsafe four-digit-only account matches', () => {
    assert.equal(receiverMatches({ actualNames: ['นาย อุรพงค์ สงทิม'], expectedNames: ['อุรพงค์ สงทิม'] }).matched, true);
    assert.equal(receiverMatches({ actualNumbers: ['XXX-X-XX804-4'], expectedNumbers: ['147-3-36804-4'] }).matched, false);
  });
  check('Masked receiver is accepted only when both name and last four digits match', () => {
    assert.equal(receiverMatches({ actualNames: ['อุรพงค์ ส.'], actualNumbers: ['XXX-X-XX804-4'], expectedNames: ['อุรพงค์ สงทิม'], expectedNumbers: ['147-3-36804-4'] }).matched, true);
    assert.equal(receiverMatches({ actualNames: ['คนละชื่อ'], actualNumbers: ['XXX-X-XX804-4'], expectedNames: ['อุรพงค์ สงทิม'], expectedNumbers: ['147-3-36804-4'] }).matched, false);
  });
  check('SlipCheck OCR may differ by one character only when the masked receiver suffix also matches', () => {
    assert.equal(receiverMatches({ actualNames: ['นาย อุรพงค์ สงทิม'], actualNumbers: ['XXX-X-XX804-4'], expectedNames: ['จุรพงค์ ลงทิม'], expectedNumbers: ['147-3-36804-4'] }).matched, true);
    assert.equal(receiverMatches({ actualNames: ['นาย อุรพงค์ สงทิม'], actualNumbers: ['XXX-X-XX999-9'], expectedNames: ['จุรพงค์ ลงทิม'], expectedNumbers: ['147-3-36804-4'] }).matched, false);
  });
  const { extractReceiverEvidence } = require('../src/services/receiver-match');
  check('Nested provider receiver fields are discovered without reading sender fields', () => {
    const found = extractReceiverEvidence({ sender: { name: 'คนโอน', account: '1111' }, result: { destination: { holder: { displayName: 'นาย อุรพงค์ สงทิม' }, accountNo: 'XXX-X-XX804-4' } } });
    assert.equal(found.names.includes('นาย อุรพงค์ สงทิม'), true);
    assert.equal(found.numbers.includes('XXX-X-XX804-4'), true);
    assert.equal(found.names.includes('คนโอน'), false);
  });
  const slipcheckService = load('src/services/slipcheck.js', {
    axios: { post: async () => ({ data: { success: true, data: { amount: 1, ref_no: 'nested-ref', transferred_at: new Date().toISOString(), receiver: { account: { name: { th: 'นาย อุรพงค์ สงทิม' }, number: 'XXX-X-XX804-4' } } } } }) },
    'form-data': FakeFormData,
  });
  const nestedReceiverResult = await slipcheckService.verifySlip(Buffer.from('fixture'), 1, {}, { apiKey: 'fixture', expectedReceiverNames: ['อุรพงค์ สงทิม'], expectedReceiverNumbers: ['147-3-36804-4'] });
  check('SlipCheck accepts nested receiver data returned by the provider', () => assert.equal(nestedReceiverResult.verified, true));
  const flatSlipcheckService = load('src/services/slipcheck.js', {
    axios: { post: async () => ({ data: { success: true, duplicate: false, data: { amount: 1, ref_no: 'flat-ref', transferred_at: new Date().toISOString(), receiver_name: 'นาย อุรพงค์ สงทิม', receiver_bank: 'พร้อมเพย์' } } }) },
    'form-data': FakeFormData,
  });
  const flatReceiverResult = await flatSlipcheckService.verifySlip(Buffer.from('fixture'), 1, {}, { apiKey: 'fixture', expectedReceiverNames: ['อุรพงค์ สงทิม'] });
  check('SlipCheck can verify safely from receiver name when its API omits receiver number', () => assert.equal(flatReceiverResult.verified, true));
  const { numberValue, parseSlipDate, officialEndpoint } = require('../src/services/slip-fields');
  check('Provider field normalization handles formatted amounts and Bangkok timestamps', () => {
    assert.equal(numberValue({ value: '1,234.50' }), 1234.5);
    assert.equal(parseSlipDate('2026-09-06 07:28:15').toISOString(), '2026-09-06T00:28:15.000Z');
  });
  check('Provider endpoints reject non-official hosts', () => {
    assert.equal(officialEndpoint('http://127.0.0.1/private', 'https://safe.example/api', 'safe.example'), 'https://safe.example/api');
  });
  const rdcwErrorService = load('src/services/rdcw-slip.js', {
    axios: { post: async () => ({ data: { success: false, code: 1008, data: { amount: 100, receiverName: 'ร้านทดสอบ' } } }) },
    'form-data': FakeFormData,
  });
  const rdcwExpired = await rdcwErrorService.verifySlip(Buffer.from('fixture'), 1, {}, { clientId: 'id', clientSecret: 'secret', expectedReceiverNames: ['ร้านทดสอบ'] });
  check('SlipRDCW HTTP-200 error payload can never auto-credit', () => { assert.equal(rdcwExpired.verified, false); assert.match(rdcwExpired.message, /หมดอายุ/); });
  const easyService = load('src/services/easyslip.js', {
    dotenv: { config() {} },
    axios: { post: async () => ({ data: { success: true, data: { isDuplicate: false, isAmountMatched: true, matchedAccount: { bankNumber: '147-3-36804-4' }, rawSlip: { transRef: 'easy-ref', date: new Date().toISOString() } } } }) },
    'form-data': FakeFormData,
  });
  const easyMatch = await easyService.verifySlip(Buffer.from('fixture'), 1, {}, ['1473368044'], 'easy-key');
  const easyWrongShop = await easyService.verifySlip(Buffer.from('fixture'), 1, {}, ['9999999999'], 'easy-key');
  check('EasySlip shared account match credits only the intended shop', () => { assert.equal(easyMatch.verified, true); assert.equal(easyWrongShop.verified, false); });

  const als = new AsyncLocalStorage();
  let sequence = 0;
  const platformFixture = model.fixture();
  const store = { get data() { return als.getStore(); }, get platformData() { return platformFixture; },
    isTenantContext: () => Boolean(als.getStore()), genId: () => 'fixture-' + (++sequence),
    save: async () => {}, transact: async fn => fn(als.getStore()),
    isPersistent: () => false, bindTenantContext: fn => AsyncLocalStorage.bind(fn) };
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
  const saveProvider = admin.stack.find(l => Array.isArray(l.route?.path) && l.route.path.includes('/slip-verification') && l.route.methods.post && !l.route.path.includes('/slip-verification/test')).route.stack[0].handle;
  const legacyProviderData = model.fixture();
  legacyProviderData.settings.payment.slipProvider = 'auto';
  await als.run(legacyProviderData, () => saveProvider({
    body: { slipApiMode: 'own', easyslipApiKey: 'easy-saved', slipcheckApiKey: 'check-saved', rdcwClientId: 'rdcw-id', rdcwClientSecret: 'rdcw-secret', slip2goApiKey: 's2g-saved' },
    tenantShop: null, flash() {},
  }, { redirect() {} }));
  check('Legacy auto selection saves as EasySlip and preserves every provider key', () => {
    const saved = legacyProviderData.settings.payment;
    assert.equal(saved.slipProvider, 'easyslip');
    assert.equal(saved.easyslipApiKey, 'easy-saved');
    assert.equal(saved.slipcheckApiKey, 'check-saved');
    assert.equal(saved.rdcwClientSecret, 'rdcw-secret');
    assert.equal(saved.slip2goApiKey, 's2g-saved');
  });
  let testedProvider;
  await hubTest({ body: { provider: 'easyslip' }, tenantShop: { id: 'fixture' } }, { status() { return this; }, json(result) { testedProvider = result; } });
  check('Tenant own EasySlip test requires its own key without exposing central credentials', () => { assert.equal(testedProvider.ok, false); assert.match(testedProvider.message, /API Key/); assert.equal(quotaCalls, 0); });
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
  const tenantViewData = model.fixture();
  tenantViewData.settings.payment.slipApiMode = 'shared';
  platformFixture.settings.payment.easyslipApiKey = 'central-key-must-stay-private';
  const tenantHub = admin.stack.find(l => l.route?.path === '/easyslip-usage' && l.route.methods.get).route.stack.at(-1).handle;
  await als.run(tenantViewData, () => tenantHub(
    { tenantShop: { id: 'tenant-fixture' } },
    { render(view, values) {
      const filename = path.join(root, 'src/views', view + '.ejs');
      const html = ejs.render(fs.readFileSync(filename, 'utf8'), {
        settings: tenantViewData.settings, currentUser: tenantViewData.users[0], messages: { success: [], error: [] },
        isMainSite: false, pendingTopupCount: 0, ...values,
      }, { filename });
      assert.doesNotMatch(html, /data-provider-quota-details/);
      assert.doesNotMatch(html, /central-key-must-stay-private/);
      assert.doesNotMatch(html, />ดูคีย์</);
      assert.match(html, /ระบบตรวจสลิปกลางพร้อมใช้งาน/);
    } },
  ));
  check('Shared tenants cannot see or query central quota details', () => assert.equal(quotaCalls, 1));
  check('Only the main provider page reads central quota during this fixture', () => assert.equal(quotaCalls, 1));
  const tenantTopups = admin.stack.find(l => l.route?.path === '/topups' && l.route.methods.get).route.stack.at(-1).handle;
  platformFixture.settings.payment.slipProvider = 'slipcheck';
  let sharedTopupView;
  await als.run(tenantViewData, () => tenantTopups(
    { query: { receiverProvider: 'easyslip' }, tenantShop: { id: 'tenant-fixture' } },
    { render(view, values) { sharedTopupView = values; } },
  ));
  check('Shared tenant can edit only the provider selected by the platform', () => {
    assert.equal(JSON.stringify(sharedTopupView.availableReceiverProviders), JSON.stringify(['slipcheck']));
    assert.equal(sharedTopupView.activeReceiverProvider, 'slipcheck');
    assert.equal(sharedTopupView.receiverProvider, null);
  });
  const ownTenantViewData = model.fixture();
  ownTenantViewData.settings.payment.slipApiMode = 'own';
  ownTenantViewData.settings.payment.slipProvider = 'rdcw';
  let ownTopupView;
  await als.run(ownTenantViewData, () => tenantTopups(
    { query: { receiverProvider: 'slip2go' }, tenantShop: { id: 'tenant-own-fixture' } },
    { render(view, values) { ownTopupView = values; } },
  ));
  check('Own-API tenant can keep separate receiver settings for every provider', () => {
    assert.equal(JSON.stringify(ownTopupView.availableReceiverProviders), JSON.stringify(['easyslip', 'slipcheck', 'rdcw', 'slip2go']));
    assert.equal(ownTopupView.receiverProvider, 'slip2go');
  });
  check('Provider page initialization does not switch a shared tenant to own API mode', () => {
    const providerPage = fs.readFileSync(path.join(root, 'src/views/admin/easyslip-usage.ejs'), 'utf8');
    assert.match(providerPage, /selectOwnProvider\([^\n]+, false\);/);
  });
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
