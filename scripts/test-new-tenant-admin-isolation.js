const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');
const id = `empty-admin-${process.pid}`;
const dbPath = path.join(os.tmpdir(), `${id}.json`);
const tenantPath = path.join(root, 'src/data', `db.shop.${id}.json`);
const sessions = path.join(os.tmpdir(), `${id}-sessions`);
const port = 33000 + process.pid % 1000;
Object.assign(process.env, { NODE_ENV: 'test', TEST_DB_PATH: dbPath, MONGODB_URI: '' });
const store = require('../src/data/store');
let child;
let output = '';
function request(url, { cookie = '', body = '', method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method,
      headers: { host: `fixture.localhost:${port}`, cookie,
        'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } }, res => {
      let html = ''; res.setEncoding('utf8'); res.on('data', chunk => html += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, html }));
    });
    req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('request timeout')));
    req.end(body);
  });
}
(async () => {
  try {
    await store.init();
    store.platformData.settings.shopName = 'PLATFORM_PRIVATE_BRAND';
    store.platformData.settings.branding.logoImage = '/PLATFORM_PRIVATE_LOGO.png';
    store.platformData.settings.music = { enabled: true, youtubeUrl: 'PLATFORM_PRIVATE_MUSIC', defaultVolume: 50 };
    for (const field of ['slipokApiKey', 'slip2goApiKey', 'slipcheckApiKey', 'rdcwClientSecret', 'xephtApiKey']) store.platformData.settings.payment[field] = 'PLATFORM_PRIVATE_SECRET';
    store.platformData.settings.payment.bankAccountNumber = 'PLATFORM_PRIVATE_BANK';
    store.platformData.products[0].title = 'PLATFORM_PRIVATE_PRODUCT';
    store.platformData.users[0].username = 'PLATFORM_PRIVATE_ADMIN';
    store.platformData.announcements[0].title = 'PLATFORM_PRIVATE_NEWS';
    const tenant = await store.createTenantDb(id, { shopName: 'Fresh Rental Fixture', adminUsername: 'fresh-owner',
      adminEmail: 'fresh@example.test', adminPasswordHash: await bcrypt.hash('fixture-password', 10) });
    for (const [key, value] of Object.entries(tenant)) {
      if (Array.isArray(value) && key !== 'users') assert.deepEqual(value, [], `${key} must start empty`);
    }
    assert.equal(tenant.users.length, 1);
    assert.equal(tenant.users[0].username, 'fresh-owner');
    assert.equal(tenant.users[0].walletBalance, 0);
    assert.doesNotMatch(JSON.stringify(tenant), /PLATFORM_PRIVATE_|lilteamshop|admin@lilteam|demo@lilteam|WELCOME10/);
    store.platformData.shops.push({ id, slug: 'fixture', name: 'Fresh Rental Fixture', expiresAt: Date.now() + 86400000 });
    await store.save();
    child = spawn(process.execPath, ['src/app.js'], { cwd: root,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MAIN_DOMAIN: 'localhost', MAIN_SITE_URL: '',
        SESSION_DIR: sessions, SESSION_SECRET: 'isolated-fixture-session-secret-for-regression',
        DISCORD_BOT_TOKEN: '', LICENSE_GATE: 'off', RUN_STARTUP_TENANT_ROLLOUTS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    for (let i = 0; i < 100; i++) {
      if (output.includes('running at')) break;
      if (child.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const login = await request('/login', { method: 'POST', body: 'username=fresh-owner&password=fixture-password' });
    assert.equal(login.status, 302, login.html);
    const cookie = (login.headers['set-cookie'] || [])[0]?.split(';')[0];
    assert.ok(cookie, 'owner session established');
    const routes = ['/admin', '/admin/products', '/admin/products/new', '/admin/filter-tags',
      '/admin/home-sections', '/admin/recommended-categories', '/admin/orders', '/admin/users',
      '/admin/topups', '/admin/topups/settings', '/admin/slip-verification', '/admin/coupons',
      '/admin/promotions', '/admin/minigame', '/admin/announcements', '/admin/welcome-popup',
      '/admin/settings', '/admin/effects', '/admin/appearance', '/admin/theme', '/admin/catalog-api'];
    for (const route of routes) {
      const result = await request(route, { cookie });
      assert.equal(result.status, 200, `${route}: ${result.status} ${result.html.slice(0, 250)}`);
      assert.doesNotMatch(result.html, /PLATFORM_PRIVATE_|admin@lilteam|demo@lilteam|WELCOME10/, `${route}: main content leaked`);
      assert.doesNotMatch(result.html, /href="(?:https?:\/\/)?(?:m\.me|facebook\.com)\/lilteamshop/, `${route}: main contact leaked`);
      console.log('PASS empty tenant admin', route);
    }
    const forbidden = await request('/admin/minigame/live-catalog', { cookie });
    assert.equal(forbidden.status, 404, 'main-only source catalog is denied');
    const add = await request('/admin/announcements', { cookie, method: 'POST', body: 'title=TENANT_OWN_NEWS&body=Own+content' });
    assert.equal(add.status, 302);
    const ownNews = await request('/admin/announcements', { cookie });
    assert.match(ownNews.html, /TENANT_OWN_NEWS/);
    assert.equal(JSON.parse(fs.readFileSync(dbPath, 'utf8')).announcements[0].title, 'PLATFORM_PRIVATE_NEWS');
    console.log('PASS own content create/read persists only in tenant; main catalog access denied');
    // A deliberate opt-in may use the public Partner catalog without copying it to tenant storage.
    const enable = await request('/admin/catalog-api/settings', { cookie, method: 'POST', body: 'enabled=on&markupMode=percent&markupValue=0' });
    assert.equal(enable.status, 302);
    assert.match((await request('/admin/catalog-api', { cookie })).html, /PLATFORM_PRIVATE_PRODUCT/);
    const persisted = JSON.parse(fs.readFileSync(tenantPath, 'utf8'));
    assert.deepEqual(persisted.products, []);
    assert.equal(persisted.users.length, 1);
    assert.equal(persisted.users[0].username, 'fresh-owner');
    assert.equal(persisted.settings.payment.bankAccountNumber, '');
    assert.doesNotMatch(JSON.stringify(persisted), /PLATFORM_PRIVATE_/);
    console.log('PASS public Partner catalog requires opt-in and does not copy main records or secrets');
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    for (const file of [dbPath, tenantPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
    if (fs.existsSync(sessions)) fs.rmSync(sessions, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); if (output.includes('Error')) console.error(output.slice(-3000)); process.exitCode = 1; });
