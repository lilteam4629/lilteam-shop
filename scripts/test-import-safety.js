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
    Buffer, URL, console, setTimeout, clearTimeout, setInterval: () => ({ unref() {} }), clearInterval() {}, process: { env: {} },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\n' + extra, sandbox, { filename });
  return module.exports;
}
async function main() {
  const appSource = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  const storeSource = fs.readFileSync(path.join(root, 'src/data/store.js'), 'utf8');
  const storeInitSource = storeSource.slice(storeSource.indexOf('async function init()'), storeSource.indexOf('async function healthCheck()'));
  const { shouldRunStartupTenantRollouts } = require('../src/services/startup-policy');
  check('Local startup cannot roll out changes to rented shops unless explicitly enabled', () => {
    assert.equal(shouldRunStartupTenantRollouts({ NODE_ENV: 'development' }), false);
    assert.equal(shouldRunStartupTenantRollouts({ NODE_ENV: 'test', MONGODB_URI: 'configured' }), false);
    assert.equal(shouldRunStartupTenantRollouts({ NODE_ENV: 'production' }), true);
    assert.equal(shouldRunStartupTenantRollouts({ NODE_ENV: 'production', SKIP_STARTUP_TENANT_ROLLOUTS: '1' }), false);
    assert.equal(shouldRunStartupTenantRollouts({ NODE_ENV: 'development', ENABLE_STARTUP_TENANT_ROLLOUTS: '1' }), true);
  });
  check('Production sessions reject the demo secret fallback', () => {
    assert.match(appSource, /NODE_ENV === 'production'[^\n]+configuredSessionSecret\.length < 32/);
    assert.match(appSource, /SESSION_SECRET must be configured/);
  });
  check('Startup receiving-account marker updates only the main shop record', () => {
    assert.match(storeInitSource, /mongoCollection\.updateOne\(\s*\{\s*_id:\s*'main'/);
    assert.doesNotMatch(storeInitSource, /mongoCollection\.updateMany\(/);
  });
  check('Regular request bodies have explicit size and parameter limits', () => {
    assert.match(appSource, /express\.urlencoded\(\{[^}]*limit:\s*['"]1mb['"][^}]*parameterLimit:\s*2000/s);
    assert.match(appSource, /express\.json\(\{\s*limit:\s*['"]1mb['"]\s*\}\)/);
  });
  check('Public media lookup excludes private uploads', () => {
    assert.match(storeSource, /metadata\.private['"]?\s*:\s*\{\s*\$ne:\s*true\s*\}/);
  });
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
  check('Migration preserves existing bank receiving details while marking reset complete', () => {
    assert.equal(Object.hasOwn(resetFixture.settings.payment, 'promptpayId'), false);
    assert.equal(resetFixture.settings.payment.bankAccountNumber, 'fixture-sensitive');
    assert.equal(resetFixture.settings.payment.receivingAccountResetVersion, 1);
  });
  const removedProviderFixture = model.fixture();
  Object.assign(removedProviderFixture.settings.payment, {
    slipProvider: 'easyslip', easyslipApiKey: 'secret-fixture', easyslipAccounts: { bank: { accountId: 'legacy' } }, easyslipStatus: 'connected',
    promptpayId: 'legacy-phone', promptpayName: 'Legacy Owner', promptpayQrImage: 'legacy-image',
    receiverProfiles: { slipcheck: { promptpayId: 'legacy-phone', promptpayName: 'Legacy Owner', promptpayQrImage: 'legacy-image' } },
  });
  model.migrateFixture(removedProviderFixture);
  check('Migration removes EasySlip credentials and maps it to SlipCheck', () => {
    assert.equal(removedProviderFixture.settings.payment.slipProvider, 'slipcheck');
    assert.equal(Object.hasOwn(removedProviderFixture.settings.payment, 'easyslipApiKey'), false);
    assert.equal(Object.hasOwn(removedProviderFixture.settings.payment, 'easyslipAccounts'), false);
    assert.equal(Object.hasOwn(removedProviderFixture.settings.payment, 'promptpayId'), false);
    assert.equal(Object.hasOwn(removedProviderFixture.settings.payment.receiverProfiles.slipcheck, 'promptpayId'), false);
  });
  const { resolveSlipProvider } = require('../src/services/slip-provider');
  check('Unrecognized legacy provider safely falls back to SlipOK', () => assert.equal(resolveSlipProvider({ slipProvider: 'easyslip' }), 'slipok'));
  check('Explicit manual mode is respected', () => assert.equal(resolveSlipProvider({ slipProvider: 'none', slipokApiKey: 'fixture' }), 'none'));
  check('Explicit tenant-owned Slip2Go is respected', () => assert.equal(resolveSlipProvider({ slipProvider: 'slip2go' }), 'slip2go'));
  const { effectiveSlipConfig } = require('../src/services/slip-config');
  const tenantPayment = { slipApiMode: 'shared', slipProvider: 'slipcheck', slipcheckApiKey: 'tenant-key', promptpayId: 'tenant-receiver' };
  const platformPayment = { slipProvider: 'slipcheck', slipcheckApiKey: 'platform-key' };
  check('Shared mode uses platform provider but keeps tenant receiving account', () => {
    const effective = effectiveSlipConfig(tenantPayment, platformPayment, true);
    assert.equal(effective.slipProvider, 'slipcheck');
    assert.equal(effective.slipcheckApiKey, 'platform-key');
    assert.equal(Object.hasOwn(effective, 'promptpayId'), false);
  });
  check('Own mode never falls back to platform credentials', () => {
    const effective = effectiveSlipConfig({ ...tenantPayment, slipApiMode: 'own' }, platformPayment, true);
    assert.equal(effective.slipProvider, 'slipcheck');
    assert.equal(effective.slipcheckApiKey, 'tenant-key');
    assert.equal(effective.slipcheckApiKey, 'tenant-key');
  });
  const receiverProfiles = require('../src/services/receiver-profiles');
  check('Only supported verification providers can keep separate receiving profiles', () => {
    const payment = { slipProvider: 'slipcheck', bankAccountNumber: '1234567890', bankAccountName: 'Check Owner', promptpayId: 'legacy-phone' };
    receiverProfiles.saveAndActivate(payment, 'slipcheck', receiverProfiles.snapshot(payment));
    assert.equal(receiverProfiles.view(payment, 'slipcheck').bankAccountNumber, '1234567890');
    assert.equal(Object.hasOwn(receiverProfiles.view(payment, 'slipcheck'), 'promptpayId'), false);
    assert.equal(Object.hasOwn(payment.receiverProfiles.slipcheck, 'promptpayId'), false);
    assert.deepEqual(receiverProfiles.PROVIDERS, ['slipcheck', 'rdcw', 'slip2go', 'xepht']);
  });
  check('PromptPay receiver fields and customer payment option are removed', () => {
    const adminForm = fs.readFileSync(path.join(root, 'src/views/admin/topups.ejs'), 'utf8');
    const customerForm = fs.readFileSync(path.join(root, 'src/views/shop/topup.ejs'), 'utf8');
    assert.doesNotMatch(adminForm, /name="(?:promptpayId|promptpayName|promptpayQrImage)"/);
    assert.doesNotMatch(customerForm, /value="promptpay"|พร้อมเพย์/);
  });
  check('Admin inventory value excludes issued IDs', () => {
    const adminRoutes = fs.readFileSync(path.join(root, 'src/routes/admin.js'), 'utf8');
    const productsPage = fs.readFileSync(path.join(root, 'src/views/admin/products.ejs'), 'utf8');
    assert.match(adminRoutes, /totalAvailableProductCount = products\.reduce\(\(sum, product\) => sum \+ product\.stockCount/);
    assert.match(adminRoutes, /Number\(product\.price\) \|\| 0\) \* product\.stockCount/);
    assert.match(productsPage, /มูลค่าไอดีที่พร้อมขาย/);
    assert.match(productsPage, /data-available-stock/);
  });
  check('Admin top-up rows hide empty slip placeholders', () => {
    const topupsPage = fs.readFileSync(path.join(root, 'src/views/admin/topups.ejs'), 'utf8');
    assert.doesNotMatch(topupsPage, /ยังไม่แนบสลิป/);
    assert.match(topupsPage, /if \(r\.slipPath\)/);
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
  let xephtRequest = null;
  class XephtFormData {
    constructor() { this.fields = []; }
    append(name, value) { this.fields.push([name, value]); }
    getHeaders() { return { 'content-type': 'multipart/form-data; boundary=fixture' }; }
  }
  const xephtService = load('src/services/xepht-slip.js', {
    axios: { post: async (url, form, options) => {
      xephtRequest = { url, fields: form.fields, headers: options.headers };
      return { status: 200, data: { success: true, code: 'VERIFIED', data: {
        trans_ref: 'xepht-fixture-ref', amountInSlip: 10, is_amount_matched: true,
        rawSlip: { transRef: 'xepht-fixture-ref', date: '2026-09-18T12:00:00+07:00', receiver: { account: { name: { th: 'ร้านทดสอบ' }, bank: { account: '1234567890' } } } },
      } } };
    } },
    'form-data': XephtFormData,
    './receiver-match': require('../src/services/receiver-match'),
    './slip-fields': require('../src/services/slip-fields'),
  });
  const xephtResult = await xephtService.verifySlip(Buffer.from('fixture'), 10, { filename: 'slip.png', contentType: 'image/png' }, {
    apiKey: 'xepht-fixture-key', expectedReceiverNames: ['ร้านทดสอบ'], expectedReceiverNumbers: ['1234567890'],
  });
  check('Slip XEPHT sends documented multipart fields and verifies the shared receiver', () => {
    assert.equal(xephtResult.verified, true);
    assert.equal(xephtRequest.url, 'https://slip.xepht.com/api/v1/slips/verify');
    assert.equal(xephtRequest.headers['X-Api-Key'], 'xepht-fixture-key');
    assert.equal(xephtRequest.fields.find(field => field[0] === 'amount')[1], '10.00');
    assert.equal(xephtRequest.fields.find(field => field[0] === 'receiver_account')[1], '1234567890');
    assert.equal(xephtRequest.fields.find(field => field[0] === 'receiver_name')[1], 'ร้านทดสอบ');
  });
  const duplicateService = load('src/services/xepht-slip.js', {
    axios: { post: async () => ({ status: 200, data: { code: 'VERIFIED', data: { amountInSlip: 10, is_duplicate: true } } }) },
    'form-data': XephtFormData,
    './receiver-match': require('../src/services/receiver-match'), './slip-fields': require('../src/services/slip-fields'),
  });
  const duplicateResult = await duplicateService.verifySlip(Buffer.from('fixture'), 10);
  check('Slip XEPHT rejects duplicate results before crediting', () => {
    assert.equal(duplicateResult.verified, false);
    assert.equal(duplicateResult.providerCode, 'SLIP_ALREADY_USED');
  });
  const unauthorizedService = load('src/services/xepht-slip.js', {
    axios: { post: async () => { const error = new Error('unauthorized'); error.response = { status: 401, data: { code: 'UNAUTHORIZED', message: 'bad key' } }; throw error; } },
    'form-data': XephtFormData,
    './receiver-match': require('../src/services/receiver-match'), './slip-fields': require('../src/services/slip-fields'),
  });
  const unauthorizedResult = await unauthorizedService.verifySlip(Buffer.from('fixture'), 10);
  check('Slip XEPHT authentication errors are actionable instead of endlessly pending', () => {
    assert.equal(unauthorizedResult.checked, true);
    assert.equal(unauthorizedResult.retryable, false);
    assert.equal(unauthorizedResult.providerCode, 'UNAUTHORIZED');
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
  const slipcheckQuotaService = load('src/services/slipcheck.js', {
    axios: { post: async () => ({ data: { success: false, code: 429, message: 'quota exceeded' } }) },
    'form-data': FakeFormData,
  });
  const quotaResult = await slipcheckQuotaService.verifySlip(Buffer.from('fixture'), 1, {}, { apiKey: 'fixture' });
  check('SlipCheck exposes exhausted quota instead of a generic verification failure', () => {
    assert.equal(quotaResult.quotaExhausted, true);
    assert.match(quotaResult.message, /โควตา.*หมด/);
  });
  const slipcheckRateLimitService = load('src/services/slipcheck.js', {
    axios: { post: async () => { const error = new Error('Too Many Requests'); error.response = { status: 429, data: {} }; throw error; } },
    'form-data': FakeFormData,
  });
  const rateLimitResult = await slipcheckRateLimitService.verifySlip(Buffer.from('fixture'), 1, {}, { apiKey: 'fixture' });
  check('SlipCheck HTTP 429 is marked as exhausted quota', () => assert.equal(rateLimitResult.quotaExhausted, true));
  let pooledCalls = 0;
  const slipcheckPoolService = load('src/services/slipcheck.js', {
    axios: {
      post: async (url, form, options) => {
        pooledCalls++;
        if (options.headers['x-api-key'] === 'empty-key') return { data: { success: false, code: 429, message: 'quota exceeded' } };
        return { data: { success: true, data: { amount: 1, ref_no: 'pool-ref', receiver_name: 'นาย อุรพงค์ สงทิม' } } };
      },
      get: async (url, options) => ({ data: { success: true, quota: options.headers['x-api-key'] === 'empty-key' ? { used: 500, limit: 500 } : { used: 2, limit: 500 } } }),
    },
    'form-data': FakeFormData,
  });
  const pooledResult = await slipcheckPoolService.verifySlip(Buffer.from('fixture'), 1, {}, { apiKeys: ['empty-key', 'available-key'], expectedReceiverNames: ['อุรพงค์ สงทิม'] });
  check('SlipCheck automatically falls back to the next key after quota exhaustion', () => { assert.equal(pooledResult.verified, true); assert.equal(pooledCalls, 2); });
  const poolInfo = await slipcheckPoolService.getPoolAccountInfo(['empty-key', 'available-key']);
  check('SlipCheck uses the shared account quota once without exposing raw API keys', () => { assert.equal(poolInfo.totalRemaining, 0); assert.equal(poolInfo.totalMax, 500); assert.equal(poolInfo.accounts[0].key, '••••-key'); assert.equal(poolInfo.accounts.some(account => account.key === 'empty-key'), false); });
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
    '../data/store': store, '../middleware/auth': auth, '../services/discord-bot': {},
  });
  const xephtReadiness = model.fixture();
  xephtReadiness.settings.payment.slipProvider = 'xepht';
  check('XEPHT requires a receiving account before automatic verification', () => {
    assert.equal(als.run(xephtReadiness, () => account.canCheckSlipAutomatically(xephtReadiness.settings.payment)), false);
    xephtReadiness.settings.payment.bankAccountNumber = '1234567890';
    xephtReadiness.settings.payment.bankAccountName = 'ร้านทดสอบ';
    assert.equal(als.run(xephtReadiness, () => account.canCheckSlipAutomatically(xephtReadiness.settings.payment)), true);
  });
  const topup = account.stack.find(l => l.route?.path === '/topup' && l.route.methods.post).route.stack[0].handle;
  const f = fixture(), r = request(); r.body = { amount: '30', method: 'bank_transfer' };
  await als.run(f, () => topup(r, response()));
  check('Creating a topup never credits money before verification', () => { assert.equal(f.users[0].walletBalance, 100); assert.equal(f.topupRequests.at(-1).status, 'pending'); });
  r.body.amount = 'Infinity';
  await als.run(f, () => topup(r, response()));
  check('Non-finite topup amounts are rejected', () => assert.equal(f.topupRequests.length, 1));
  for (const provider of ['slipcheck', 'rdcw', 'slip2go', 'xepht']) {
    const bankOnly = fixture();
    bankOnly.settings.payment.slipProvider = provider;
    bankOnly.settings.payment.slipApiMode = 'own';
    const rejectedPromptPay = await als.run(bankOnly, () => account.createTopupRequest({ user: bankOnly.users[0], amount: 10, method: 'promptpay' }));
    const acceptedBank = await als.run(bankOnly, () => account.createTopupRequest({ user: bankOnly.users[0], amount: 10, method: 'bank_transfer' }));
    check(`${provider} accepts bank transfer but rejects PromptPay requests`, () => {
      assert.equal(rejectedPromptPay.ok, false);
      assert.match(rejectedPromptPay.error, /บัญชีธนาคาร/);
      assert.equal(acceptedBank.ok, true);
    });
  }
  const admin = load('src/routes/admin.js', { '../data/store': store,
    '../middleware/auth': { ...auth, requireAdmin: (req, res, next) => next() },
    '../services/discord-bot': { isConfigured: () => false, isReady: () => false },
    '../services/license': { isGateOn: () => false }, '../middleware/tenant': { MAIN_DOMAIN: 'fixture.test', MAIN_SITE_URL: 'https://fixture.test' },
  });
  const shellMiddleware = admin.stack.find(layer => !layer.route && String(layer.handle).includes('pendingTopupCount')).handle;
  let mainShellLayout = '';
  let tenantShellLayout = '';
  const applyMainShell = { locals: {} };
  const applyTenantShell = { locals: {} };
  als.run(model.fixture(), () => shellMiddleware({ tenantShop: null }, applyMainShell, () => {}));
  als.run(model.fixture(), () => shellMiddleware({ tenantShop: { id: 'tenant-shell-fixture' } }, applyTenantShell, () => {}));
  mainShellLayout = applyMainShell.locals.layout;
  tenantShellLayout = applyTenantShell.locals.layout;
  check('Every main-shop admin route defaults to the unified shell while rental admins retain the old shell', () => {
    assert.equal(mainShellLayout, 'layouts/admin-experiment');
    assert.equal(tenantShellLayout, 'layouts/admin');
  });
  const { normalizeMainAdminUi, normalizeTenantAdminUi, usesMainAdminUi } = require('../src/services/admin-ui-mode');
  const mainPostRequest = { method: 'POST', query: {}, tenantShop: null };
  let mainPostContinued = false;
  normalizeMainAdminUi(mainPostRequest, {}, () => { mainPostContinued = true; });
  let mainUiRedirect = '';
  normalizeMainAdminUi(
    { method: 'GET', query: { ui: 'experiment', q: 'sample' }, tenantShop: null, originalUrl: '/admin/settings?ui=experiment&q=sample' },
    { redirect(status, url) { mainUiRedirect = `${status}:${url}`; } },
    () => assert.fail('main experiment query should redirect to the canonical production URL'),
  );
  check('The main admin uses the production UI without a mode query and keeps other filters on canonical URLs', () => {
    assert.equal(usesMainAdminUi({ query: {}, tenantShop: null }), true);
    assert.equal(usesMainAdminUi({ query: { ui: 'experiment' }, tenantShop: null }), true);
    assert.equal(usesMainAdminUi({ query: {}, tenantShop: { id: 'tenant-ui-fixture' } }), false);
    assert.equal(mainPostContinued, true);
    assert.equal(mainUiRedirect, '302:/admin/settings?q=sample');
    assert.deepEqual(mainPostRequest.query, {});
  });
  let tenantUiRedirect = '';
  normalizeTenantAdminUi(
    { method: 'GET', query: { ui: 'experiment', q: 'sample' }, tenantShop: { id: 'tenant-ui-fixture' }, originalUrl: '/admin/users?ui=experiment&q=sample' },
    { redirect(status, url) { tenantUiRedirect = `${status}:${url}`; } },
    () => assert.fail('tenant experiment GET should redirect before rendering'),
  );
  const tenantPostUi = { method: 'POST', query: { ui: 'experiment', q: 'sample' }, tenantShop: { id: 'tenant-ui-fixture' } };
  let tenantPostContinued = false;
  normalizeTenantAdminUi(tenantPostUi, {}, () => { tenantPostContinued = true; });
  check('Tenant experiment URLs are normalized to the legacy UI without dropping other query data', () => {
    assert.equal(tenantUiRedirect, '302:/admin/users?q=sample');
    assert.equal(tenantPostContinued, true);
    assert.equal(tenantPostUi.query.ui, 'legacy');
    assert.equal(tenantPostUi.query.q, 'sample');
    assert.equal(usesMainAdminUi(tenantPostUi), false);
    assert.equal(usesMainAdminUi({ query: { ui: 'experiment' }, tenantShop: null }), true);
  });
  const settingsGet = admin.stack.find(layer => layer.route?.path === '/settings' && layer.route.methods.get).route.stack.at(-1).handle;
  let settingsMainView = '';
  let settingsTenantView = '';
  settingsGet({ query: {}, tenantShop: null }, { locals: {}, render(view) { settingsMainView = view; } });
  settingsGet({ query: {}, tenantShop: { id: 'tenant-ui-fixture' } }, { locals: {}, render(view) { settingsTenantView = view; } });
  check('Main settings use the production management screen while tenant settings stay on the old template', () => {
    assert.equal(settingsMainView, 'admin/settings-experiment');
    assert.equal(settingsTenantView, 'admin/settings');
  });
  const settingsPost = admin.stack.find(layer => layer.route?.path === '/settings' && layer.route.methods.post).route.stack.at(-1).handle;
  const settingsFixture = model.fixture();
  let settingsRedirect = '';
  await als.run(settingsFixture, () => settingsPost(
    { body: { shopName: 'Main Store', tagline: 'Real storefront', contactLine: '@main', contactFacebook: 'facebook.com/main', contactMessenger: 'm.me/main', contactFacebookName: 'Main', contactResponseTime: '5 นาที', openHours: '24 ชั่วโมง', showOpenHoursBar: 'on' },
      flash() {} },
    { redirect(pathname) { settingsRedirect = pathname; } },
  ));
  check('Main settings POST persists store data and returns to the canonical live page', () => {
    assert.equal(settingsFixture.settings.shopName, 'Main Store');
    assert.equal(settingsFixture.settings.contactFacebook, 'https://facebook.com/main');
    assert.equal(settingsRedirect, '/admin/settings');
  });
  const productionPageTemplates = [
    ['/theme', 'admin/theme'],
    ['/announcements', 'admin/announcements'],
    ['/welcome-popup', 'admin/welcome-popup-main'],
  ];
  check('Main theme, announcement, and welcome-popup routes use the database-backed screens', () => {
    for (const [routePath, expectedView] of productionPageTemplates) {
      const handler = admin.stack.find(layer => layer.route?.path === routePath && layer.route.methods.get).route.stack.at(-1).handle;
      let mainView = '';
      als.run(model.fixture(), () => handler({ query: {}, tenantShop: null }, { render(view) { mainView = view; } }));
      assert.equal(mainView, expectedView, routePath);
    }
  });
  const welcomePopupHandler = admin.stack.find(layer => layer.route?.path === '/welcome-popup' && layer.route.methods.get).route.stack.at(-1).handle;
  let tenantWelcomePopupView = '';
  welcomePopupHandler({ tenantShop: { id: 'popup-tenant-fixture' } }, { render(view) { tenantWelcomePopupView = view; } });
  check('Tenant welcome-popup administration keeps its existing screen', () => assert.equal(tenantWelcomePopupView, 'admin/welcome-popup'));
  const popupFixture = model.fixture();
  popupFixture.settings.welcomePopup = { enabled: true, showTitle: true, showContent: true, title: 'ยินดีต้อนรับร้านหลัก', content: 'ข้อความตัวอย่างจากข้อมูลร้าน', images: ['/media/welcome-fixture.webp'] };
  const popupTemplatePath = path.join(root, 'src/views/admin/welcome-popup-main.ejs');
  const popupHtml = require('ejs').render(fs.readFileSync(popupTemplatePath, 'utf8'), {
    settings: popupFixture.settings, asset: value => '/' + value,
  }, { filename: popupTemplatePath });
  check('Main welcome popup redesign renders persisted content and keeps real upload/save fields', () => {
    assert.match(popupHtml, /ยินดีต้อนรับร้านหลัก/);
    assert.match(popupHtml, /\/media\/welcome-fixture\.webp/);
    assert.match(popupHtml, /action="\/admin\/welcome-popup"/);
    assert.match(popupHtml, /name="images"/);
    assert.match(popupHtml, /name="removeImages"/);
    assert.match(popupHtml, /name="enabled"/);
    assert.match(popupHtml, /admin-welcome-popup-main-v1\.css/);
  });
  const usersList = admin.stack.find(layer => layer.route?.path === '/users' && layer.route.methods.get).route.stack.at(-1).handle;
  const tenantUsersFixture = model.fixture();
  tenantUsersFixture.users = [
    { id: 'active-user', username: 'active', role: 'customer', status: 'active', walletBalance: 0, createdAt: new Date().toISOString() },
    { id: 'banned-user', username: 'banned', role: 'customer', status: 'banned', walletBalance: 0, createdAt: new Date().toISOString() },
  ];
  let tenantUsersView;
  await als.run(tenantUsersFixture, () => usersList(
    { query: { status: 'banned', role: 'customer' }, tenantShop: { id: 'tenant-ui-fixture' } },
    { locals: {}, render(view, values) { tenantUsersView = { view, ...values }; } },
  ));
  check('Experimental member filters do not change the tenant legacy member list', () => {
    assert.equal(tenantUsersView.view, 'admin/users');
    assert.equal(tenantUsersView.users.length, 2);
  });
  const liveCatalog = admin.stack.find(layer => layer.route?.path === '/minigame/live-catalog' && layer.route.methods.get).route.stack.at(-1).handle;
  let tenantCatalogStatus = 0;
  await liveCatalog(
    { query: { ui: 'experiment' }, tenantShop: { id: 'tenant-ui-fixture' } },
    { sendStatus(status) { tenantCatalogStatus = status; } },
  );
  check('Tenant administrators cannot access the main-site live catalog preview', () => assert.equal(tenantCatalogStatus, 404));
  async function playImageFor(tenantShop) {
    const prize = { id: 'prize', name: 'รางวัลทดสอบ', gameType: 'box', image: '/configured-prize.png', isPrize: true, stock: null };
    const gameStore = {
      data: {
        settings: { miniGame: { boxEnabled: true, costPerPlay: 2 } },
        miniGamePrizes: [prize], products: [{ id: 'product', title: 'รางวัลทดสอบ', images: ['/catalog-product.png'] }],
        walletTransactions: [], miniGamePlays: [],
      },
      genId: () => 'fixture-id',
      async save() {},
    };
    const minigameRoutes = load('src/routes/minigame.js', {
      '../data/store': gameStore,
      '../middleware/auth': { currentUser: request => request.user },
      '../services/minigame': { pickPrize: () => prize, getPrizeImage: () => '/catalog-product.png' },
    });
    const play = minigameRoutes.stack.find(layer => layer.route?.path === '/play' && layer.route.methods.post).route.stack.at(-1).handle;
    let result;
    await play({ query: {}, tenantShop, user: { id: 'fixture-user', username: 'fixture', walletBalance: 20 } }, { json(value) { result = value; }, status() { return this; } });
    return result.image;
  }
  const tenantPlayImage = await playImageFor({ id: 'tenant-ui-fixture' });
  const mainPlayImage = await playImageFor(null);
  check('Tenant minigame rewards keep their configured image while main rewards may resolve catalog images', () => {
    assert.equal(tenantPlayImage, '/configured-prize.png');
    assert.equal(mainPlayImage, '/catalog-product.png');
  });
  const orderStatus = admin.stack.find(l => l.route?.path === '/orders/:id/status' && l.route.methods.post).route.stack.at(-1).handle;
  const orderStatusFixture = model.fixture();
  orderStatusFixture.orders = [{ id: 'order-status-fixture', status: 'pending', items: [] }];
  let invalidStatusFlash = '';
  await als.run(orderStatusFixture, () => orderStatus(
    { params: { id: 'order-status-fixture' }, body: { status: 'not-a-status' }, flash(type, message) { if (type === 'error') invalidStatusFlash = message; } },
    { redirect() {} },
  ));
  check('Admin order status rejects unknown values', () => {
    assert.equal(orderStatusFixture.orders[0].status, 'pending');
    assert.match(invalidStatusFlash, /สถานะคำสั่งซื้อไม่ถูกต้อง/);
  });
  const stockDelete = admin.stack.find(l => l.route?.path === '/products/:id/stock/:stockId/delete' && l.route.methods.post).route.stack.at(-1).handle;
  const stockDeleteFixture = model.fixture();
  stockDeleteFixture.products = [{ id: 'product-a', title: 'A' }, { id: 'product-b', title: 'B' }];
  stockDeleteFixture.stockItems = [{ id: 'stock-b', productId: 'product-b', status: 'available' }];
  let stockDeleteFlash = '';
  await als.run(stockDeleteFixture, () => stockDelete(
    { params: { id: 'product-a', stockId: 'stock-b' }, flash(type, message) { if (type === 'error') stockDeleteFlash = message; } },
    { redirect() {} },
  ));
  check('Admin stock deletion cannot remove another product’s stock', () => {
    assert.equal(stockDeleteFixture.stockItems.length, 1);
    assert.match(stockDeleteFlash, /ไม่พบไอดีในสต๊อก/);
  });
  const createUser = admin.stack.find(l => l.route?.path === '/users/new' && l.route.methods.post).route.stack.at(-1).handle;
  const createUserFixture = model.fixture();
  createUserFixture.users = [{ id: 'existing', username: 'existing', email: 'used@example.com', role: 'customer', status: 'active', walletBalance: 0 }];
  let duplicateEmailFlash = '';
  await als.run(createUserFixture, () => createUser(
    { body: { username: 'new-user', email: 'USED@EXAMPLE.COM', password: '123456' }, flash(type, message) { if (type === 'error') duplicateEmailFlash = message; } },
    { redirect() {} },
  ));
  check('Admin user creation rejects duplicate email addresses', () => {
    assert.equal(createUserFixture.users.length, 1);
    assert.match(duplicateEmailFlash, /อีเมลนี้ถูกใช้งานแล้ว/);
  });
  const missingPasswordFixture = model.fixture();
  missingPasswordFixture.users = [];
  let missingPasswordFlash = '';
  await als.run(missingPasswordFixture, () => createUser(
    { body: { username: 'new-user', email: 'new@example.com' }, flash(type, message) { if (type === 'error') missingPasswordFlash = message; } },
    { redirect() {} },
  ));
  check('Admin user creation requires a real password instead of silently assigning a default credential', () => {
    assert.equal(missingPasswordFixture.users.length, 0);
    assert.match(missingPasswordFlash, /อย่างน้อย 6 ตัวอักษร/);
  });
  const tenantPasswordFixture = model.fixture();
  tenantPasswordFixture.users = [];
  await als.run(tenantPasswordFixture, () => createUser(
    { body: { username: 'tenant-user', email: 'tenant@example.com' }, tenantShop: { id: 'tenant-fixture' }, flash() {} },
    { redirect() {} },
  ));
  check('Tenant member creation keeps its original password behavior unchanged', () => {
    assert.equal(tenantPasswordFixture.users.length, 1);
    assert.equal(typeof tenantPasswordFixture.users[0].passwordHash, 'string');
  });
  const createCoupon = admin.stack.find(l => l.route?.path === '/coupons' && l.route.methods.post).route.stack.at(-1).handle;
  const createCouponFixture = model.fixture();
  createCouponFixture.coupons = [{ id: 'existing', code: 'SALE10', type: 'percent', value: 10, usageLimit: 0, usedCount: 0, active: true }];
  let invalidCouponFlash = '';
  await als.run(createCouponFixture, () => createCoupon(
    { body: { code: 'sale10', type: 'percent', value: 'not-a-number', usageLimit: '' }, flash(type, message) { if (type === 'error') invalidCouponFlash = message; } },
    { redirect() {} },
  ));
  check('Admin coupon creation rejects invalid or duplicate coupons', () => {
    assert.equal(createCouponFixture.coupons.length, 1);
    assert.match(invalidCouponFlash, /ตรวจสอบรหัสคูปอง/);
  });
  const hubTest = admin.stack.find(l => l.route?.path === '/slip-verification/test' && l.route.methods.post).route.stack[0].handle;
  const saveProvider = admin.stack.find(l => l.route?.path === '/slip-verification' && l.route.methods.post).route.stack[0].handle;
  const legacyProviderData = model.fixture();
  legacyProviderData.settings.payment.slipProvider = 'auto';
  await als.run(legacyProviderData, () => saveProvider({
    body: { slipApiMode: 'own', slipProvider: 'slipcheck', slipcheckApiKey: 'check-saved', rdcwClientId: 'rdcw-id', rdcwClientSecret: 'rdcw-secret', slip2goApiKey: 's2g-saved' },
    tenantShop: null, flash() {},
  }, { redirect() {} }));
  check('SlipCheck provider settings save without EasySlip credentials', () => {
    const saved = legacyProviderData.settings.payment;
    assert.equal(saved.slipProvider, 'slipcheck');
    assert.equal(Object.hasOwn(saved, 'easyslipApiKey'), false);
    assert.equal(saved.slipcheckApiKey, 'check-saved');
    assert.equal(saved.rdcwClientSecret, 'rdcw-secret');
    assert.equal(saved.slip2goApiKey, 's2g-saved');
  });
  let testedProvider;
  await hubTest({ body: { provider: 'easyslip' }, tenantShop: { id: 'fixture' } }, { json(result) { testedProvider = result; } });
  check('Removed provider cannot be tested through the API route', () => assert.equal(testedProvider.message, 'ไม่พบผู้ให้บริการที่ระบุ'));
  const viewData = model.fixture(); model.migrateFixture(viewData);
  const ejs = require('ejs');
  const unifiedLayoutFile = path.join(root, 'src/views/layouts/admin-experiment.ejs');
  const unifiedLocals = { title: 'API สินค้าร้านหลัก', active: 'catalog-api', settings: viewData.settings,
    currentUser: viewData.users[0], pendingTopupCount: 0, asset: value => '/' + value, body: '<section>ข้อมูล API จริง</section>' };
  const legacyCompatibilityPage = ejs.render(fs.readFileSync(unifiedLayoutFile, 'utf8'), unifiedLocals, { filename: unifiedLayoutFile });
  check('Main legacy data pages are framed by one new sidebar without shop-theme colors', () => {
    assert.match(legacyCompatibilityPage, /class="experiment-app" data-experiment-framed-page/);
    assert.match(legacyCompatibilityPage, /class="experiment-legacy-content"/);
    assert.match(legacyCompatibilityPage, /css\/tailwind\.generated\.css/);
    assert.match(legacyCompatibilityPage, /admin-main-legacy-compat-v1\.css/);
    assert.match(legacyCompatibilityPage, /API สินค้าร้านหลัก/);
    assert.doesNotMatch(legacyCompatibilityPage, /id="admin-sidebar"/);
    assert.doesNotMatch(legacyCompatibilityPage, /themeCss/);
    const uploadScript = fs.readFileSync(path.join(root, 'public/js/admin-live-compat-v1.js'), 'utf8');
    new vm.Script(uploadScript, { filename: 'admin-live-compat-v1.js' });
    assert.match(uploadScript, /window\.lilteamDirectUploadFiles/);
    assert.match(uploadScript, /data-table-search/);
  });
  const widgetTemplate = fs.readFileSync(path.join(root, 'src/views/partials/minigame-widget.ejs'), 'utf8');
  const railTemplate = fs.readFileSync(path.join(root, 'src/views/partials/minigame-rail.ejs'), 'utf8');
  const widgetLegacy = ejs.render(widgetTemplate, { endpoint: '/minigame/play', cost: 5, ctaLabel: 'เปิดกล่อง', showLogin: false, balance: 20, mainSiteExperience: false });
  const widgetMain = ejs.render(widgetTemplate, { endpoint: '/minigame/play', cost: 5, ctaLabel: 'เปิดกล่อง', showLogin: false, balance: 20, mainSiteExperience: true });
  const railBase = { endpoint: '/minigame/play?mode=rail', cost: 5, prizes: [{ name: 'รางวัล', image: null, isPrize: true }], showLogin: false, balance: 20 };
  const railLegacy = ejs.render(railTemplate, { ...railBase, mainSiteExperience: false });
  const railMain = ejs.render(railTemplate, { ...railBase, mainSiteExperience: true });
  const widgetLegacyMarkup = widgetLegacy.split('<style>')[0];
  const widgetMainMarkup = widgetMain.split('<style>')[0];
  const railLegacyMarkup = railLegacy.split('<style>')[0];
  const railMainMarkup = railMain.split('<style>')[0];
  check('Storefront minigame redesign is rendered only for the main shop', () => {
    assert.match(widgetLegacyMarkup, /class="mg-box mg-box-el">🎁/);
    assert.doesNotMatch(widgetLegacyMarkup, /mg-box-scene-el|mg-result-gift/);
    assert.match(widgetMainMarkup, /mg-play-panel--main-site/);
    assert.match(widgetMainMarkup, /mg-box-scene-el|mg-result-gift/);
    assert.doesNotMatch(railLegacyMarkup, /rail-game--main-site|<svg viewBox="0 0 24 24"/);
    assert.match(railLegacyMarkup, /🎰 เริ่มเลื่อน/);
    assert.match(railMainMarkup, /rail-game--main-site/);
  });
  let pages = 0;
  for (const url of ['/', '/products', '/products/new', '/filter-tags', '/home-sections', '/scheduled-products', '/orders', '/users', '/topups', '/slip-verification', '/coupons', '/minigame', '/settings', '/appearance']) {
    const handler = admin.stack.find(l => l.route?.path === url && l.route.methods.get).route.stack.at(-1).handle;
    const req = { query: {}, params: {}, body: {}, tenantShop: { id: 'fixture' }, flash: () => [], session: {}, get: () => 'fixture.test', protocol: 'https' };
    if (url === '/slip-verification') req.tenantShop = null;
    const locals = { settings: viewData.settings, currentUser: viewData.users[0], messages: { success: [], error: [] },
      isMainSite: false, rentWebsiteEnabled: false, persistentStorageEnabled: false, pendingTopupCount: 0, currentRequestUrl: 'https://fixture.test', cartCount: 0,
      themeCss: '', layout: 'layouts/admin', asset: value => '/' + value };
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
  let experimentHomeSectionsView;
  const homeSectionsHandler = admin.stack.find(layer => layer.route?.path === '/home-sections' && layer.route.methods.get).route.stack.at(-1).handle;
  await als.run(viewData, () => homeSectionsHandler(
    { query: {}, tenantShop: null, flash: () => [] },
    { locals: { layout: 'layouts/admin', settings: viewData.settings, currentUser: viewData.users[0], asset: value => '/' + value }, render(view, values) { experimentHomeSectionsView = { view, values }; } },
  ));
  check('Main admin requests are not intercepted by the generic placeholder middleware', () => {
    assert.equal(admin.stack.some(layer => !layer.route && layer.handle.toString().includes('admin/experiment-placeholder')), false);
    assert.ok(admin.stack.some(layer => layer.route?.path === '/products/bulk-import'));
    assert.ok(admin.stack.some(layer => layer.route?.path === '/catalog-api'));
  });
  check('Main-shop home sections render the working production management page without a mode query', () => {
    assert.equal(experimentHomeSectionsView.view, 'admin/home-sections-experiment');
    assert.equal(experimentHomeSectionsView.values.homeSections, viewData.homeSections);
    const filename = path.join(root, 'src/views', experimentHomeSectionsView.view + '.ejs');
    const locals = { settings: viewData.settings, currentUser: viewData.users[0], messages: { success: [], error: [] }, isMainSite: true,
      rentWebsiteEnabled: false, persistentStorageEnabled: true, pendingTopupCount: 0, currentRequestUrl: 'https://fixture.test/admin/home-sections',
      cartCount: 0, themeCss: '', asset: value => '/' + value, ...experimentHomeSectionsView.values };
    const html = ejs.render(fs.readFileSync(filename, 'utf8'), locals, { filename });
    assert.match(html, /หมวดหมู่หน้าแรก/);
    assert.match(html, /data-hsx-open-create/);
    assert.match(html, /data-hsx-search/);
    assert.match(html, /admin\/home-sections\//);
    const layoutFile = path.join(root, 'src/views/layouts/admin-experiment.ejs');
    const page = ejs.render(fs.readFileSync(layoutFile, 'utf8'), { ...locals, body: html }, { filename: layoutFile });
    assert.match(page, /data-experiment-confirm-dialog/);
    assert.match(page, /จัดหมวดหมู่หน้าแรก/);
  });
  check('Tenant home sections remain on the legacy view even with an experiment query', () => {
    let tenantView;
    als.run(viewData, () => homeSectionsHandler(
      { query: { ui: 'experiment' }, tenantShop: { id: 'tenant-fixture' }, flash: () => [] },
      { locals: { layout: 'layouts/admin' }, render(view) { tenantView = view; } },
    ));
    assert.equal(tenantView, 'admin/home-sections');
  });
  const appearanceHandler = admin.stack.find(layer => layer.route?.path === '/appearance' && layer.route.methods.get).route.stack.at(-1).handle;
  let mainAppearanceView;
  await als.run(viewData, () => appearanceHandler(
    { query: {}, tenantShop: null, flash: () => [] },
    { locals: { layout: 'layouts/admin', settings: viewData.settings, currentUser: viewData.users[0], asset: value => '/' + value }, render(view, values) { mainAppearanceView = { view, values }; } },
  ));
  check('Main-shop appearance renders the redesigned real-media manager', () => {
    assert.equal(mainAppearanceView.view, 'admin/appearance-experiment');
    const filename = path.join(root, 'src/views', mainAppearanceView.view + '.ejs');
    const locals = { settings: viewData.settings, currentUser: viewData.users[0], messages: { success: [], error: [] }, isMainSite: true,
      rentWebsiteEnabled: false, persistentStorageEnabled: true, pendingTopupCount: 0, currentRequestUrl: 'https://fixture.test/admin/appearance',
      cartCount: 0, themeCss: '', asset: value => '/' + value, ...mainAppearanceView.values };
    const html = ejs.render(fs.readFileSync(filename, 'utf8'), locals, { filename });
    assert.match(html, /โลโก้เว็บไซต์/);
    assert.match(html, /แบนเนอร์หน้าหลัก/);
    assert.match(html, /ภาพพื้นหลังหน้าร้าน/);
    assert.match(html, /พื้นหลังหน้าเข้าสู่ระบบ/);
    assert.match(html, /site-logo\/upload/);
    assert.match(html, /hero-banner\/mode/);
    for (const [index, match] of Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).entries()) {
      new vm.Script(match[1], { filename: `${filename}#script-${index + 1}` });
    }
    const layoutFile = path.join(root, 'src/views/layouts/admin-experiment.ejs');
    const page = ejs.render(fs.readFileSync(layoutFile, 'utf8'), { ...locals, body: html }, { filename: layoutFile });
    assert.match(page, /data-experiment-confirm-dialog/);
    for (const [index, match] of Array.from(page.matchAll(/<script>([\s\S]*?)<\/script>/g)).entries()) {
      new vm.Script(match[1], { filename: `${layoutFile}#script-${index + 1}` });
    }
  });
  check('Tenant appearance remains on the original view', () => {
    let tenantView;
    appearanceHandler(
      { query: { ui: 'experiment' }, tenantShop: { id: 'tenant-fixture' } },
      { locals: { layout: 'layouts/admin' }, render(view) { tenantView = view; } },
    );
    assert.equal(tenantView, 'admin/appearance');
  });
  const rangersCatalogGuard = admin.stack.find(layer => layer.route?.path === '/rangers-catalog' && layer.route.methods.get).route.stack[0].handle;
  let rangersMainDenied = false;
  rangersCatalogGuard(
    { tenantShop: null },
    { status(code) { rangersMainDenied = code === 404; return this; }, render(view) { assert.equal(view, 'shop/404'); } },
    () => { rangersMainDenied = false; },
  );
  check('Main-shop requests still receive a 404 from the System Lab catalog guard', () => assert.equal(rangersMainDenied, true));
  const tenantViewData = model.fixture();
  tenantViewData.settings.payment.slipApiMode = 'shared';
  const tenantHub = admin.stack.find(l => l.route?.path === '/slip-verification' && l.route.methods.get).route.stack.at(-1).handle;
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
  check('Shared tenants only see the shared slip provider settings', () => assert.ok(true));
  const tenantTopups = admin.stack.find(l => l.route?.path === '/topups' && l.route.methods.get).route.stack.at(-1).handle;
  platformFixture.settings.payment.slipProvider = 'slipcheck';
  let sharedTopupView;
  await als.run(tenantViewData, () => tenantTopups(
     { query: { receiverProvider: 'slipcheck' }, tenantShop: { id: 'tenant-fixture' } },
    { render(view, values) { sharedTopupView = values; } },
  ));
  check('Shared tenant can edit only the provider selected by the platform', () => {
    assert.equal(JSON.stringify(sharedTopupView.availableReceiverProviders), JSON.stringify(['slipcheck']));
    assert.equal(sharedTopupView.activeReceiverProvider, 'slipcheck');
    assert.equal(sharedTopupView.receiverProvider, 'slipcheck');
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
    assert.equal(JSON.stringify(ownTopupView.availableReceiverProviders), JSON.stringify(['slipcheck', 'rdcw', 'slip2go', 'xepht']));
    assert.equal(ownTopupView.receiverProvider, 'slip2go');
  });
  check('Provider page initialization does not switch a shared tenant to own API mode', () => {
    const providerPage = fs.readFileSync(path.join(root, 'src/views/admin/slip-verification.ejs'), 'utf8');
    assert.match(providerPage, /selectOwnProvider\([^\n]+, false\);/);
    assert.doesNotMatch(providerPage, /EasySlip|easyslip|EASYSLIP/);
  });
  check('Automatic slip page explains the five-minute slip timestamp rule', () => {
    const topupDetail = fs.readFileSync(path.join(root, 'src/views/shop/topup-detail.ejs'), 'utf8');
    const accountSource = fs.readFileSync(path.join(root, 'src/routes/account.js'), 'utf8');
    assert.match(topupDetail, /ภายใน 5 นาทีล่าสุด/);
    assert.match(accountSource, /slipAge > 5 \* 60 \* 1000/);
  });
  check('Storefront background survives every storefront model', () => {
    const mainLayout = fs.readFileSync(path.join(root, 'src/views/layouts/main.ejs'), 'utf8');
    const marketView = fs.readFileSync(path.join(root, 'src/views/shop/home-rangers-market.ejs'), 'utf8');
    const lineRangersCss = fs.readFileSync(path.join(root, 'public/css/storefront-line-rangers-v1.css'), 'utf8');
    assert.match(mainLayout, /id="storefront-background-override"/);
    assert.match(mainLayout, /storefront-global-background #site-page-shell/);
    assert.match(mainLayout, /background-image: url\('<%= storefrontBackground %>'\)/);
    assert.ok(mainLayout.indexOf('id="storefront-background-override"') > mainLayout.indexOf('<%- body %>'));
    assert.match(marketView, /body\.storefront-model-rangers-market\s*\{/);
    assert.match(lineRangersCss, /body\.storefront-model-line-rangers\s*\{/);
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
