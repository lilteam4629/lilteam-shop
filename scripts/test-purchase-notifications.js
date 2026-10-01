const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const axios = require('axios');
const notifications = require('../src/services/purchase-notifications');
const now = new Date().toISOString();
const url = 'https://discord.com/api/webhooks/123/test-token';
function fixture(name, webhookUrl = url) {
  return {
    settings: { shopName: name, purchaseNotifications: { webhookUrl } },
    users: [{ id: 'buyer', username: 'private-buyer', walletBalance: 100, catalogWalletBalance: 100 }],
    products: [{ id: 'product', title: 'Account', status: 'active', price: 10 }],
    stockItems: [{ id: 'stock', productId: 'product', status: 'available', credentials: 'SECRET' }],
    orders: [], walletTransactions: [], coupons: [],
  };
}
const order = { id: 'sale', userId: 'buyer', status: 'pending', items: [{ title: 'Account', password: 'SECRET' }], total: 10, createdAt: now };
async function run() {
  const posts = [];
  const originalPost = axios.post;
  axios.post = async (...args) => { posts.push(args); };
  try {
    const main = fixture('Main');
    main.orders.push(order, { ...order, id: 'cancelled', status: 'cancelled' },
      { ...order, id: 'shadow', salesChannel: 'catalog-api-fulfillment' },
      { ...order, id: 'old', createdAt: '2000-01-01T00:00:00Z' });
    const publicData = notifications.recentPurchases(main);
    assert.equal(publicData.length, 1);
    assert.equal(publicData[0].buyer, 'pr***');
    assert.doesNotMatch(JSON.stringify(publicData), /SECRET|private-buyer|userId|password/);
    main.settings.purchaseNotifications.storefrontEnabled = false;
    assert.deepEqual(notifications.recentPurchases(main), []);
    for (const invalid of ['http://discord.com/api/webhooks/123/token', 'https://localhost/api/webhooks/123/token',
      'https://discord.com.evil.com/api/webhooks/123/token', 'https://discord.com/api/users', 'https://user:pass@discord.com/api/webhooks/123/token']) {
      assert.equal(notifications.isPurchaseWebhookUrl(invalid), false, invalid);
    }
    await notifications.notifyPurchase({ data: main, order, user: main.users[0] });
    assert.equal(posts.length, 1);
    assert.doesNotMatch(JSON.stringify(posts), /SECRET|password/);
    assert.equal(posts[0][2].maxRedirects, 0);
    axios.post = async () => { throw new Error('private-webhook-token'); };
    await notifications.notifyPurchase({ data: main, order, user: main.users[0] });
    axios.post = async (...args) => { posts.push(args); };

    // Exercise the real checkout handlers with an isolated in-memory store.
    async function checkout({ tenant = false, localTenant = false, balance = 100, failSave = false } = {}) {
      posts.length = 0;
      const platform = fixture('Main', 'https://discord.com/api/webhooks/123/main-token');
      const shop = tenant || localTenant ? fixture('Tenant', 'https://discord.com/api/webhooks/456/tenant-token') : platform;
      shop.users[0].walletBalance = balance;
      shop.users[0].catalogWalletBalance = balance;
      let active = shop, sequence = 0;
      const mockStore = {
        get data() { return active; }, platformData: platform,
        genId: () => `id-${++sequence}`,
        save: async () => { if (failSave) throw new Error('save failed'); },
        transact: async fn => fn(active),
        runOnPlatform: async fn => { const previous = active; active = platform; try { return await fn(); } finally { active = previous; } },
        loadTenantDb: async () => shop,
      };
      const handlers = {};
      const router = { post: (route, ...args) => { handlers[route] = args.at(-1); }, get: () => {} };
      const mocks = {
        express: { Router: () => router },
        '../services/random-box': { RANDOM_BOX_KIND: 'random-box' },
        '../services/checkout-queue': { runWithCheckoutQueue: fn => Promise.resolve().then(fn) },
        '../services/promotions': { settleReferral: () => {} }, '../data/store': mockStore,
        '../middleware/auth': { requireLogin: () => {}, currentUser: req => req.user },
        '../services/pricing': { withEffectivePrice: product => product },
        '../services/catalog-syndication': { findTenantProduct: () => ({ ...platform.products[0], stockCount: 1, sourceProductId: 'product' }) },
        '../middleware/tenant': { MAIN_SITE_URL: 'https://main.example' },
        '../services/purchase-notifications': notifications,
      };
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/cart.js'), 'utf8'),
        { require: name => { assert.ok(mocks[name], name); return mocks[name]; }, module: { exports: {} }, console });
      const req = {
        user: shop.users[0], tenantShop: tenant || localTenant ? { id: 'tenant', name: 'Tenant' } : null,
        session: { cart: [{ productId: 'product', qty: 1, ...(tenant ? { sourceProductId: 'product', sourcePrice: 10, federatedTenantId: 'tenant' } : {}) }] },
        flash: () => {}, protocol: 'https', get: () => 'shop.example',
      };
      let redirect;
      await handlers['/checkout'](req, { redirect: value => { redirect = value; } });
      await new Promise(resolve => setImmediate(resolve));
      return { redirect, shop, platform };
    }
    let result = await checkout();
    assert.match(result.redirect, /^\/account\/orders\//);
    assert.equal(posts.length, 1);
    assert.equal(result.shop.users[0].walletBalance, 90);
    result = await checkout({ localTenant: true });
    assert.equal(posts.length, 1, 'local tenant products notify only that tenant');
    assert.equal(posts[0][0], 'https://discord.com/api/webhooks/456/tenant-token');
    assert.equal(result.platform.orders.length, 0);
    result = await checkout({ tenant: true });
    assert.match(result.redirect, /^\/account\/orders\//);
    assert.equal(posts.length, 2, 'tenant purchase notifies its store and fulfillment store');
    assert.deepEqual(posts.map(post => post[0]), ['https://discord.com/api/webhooks/456/tenant-token', 'https://discord.com/api/webhooks/123/main-token']);
    assert.equal(notifications.recentPurchases(result.platform).length, 0, 'no duplicate shadow sale on storefront');
    assert.equal(notifications.recentPurchases(result.shop).length, 1);
    await checkout({ balance: 0 });
    assert.equal(posts.length, 0, 'insufficient funds must not notify');
    await checkout({ failSave: true });
    assert.equal(posts.length, 0, 'failed persistence must not notify');
    let drawHandler;
    const boxData = fixture('Box shop');
    boxData.orders.push(order);
    let replay = false;
    const boxMocks = {
      crypto: { randomInt: () => 0 },
      express: { Router: () => ({ post: (_route, ...handlers) => { drawHandler = handlers.at(-1); } }) },
      '../data/store': { data: boxData, genId: () => 'draw', transact: async fn => fn(boxData) },
      '../middleware/auth': { requireLogin: () => {}, currentUser: () => boxData.users[0] },
      '../services/random-box': { supportsRandomBox: () => true, drawRandomBox: () => ({ orderId: order.id, replay, result: { total: 10 } }), configuredPrice: () => 10 },
      '../services/checkout-queue': { runWithCheckoutQueue: fn => fn() },
      '../services/promotions': { settleReferral: () => {} },
      '../services/purchase-notifications': notifications,
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/random-box.js'), 'utf8'),
      { require: name => { assert.ok(boxMocks[name], name); return boxMocks[name]; }, module: { exports: {} }, console });
    const drawReq = { params: { productId: 'product' }, body: { drawRequestId: 'valid-request-id-123' }, flash: () => {} };
    posts.length = 0;
    await drawHandler(drawReq, { redirect: () => {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(posts.length, 1, 'paid random box draw notifies');
    replay = true;
    await drawHandler(drawReq, { redirect: () => {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(posts.length, 1, 'replayed draw must not notify twice');
    const template = path.join(__dirname, '../src/views/partials/purchase-notification-settings.ejs');
    const html = await ejs.renderFile(template, { purchaseNotificationSettings: { storefrontEnabled: false, webhookUrl: url } });
    assert.match(html, /action="\/admin\/products\/notifications"/);
    assert.doesNotMatch(html, /name="purchaseStorefrontEnabled" checked/);
    console.log('Purchase notification checks passed: privacy, settings, safe webhook, checkout success/failure, tenant and platform routing.');
  } finally { axios.post = originalPost; }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
