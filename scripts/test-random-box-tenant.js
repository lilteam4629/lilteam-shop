const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const tenantId = `box-smoke-${process.pid}`;
const tenantSlug = tenantId;
const testDbPath = path.join(os.tmpdir(), `lilteam-random-box-tenant-${process.pid}.json`);
const tenantDbPath = path.join(__dirname, '..', 'src', 'data', `db.shop.${tenantId}.json`);
process.env.NODE_ENV = 'test';
process.env.TEST_DB_PATH = testDbPath;
process.env.MONGODB_URI = '';
const store = require('../src/data/store');
const bcrypt = require('bcryptjs');

let child = null;
let output = '';
let baseUrl = '';
let tenantHost = '';

function request(requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath, baseUrl);
    const body = options.body || '';
    const headers = { host: tenantHost, ...(options.headers || {}) };
    if (body && headers['content-length'] === undefined) headers['content-length'] = Buffer.byteLength(body);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers,
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => { response.body = responseBody; resolve(response); });
    });
    req.setTimeout(options.timeout || 10000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function setupTenant() {
  store.reset();
  const shop = {
    id: tenantId,
    slug: tenantSlug,
    name: 'Random Box Tenant Smoke',
    ownerUsername: 'smoke-owner',
    expiresAt: Date.now() + 60 * 60 * 1000,
    createdAt: new Date().toISOString(),
  };
  store.platformData.shops ||= [];
  store.platformData.shops.push(shop);
  await store.save();

  const tenantDb = await store.createTenantDb(tenantId, {
    shopName: shop.name,
    adminUsername: 'boxadmin',
    adminEmail: 'boxadmin@tenant-smoke.local',
    adminPasswordHash: bcrypt.hashSync('boxadmin-password', 4),
  });
  tenantDb.users.push({
    id: 'box-smoke-buyer',
    username: 'boxbuyer',
    email: 'boxbuyer@tenant-smoke.local',
    passwordHash: bcrypt.hashSync('boxbuyer-password', 4),
    role: 'customer',
    walletBalance: 1000,
    status: 'active',
    createdAt: new Date().toISOString(),
  });
  await store.runInTenant(tenantId, tenantDb, () => store.save());
}

async function login(username, password) {
  const response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }).toString(),
  });
  const cookie = (response.headers['set-cookie'] || [])[0];
  assert.equal(response.statusCode, 302, `${username} login should redirect after authentication`);
  assert.ok(cookie, `${username} login should create a session cookie`);
  return cookie.split(';')[0];
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${output}`);
    try {
      const response = await request('/health');
      if (response.statusCode === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`server did not become ready: ${output}`);
}

async function exerciseTenantRandomBox() {
  const adminCookie = await login('boxadmin', 'boxadmin-password');
  const form = await request('/admin/products/new', { headers: { cookie: adminCookie } });
  assert.equal(form.statusCode, 200, 'rental admin can open the product form');
  assert.ok(form.body.includes('รอทำระบบเพิ่ม'));
  assert.ok(form.body.includes('disabled>เรท 2'));
  const invalid = await request('/admin/products/new', { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ title: 'invalid-box', productKind: 'random-box', randomBoxRate: '2', price: '2' }).toString() });
  assert.equal(invalid.statusCode, 302);
  assert.ok(!JSON.parse(fs.readFileSync(tenantDbPath, 'utf8')).products.some(p => p.title === 'invalid-box'));
  for (const control of ['name="productKind"', 'name="randomBoxRate"', 'random-box-product-fields-v1.css']) {
    assert.ok(form.body.includes(control), `rental product form exposes ${control}`);
  }

  const title = `tenant-random-box-${process.pid}`;
  const created = await request('/admin/products/new', {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, productKind: 'random-box', randomBoxRate: '1', price: '1' }).toString(),
  });
  assert.equal(created.statusCode, 302, 'rental admin can create a random-box product');
  const tenantDataPath = tenantDbPath;
  let tenantData = JSON.parse(fs.readFileSync(tenantDataPath, 'utf8'));
  let product = tenantData.products.find(item => item.title === title);
  assert.ok(product, 'created product is saved in the tenant database');
  const productId = product.id;
  assert.equal(product?.specialType, 'random-box', 'product type is saved in this tenant database');
  assert.equal(product?.price, 1);
  assert.equal(product?.randomBox?.rate, 1);
  const tamperedPrice = await request(`/admin/products/${encodeURIComponent(productId)}/price`, { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'price=2' });
  assert.equal(tamperedPrice.statusCode, 400);

  const stockResponse = await request(`/admin/products/${encodeURIComponent(productId)}/stock/add`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ bulk: 'Tenant Prize One:secret-one\nTenant Prize Two:secret-two\nTenant Prize Three:secret-three' }).toString(),
  });
  assert.equal(stockResponse.statusCode, 302, 'rental admin can add prizes to its local stock');
  const stockPage = await request(`/admin/products/${encodeURIComponent(productId)}/stock`, { headers: { cookie: adminCookie } });
  assert.equal(stockPage.statusCode, 200, 'rental admin can view the random-box stock manager');

  const publishResponse = await request('/admin/scheduled-products', {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ productId, publishAt: '2020-01-01T00:00' }).toString(),
  });
  assert.equal(publishResponse.statusCode, 302, 'rental admin can publish the random-box product');

  tenantData = JSON.parse(fs.readFileSync(tenantDataPath, 'utf8'));
  product = tenantData.products.find(item => String(item.id) === productId);
  const buyerCookie = await login('boxbuyer', 'boxbuyer-password');
  const page = await request(`/game/${encodeURIComponent(product.slug)}`, { headers: { cookie: buyerCookie } });
  assert.equal(page.statusCode, 200, 'rental storefront displays its own random-box product');
  assert.ok(page.body.includes('id="random-box-draw-count"'), 'rental customer can choose how many draws to buy');
  const home = await request('/');
  assert.equal(home.statusCode, 200, 'rental storefront home loads');
  assert.ok(home.body.includes(title), 'rental storefront home lists its random-box product');

  const requestId = crypto.randomUUID();
  const draw = await request(`/random-box/${encodeURIComponent(productId)}/draw`, {
    method: 'POST',
    headers: { cookie: buyerCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ drawRequestId: requestId, drawCount: '110' }).toString(),
  });
  assert.equal(draw.statusCode, 302, 'rental customer can draw from the box');

  tenantData = JSON.parse(fs.readFileSync(tenantDataPath, 'utf8'));
  const storedOrder = tenantData.orders.find(item => item.id === decodeURIComponent(draw.headers.location.split('/').pop()));
  const order = require('../src/services/store-order-codec').decodeStoreSnapshot({ orders: [storedOrder] }).orders[0];
  assert.ok(order?.randomBoxOrder, 'draw order is stored in this tenant database');
  assert.ok(order.items.some(item => item.randomBoxDraw), 'draw result is stored with its order');
  assert.ok(tenantData.stockItems.every(item => item.productId === productId), 'the tenant only touched its own prize stock');

  const platformData = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  assert.ok(!platformData.products.some(item => item.title === title), 'rental product never appears in the platform catalog');
  assert.ok(!platformData.orders.some(item => item.randomBoxOrder), 'rental draws never alter platform order history');
  assert.ok(!platformData.stockItems.some(item => item.productId === productId), 'rental prize stock never enters platform inventory');
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 2500);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill('SIGTERM');
  });
}

(async () => {
  try {
    await setupTenant();
    const port = await unusedPort();
    baseUrl = `http://127.0.0.1:${port}`;
    tenantHost = `${tenantSlug}.localhost:${port}`;
    child = spawn(process.execPath, ['src/app.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        TEST_DB_PATH: testDbPath,
        MONGODB_URI: '',
        MAIN_DOMAIN: 'localhost',
        DISCORD_BOT_TOKEN: '',
        LICENSE_GATE: 'off',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    await waitForServer();
    await exerciseTenantRandomBox();
    console.log('Random-box rental workflow passed: admin setup, tenant stock, storefront draw, and tenant data isolation');
  } catch (error) {
    console.error(`${error.message}\n${output}`);
    process.exitCode = 1;
  } finally {
    await stopServer();
    try { fs.unlinkSync(testDbPath); } catch (_) {}
    try { fs.unlinkSync(tenantDbPath); } catch (_) {}
  }
})();
