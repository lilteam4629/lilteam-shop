const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const port = 3199;
const baseUrl = `http://127.0.0.1:${port}`;
const testDbPath = path.join(os.tmpdir(), `lilteam-smoke-${process.pid}.json`);
const child = spawn(process.execPath, ['src/app.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', TEST_DB_PATH: testDbPath, MONGODB_URI: '', DISCORD_BOT_TOKEN: '', LICENSE_GATE: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const crypto = require('crypto');
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanup = () => { child.kill('SIGTERM'); try { fs.unlinkSync(testDbPath); } catch (_) {} };

function request(requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath, baseUrl);
    const body = options.body || '';
    const headers = { ...(options.headers || {}) };
    if (body && headers['content-length'] === undefined) headers['content-length'] = Buffer.byteLength(body);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: options.method || 'GET', headers }, response => {
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

async function fetchOk(requestPath, expectedType, headers = {}) {
  const response = await request(requestPath, { headers });
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`${requestPath} returned HTTP ${response.statusCode}`);
  const type = response.headers['content-type'] || '';
  if (!type.includes(expectedType)) throw new Error(`${requestPath} returned ${type || 'no content type'}`);
  return response;
}

async function loginAsAdmin() {
  const body = 'username=admin&password=admin1234';
  const response = await request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const cookie = (response.headers['set-cookie'] || [])[0];
  if (response.statusCode !== 302 || !cookie) throw new Error(`admin login returned HTTP ${response.statusCode}`);
  return cookie.split(';')[0];
}

async function checkRecommendedCategoryHomepage(cookie) {
  const initialData = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const orderedProductIds = new Set((initialData.orders || []).flatMap(order => (order.items || []).map(item => String(item.productId))));
  const product = (initialData.products || []).find(item => item.status === 'active' && item.slug && !orderedProductIds.has(String(item.id)));
  if (!product) throw new Error('recommended category smoke test has no active product fixture');

  const title = `recommended-home-smoke-${process.pid}`;
  const created = await request('/admin/recommended-categories', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, imageUrl: 'https://example.test/category.png' }).toString(),
  });
  if (created.statusCode !== 302) throw new Error('recommended category could not be created for the homepage visibility check');

  const createdData = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const category = (createdData.recommendedCategories || []).find(item => item.title === title);
  if (!category) throw new Error('recommended category was not persisted');
  const selection = new URLSearchParams();
  selection.append('productIds', String(product.id));
  const saved = await request(`/admin/recommended-categories/${encodeURIComponent(category.id)}/products`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: selection.toString(),
  });
  if (saved.statusCode !== 302) throw new Error('product assignment to a recommended category failed');

  const home = await fetchOk('/', 'text/html');
  if (home.body.includes(`/game/${product.slug}`)) throw new Error('a categorized product still appears in the main homepage shelves');
  if (!home.body.includes(`/products?recommended=${encodeURIComponent(category.id)}`)) throw new Error('homepage category card does not lead to its selected product list');
  const categoryPage = await fetchOk(`/products?recommended=${encodeURIComponent(category.id)}`, 'text/html');
  if (!categoryPage.body.includes(`/game/${product.slug}`)) throw new Error('selected product is missing from its recommended category page');

  const disabled = await request(`/admin/recommended-categories/${encodeURIComponent(category.id)}/toggle`, { method: 'POST', headers: { cookie } });
  if (disabled.statusCode !== 302) throw new Error('recommended category could not be disabled for the fallback check');
  const homeAfterDisable = await fetchOk('/', 'text/html');
  if (!homeAfterDisable.body.includes(`/game/${product.slug}`)) throw new Error('a product in a hidden category did not return to the homepage catalog');
}

async function checkMusicAcrossStorefront(cookie) {
  const saved = await request('/admin/music-player', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      enabled: 'on',
      youtubeUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
      defaultVolume: '38',
      startTime: '1:15',
      endTime: '2:30',
    }).toString(),
  });
  if (saved.statusCode !== 302) throw new Error('valid background music settings could not be saved');
  const effects = await fetchOk('/admin/effects', 'text/html', { cookie });
  for (const value of ['https://www.youtube.com/watch?v=abcdefghijk', 'value="1:15"', 'value="2:30"', 'value="38"']) {
    if (!effects.body.includes(value)) throw new Error(`music settings page did not show the saved value ${value}`);
  }

  const pages = [
    '/', '/products', '/search?q=music', '/game/shadow-realm-chronicles',
    '/cart', '/help', '/contact', '/cookie-policy', '/login', '/register',
  ];
  for (const page of pages) {
    const response = await fetchOk(page, 'text/html');
    const widgets = response.body.match(/id="music-widget"/g) || [];
    if (widgets.length !== 1) throw new Error(`${page} should render exactly one persistent music widget, got ${widgets.length}`);
    if (!response.body.includes('data-video-id="abcdefghijk"')) throw new Error(`${page} rendered a different configured music track`);
    if (!response.body.includes('/css/storefront-music-unified-v1.css')) throw new Error(`${page} is missing the owner storefront music skin`);
  }
  for (const page of ['/game/smoke-product-that-does-not-exist', '/definitely-missing']) {
    const response = await request(page);
    if (response.statusCode !== 404) throw new Error(`${page} returned HTTP ${response.statusCode} instead of 404`);
    const widgets = response.body.match(/id="music-widget"/g) || [];
    if (widgets.length !== 1 || !response.body.includes('data-video-id="abcdefghijk"')) {
      throw new Error(`${page} is missing the configured persistent music widget`);
    }
    if (!response.body.includes('/css/storefront-music-unified-v1.css')) throw new Error(`${page} is missing the owner storefront music skin`);
  }

  const savedSettings = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).settings.music;
  if (savedSettings.startSeconds !== 75 || savedSettings.endSeconds !== 150 || savedSettings.defaultVolume !== 38) {
    throw new Error('music settings were not stored consistently');
  }

  const invalid = await request('/admin/music-player', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      enabled: 'on',
      youtubeUrl: 'https://www.youtube.com/watch?v=lmnopqrstuv',
      defaultVolume: '40',
      startTime: '1:99',
      endTime: '3:00',
    }).toString(),
  });
  if (invalid.statusCode !== 302) throw new Error('malformed music times did not return through validation');
  const afterInvalidSave = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).settings.music;
  if (afterInvalidSave.youtubeUrl !== savedSettings.youtubeUrl || afterInvalidSave.startSeconds !== 75) {
    throw new Error('invalid music time input overwrote the last valid settings');
  }
}

async function checkScheduledProductWorkflow(cookie) {
  const form = await fetchOk('/admin/products/new', 'text/html', { cookie });
  if (/name="(?:publishAt|eventBadge|eventDescription)"/.test(form.body)) {
    throw new Error('product form still exposes the scheduled-sale controls');
  }
  if (!form.body.includes('href="/admin/scheduled-products"') || !form.body.includes('กำหนดวันและเวลาเปิดขายได้ที่เมนู')) {
    throw new Error('product form does not direct the admin to the scheduled-sales menu');
  }

  const created = await request('/admin/products/new', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title: 'schedule-workflow-smoke', price: '19' }).toString(),
  });
  const match = created.headers.location?.match(/^\/admin\/scheduled-products\?productId=([^#]+)#schedule-product$/);
  if (created.statusCode !== 302 || !match) throw new Error('new product did not lead to its scheduled-sales entry');
  const productId = decodeURIComponent(match[1]);

  const schedulePage = await fetchOk(`/admin/scheduled-products?productId=${encodeURIComponent(productId)}`, 'text/html', { cookie });
  if (!new RegExp(`<option value="${productId}" selected>schedule-workflow-smoke · ซ่อนอยู่</option>`).test(schedulePage.body)) {
    throw new Error('new product was not preselected in the scheduled-sales page');
  }
  if (!schedulePage.body.includes('name="publishAt"') || !schedulePage.body.includes('action="/admin/scheduled-products"')) {
    throw new Error('scheduled-sales page does not expose its queue form');
  }

  const badDate = await request('/admin/scheduled-products', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ productId, publishAt: '2099-02-30T20:00' }).toString(),
  });
  if (badDate.statusCode !== 302 || !badDate.headers.location.includes(`productId=${encodeURIComponent(productId)}`)) {
    throw new Error('invalid scheduled-sale date was not rejected');
  }

  const scheduled = await request('/admin/scheduled-products', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ productId, publishAt: '2099-12-31T20:00', eventBadge: 'SMOKE', eventDescription: 'workflow check' }).toString(),
  });
  if (scheduled.statusCode !== 302 || scheduled.headers.location !== '/admin/scheduled-products') throw new Error('product could not be added to the scheduled-sales queue');
  let queued = await fetchOk('/admin/scheduled-products', 'text/html', { cookie });
  if (!queued.body.includes('schedule-workflow-smoke') || !queued.body.includes('SMOKE')) throw new Error('scheduled product details were not saved');

  const updated = await request(`/admin/scheduled-products/${encodeURIComponent(productId)}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ publishAt: '2099-12-31T21:00', eventBadge: 'UPDATED', eventDescription: 'updated workflow check' }).toString(),
  });
  if (updated.statusCode !== 302) throw new Error('scheduled-sale edit did not save');
  queued = await fetchOk('/admin/scheduled-products', 'text/html', { cookie });
  if (!queued.body.includes('UPDATED')) throw new Error('scheduled-sale edit was not reflected');

  const cleared = await request(`/admin/scheduled-products/${encodeURIComponent(productId)}/clear`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (cleared.statusCode !== 302) throw new Error('scheduled-sale clearing failed');
  const deleted = await request(`/admin/products/${encodeURIComponent(productId)}/delete`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (deleted.statusCode !== 302) throw new Error('scheduled workflow smoke product cleanup failed');
}

async function checkRandomBoxWorkflow(adminCookie) {
  const form = await fetchOk('/admin/products/new', 'text/html', { cookie: adminCookie });
  if (!form.body.includes('name="productKind"') || !form.body.includes('name="randomBoxRate"')
    || !form.body.includes('min="1"') || !form.body.includes('max="10"')
    || !form.body.includes('admin-random-box-product-fields-v1.css')) {
    throw new Error('random-box setup form is missing editable rate and price controls');
  }
  const title = 'random-box-smoke-' + process.pid;
  const created = await request('/admin/products/new', {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, productKind: 'random-box', randomBoxRate: '10', price: '2' }).toString(),
  });
  const productId = decodeURIComponent(created.headers.location?.match(/[?&]productId=([^&#]+)/)?.[1] || '');
  if (created.statusCode !== 302 || !productId) throw new Error('random-box product could not be created');
  let data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  let product = data.products.find(item => item.id === productId);
  if (product?.specialType !== 'random-box' || product.price !== 2 || product.randomBox.rate !== 10
    || Object.prototype.hasOwnProperty.call(product.randomBox, 'prizes')) {
    throw new Error('editable random-box settings were not saved');
  }

  const priceChange = await request('/admin/products/' + encodeURIComponent(productId) + '/price', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'price=3',
  });
  if (priceChange.statusCode !== 200 || !priceChange.body.includes('"price":3')) throw new Error('random-box price could not be edited');
  await request('/admin/products/' + encodeURIComponent(productId) + '/price', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'price=2',
  });

  const addStock = await request('/admin/products/' + encodeURIComponent(productId) + '/stock/add', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ bulk: 'George Best:private-prize-secret-1\nCarlos Puyol:private-prize-secret-2\nREMOVE ITEM:private-prize-secret-removed\nDELETE RESERVED:private-prize-secret-reserved' }).toString(),
  });
  if (addStock.statusCode !== 302) throw new Error('direct unpriced prize keys could not be added');
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const removable = data.stockItems.find(item => item.productId === productId && item.username === 'REMOVE ITEM');
  if (!removable || data.stockItems.filter(item => item.productId === productId && item.status === 'available').length !== 4
    || data.stockItems.some(item => item.productId === productId && Object.prototype.hasOwnProperty.call(item, 'prizeValue'))) {
    throw new Error('each direct stock line was not saved as one prize without a value');
  }
  const deleted = await request('/admin/products/' + encodeURIComponent(productId) + '/stock/' + encodeURIComponent(removable.id) + '/delete', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (deleted.statusCode !== 302) throw new Error('unused prize could not be removed');
  const appended = await request('/admin/products/' + encodeURIComponent(productId) + '/stock/add', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ bulk: 'Sergio Aguero:private-prize-secret-3' }).toString(),
  });
  if (appended.statusCode !== 302) throw new Error('new prize could not be appended');

  const adminStock = await fetchOk('/admin/products/' + encodeURIComponent(productId) + '/stock', 'text/html', { cookie: adminCookie });
  if (!adminStock.body.includes('รายการรางวัลในรอบและที่พร้อมเริ่ม (4)')
    || !adminStock.body.includes('/stock/delete-all') || !adminStock.body.includes('ลบทั้งหมด')
    || adminStock.body.includes('randomBoxPrizeValue') || adminStock.body.includes('มูลค่ารางวัลต่อชิ้น')) {
    throw new Error('admin stock view is missing delete actions or still displays per-key price values');
  }
  const deleteAllAvailable = await request('/admin/products/' + encodeURIComponent(productId) + '/stock/delete-all', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: '',
  });
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  if (deleteAllAvailable.statusCode !== 302 || data.stockItems.some(item => item.productId === productId)
    || data.randomBoxPools?.[productId]) throw new Error('delete-all did not empty unsold random-box stock and reset its pool');
  const restock = await request('/admin/products/' + encodeURIComponent(productId) + '/stock/add', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ bulk: 'George Best:private-prize-secret-1\nCarlos Puyol:private-prize-secret-2\nDELETE RESERVED:private-prize-secret-reserved\nSergio Aguero:private-prize-secret-3' }).toString(),
  });
  if (restock.statusCode !== 302) throw new Error('random-box stock could not be restored after delete-all reset');
  const published = await request('/admin/scheduled-products', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ productId, publishAt: '2020-01-01T00:00' }).toString(),
  });
  if (published.statusCode !== 302) throw new Error('random-box product could not be published');

  product = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).products.find(item => item.id === productId);
  const anonymousPage = await fetchOk('/game/' + encodeURIComponent(product.slug), 'text/html');
  const customerCookie = await loginAsCustomer();
  const productPage = await fetchOk('/game/' + encodeURIComponent(product.slug), 'text/html', { cookie: customerCookie });
  for (const page of [anonymousPage, productPage]) {
    if (!page.body.includes('฿2') || page.body.includes('85–110') || page.body.includes('85-110')
      || page.body.includes('เรทออกรางวัล') || page.body.includes('recoveryTarget')
      || page.body.includes('ความคืบหน้ารอบ')) {
      throw new Error('customer storefront price is wrong or a private target is visible');
    }
  }
  if (!productPage.body.includes('name="drawCount" type="number" min="1" max="500"')) {
    throw new Error('customer cannot choose a draw quantity');
  }

  const buyerBefore = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).users.find(user => user.username === 'demo').walletBalance;
  const missId = crypto.randomUUID();
  const firstDraw = await request('/random-box/' + encodeURIComponent(productId) + '/draw', {
    method: 'POST', headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ drawRequestId: missId, drawCount: '1' }).toString(),
  });
  if (firstDraw.statusCode !== 302) throw new Error('the first draw failed');
  const dataAfterFirst = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const missOrder = dataAfterFirst.orders.find(item => item.id === firstDraw.headers.location.split('/').pop());
  if (missOrder?.total !== 2 || missOrder.items.length !== 1 || missOrder.items[0].randomBoxDraw.isWin
    || !missOrder.items[0].randomBoxDraw.missMessage) {
    throw new Error('one draw did not charge the saved price and show its loss result');
  }
  const missPage = await fetchOk(firstDraw.headers.location, 'text/html', { cookie: customerCookie });
  if (!missPage.body.includes('ไม่ได้รับรางวัล') || !missPage.body.includes('object-contain object-center')) {
    throw new Error('loss result or full product image is missing');
  }
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const reservedToDelete = data.stockItems.find(item => item.productId === productId
    && item.username === 'DELETE RESERVED' && item.status === 'reserved');
  const deleteReserved = await request('/admin/products/' + encodeURIComponent(productId) + '/stock/'
    + encodeURIComponent(reservedToDelete?.id || 'missing') + '/delete', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const reservedPool = data.randomBoxPools?.[productId];
  if (deleteReserved.statusCode !== 302 || data.stockItems.some(item => item.id === reservedToDelete?.id)
    || reservedPool?.initialCount !== 3 || reservedPool.remainingStockIds.length !== 3
    || reservedPool.cancelledPrizeCount !== 1) {
    throw new Error('deleting a reserved random-box prize did not deduct it from the active pool');
  }

  const batchId = crypto.randomUUID();
  const batch = await request('/random-box/' + encodeURIComponent(productId) + '/draw', {
    method: 'POST', headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ drawRequestId: batchId, drawCount: '500' }).toString(),
  });
  if (batch.statusCode !== 302) throw new Error('the large draw request failed');
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const order = data.orders.find(item => item.id === batch.headers.location.split('/').pop());
  const buyerAfter = data.users.find(user => user.username === 'demo');
  const boxStock = data.stockItems.filter(item => item.productId === productId);
  if (!order?.randomBoxOrder || order.items.length >= 500 || order.total !== order.items.length * 2
    || order.items.some(item => item.price !== 2 || !item.randomBoxDraw)
    || !order.items.some(item => item.randomBoxDraw.isWin)
    || order.items.reduce((sum, item) => sum + item.randomBoxDraw.prizeCount, 0) !== 3
    || boxStock.length !== 3 || boxStock.some(item => item.status !== 'sold')
    || buyerAfter.walletBalance !== buyerBefore - order.total - 2) {
    throw new Error('the shared draw did not pay for and consume exactly the directly stocked rewards');
  }
  const orderPage = await fetchOk(batch.headers.location, 'text/html', { cookie: customerCookie });
  const rows = orderPage.body.match(/<li[^>]*data-random-box-draw-row=/g) || [];
  const resultOrder = [...orderPage.body.matchAll(/data-random-box-result-order="(win|miss)"/g)].map(match => match[1]);
  const firstMissIndex = resultOrder.indexOf('miss');
  if (resultOrder.length !== order.items.length || firstMissIndex < 1
    || resultOrder.slice(0, firstMissIndex).some(status => status !== 'win')
    || resultOrder.slice(firstMissIndex).some(status => status !== 'miss')) {
    throw new Error('random-box order page did not list all winning draws before all misses');
  }
  if (rows.length !== order.items.length || !orderPage.body.includes('ได้รับรางวัล')
    || !orderPage.body.includes('ไม่ได้รับรางวัล') || !orderPage.body.includes('ติดต่อร้านเพื่อรับสินค้า')
    || (orderPage.body.match(/data-random-box-product-image/g) || []).length !== 1
    || !orderPage.body.includes('George Best') || !orderPage.body.includes('Carlos Puyol')
    || !orderPage.body.includes('Sergio Aguero')
    || orderPage.body.includes('private-prize-secret') || orderPage.body.includes('REMOVE ITEM')
    || orderPage.body.includes('recoveryTargetDraws')) {
    throw new Error('order history leaks secrets or omits outcomes and the contact action');
  }

  const replay = await request('/random-box/' + encodeURIComponent(productId) + '/draw', {
    method: 'POST', headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ drawRequestId: batchId, drawCount: '500' }).toString(),
  });
  const afterReplay = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  if (replay.headers.location !== batch.headers.location
    || afterReplay.users.find(user => user.username === 'demo').walletBalance !== buyerAfter.walletBalance
    || afterReplay.orders.filter(item => item.randomBoxRequestId === batchId).length !== 1) {
    throw new Error('replaying a random-box batch charged or consumed stock twice');
  }

  const delivered = boxStock.find(item => item.status === 'sold');
  const deleteDelivered = await request('/admin/products/' + encodeURIComponent(productId) + '/stock/' + encodeURIComponent(delivered.id) + '/delete', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  const stillStored = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).stockItems.find(item => item.id === delivered.id);
  if (deleteDelivered.statusCode !== 302 || stillStored?.status !== 'sold') throw new Error('awarded inventory was deleted from purchase history');
}

async function loginAsCustomer() {
  const body = 'username=demo&password=demo1234';
  const response = await request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const cookie = (response.headers['set-cookie'] || [])[0];
  if (response.statusCode !== 302 || !cookie) throw new Error(`customer login returned HTTP ${response.statusCode}`);
  return cookie.split(';')[0];
}

async function checkCustomerOrderDetail() {
  const cookie = await loginAsCustomer();
  const catalog = await fetchOk('/products', 'text/html', { cookie });
  const productPaths = [...new Set([...catalog.body.matchAll(/href=["'](\/game\/[^"'#?]+)["']/g)].map(match => match[1]))];
  if (!productPaths.length) throw new Error('customer catalog does not link to any product detail pages');

  let purchasable = null;
  let soldOutChecked = false;
  for (const productPath of productPaths) {
    const page = await fetchOk(productPath, 'text/html', { cookie });
    const addAction = page.body.match(/action=["'](\/cart\/add\/[^"']+)["']/)?.[1];
    if (addAction && !purchasable) {
      const title = page.body.match(/<h1\b[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
      if (!title) throw new Error(`${productPath} exposes an add-to-cart action without a product title`);
      purchasable = { action: addAction, title };
    }
    if (page.body.includes('สินค้าหมด')) {
      if (addAction) throw new Error(`${productPath} exposes an add-to-cart action while sold out`);
      soldOutChecked = true;
    }
  }
  if (!purchasable) throw new Error('customer catalog has no in-stock product available for the checkout smoke test');
  if (!soldOutChecked) throw new Error('customer catalog has no sold-out product available for the sold-out smoke test');

  const add = await request(purchasable.action, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'qty=1&purchaseConfirmed=yes' });
  if (add.statusCode !== 302) throw new Error(`add to cart returned HTTP ${add.statusCode}`);
  const checkout = await request('/cart/checkout', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
  if (checkout.statusCode !== 302) throw new Error(`checkout returned HTTP ${checkout.statusCode}`);
  const orders = await fetchOk('/account/orders', 'text/html', { cookie });
  const detailPath = orders.body.match(/href="(\/account\/orders\/[^"]+)"/)?.[1];
  if (!detailPath) throw new Error('customer order history does not link to its order detail');
  const detail = await fetchOk(detailPath, 'text/html', { cookie });
  if (!detail.body.includes(`alt="รูปสินค้า ${purchasable.title}"`) || !detail.body.includes(purchasable.title)) {
    throw new Error('customer order detail does not show the purchased product image and title');
  }
}

async function crawlAdmin(cookie) {
  const queue = ['/admin'];
  const checked = new Set();
  while (queue.length) {
    const requestPath = queue.shift();
    if (checked.has(requestPath)) continue;
    checked.add(requestPath);
    if (checked.size > 160) throw new Error('admin crawl exceeded the safety limit');
    const page = await fetchOk(requestPath, 'text/html', { cookie });
    if (page.body.includes('admin-mobile-motion.js') || page.body.includes('admin-scroll-motion-v1.css') || page.body.includes('admin-page-surface')) throw new Error(`removed admin motion still loaded: ${requestPath}`);
    if (!/class="experiment-admin admin-site(?:\s|")/.test(page.body) || !page.body.includes('data-experiment-sidebar')) {
      throw new Error(`main admin route did not use the unified sidebar shell: ${requestPath}`);
    }
    if (!page.body.includes('data-admin-theme-toggle') || !page.body.includes('data-admin-theme="light"')) {
      throw new Error(`main admin route is missing its default light theme or accessible theme switch: ${requestPath}`);
    }
    if (!page.body.includes('/js/admin-theme-bootstrap-v1.js') || !page.body.includes('/js/admin-theme-toggle-v1.js') || page.body.includes('/js/admin-dark-surface-audit-v1.js') || !page.body.includes('/css/admin-dark-mode-v1.css')) {
      throw new Error(`main admin route is missing the prepaint theme switch/palette or loaded a late recolor scan: ${requestPath}`);
    }
    if (page.body.includes('id="admin-sidebar"') || page.body.includes('ผู้ดูแลระบบ · รุ่นทดลอง')) {
      throw new Error(`legacy admin shell leaked into the main shop: ${requestPath}`);
    }
    for (const match of page.body.matchAll(/href=["']([^"'#]+)["']/g)) {
      if (!match[1].startsWith('/admin')) continue;
      const url = new URL(match[1], baseUrl);
      const nextPath = url.pathname + url.search;
      if (!checked.has(nextPath)) queue.push(nextPath);
    }
  }
  if (checked.size < 15) throw new Error(`admin crawl covered only ${checked.size} pages`);  await fetchOk('/js/admin-theme-bootstrap-v1.js', 'application/javascript');  return checked.size;
}

async function checkBulkPrice(cookie) {
  const productsPage = await fetchOk('/admin/products', 'text/html', { cookie });
  const readProduct = (html, productId) => {
    const inputs = [...html.matchAll(/<input\b[^>]*data-product-select[^>]*>/g)].map(match => match[0]);
    const id = productId || inputs[0]?.match(/\bvalue="([^"]+)"/)?.[1];
    if (!id) return null;
    const priceButton = [...html.matchAll(/<button\b[^>]*data-products-price-edit[^>]*>/g)]
      .map(match => match[0])
      .find(button => button.includes(`data-product-id="${id}"`));
    const price = priceButton?.match(/\bdata-price="([^"]+)"/)?.[1];
    return price ? { id, price: Number(price) } : null;
  };
  const product = readProduct(productsPage.body);
  if (!product) throw new Error('admin products page does not expose selectable products for bulk pricing');
  const invalid = await request('/admin/products/bulk-price', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'operation=discount&scope=all&percentage=0',
  });
  if (invalid.statusCode !== 302 || invalid.headers.location !== '/admin/products') throw new Error(`invalid bulk price returned HTTP ${invalid.statusCode}`);
  const originalPrice = product.price;
  const validBody = new URLSearchParams({ operation: 'increase', scope: 'selected', percentage: '10', productIds: product.id }).toString();
  const valid = await request('/admin/products/bulk-price', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: validBody,
  });
  if (valid.statusCode !== 302 || valid.headers.location !== '/admin/products') throw new Error(`valid bulk price returned HTTP ${valid.statusCode}`);
  const updatedPage = await fetchOk('/admin/products', 'text/html', { cookie });
  const updatedProduct = readProduct(updatedPage.body, product.id);
  const expected = Math.round(originalPrice * 1.1);
  if (!updatedProduct || updatedProduct.price !== expected) throw new Error(`bulk price did not update ${originalPrice} to ${expected}`);
}

async function checkThemePage(cookie) {
  const page = await fetchOk('/admin/theme', 'text/html', { cookie });
  for (const marker of [
    'class="admin-theme-page"',
    'name="accent"',
    'name="bgPreset"',
    'name="style"',
    'หน้าร้านตัวอย่าง',
    'ยังไม่เปลี่ยนร้านจนกดบันทึก',
    '/css/admin-theme-page-v1.css',
    '/js/admin-theme-page-v1.js',
  ]) {
    if (!page.body.includes(marker)) throw new Error(`redesigned theme page is missing ${marker}`);
  }
  await fetchOk('/css/admin-theme-page-v1.css', 'text/css');
  await fetchOk('/js/admin-theme-page-v1.js', 'application/javascript');

  const checkedValue = name => page.body.match(new RegExp(`name="${name}" value="([^"]+)"[^>]*checked`))?.[1];
  const accent = checkedValue('accent');
  const bgPreset = checkedValue('bgPreset');
  const style = checkedValue('style');
  const bgMode = page.body.match(/name="bgMode" value="([^"]*)"/)?.[1];
  const bgColor = page.body.match(/name="bgColor" value="([^"]*)"/)?.[1] || '';
  if (!accent || !bgPreset || !style || !bgMode) throw new Error('theme form does not preserve the current saved selections');

  const saved = await request('/admin/theme', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ accent, bgPreset, bgMode, bgColor, style }).toString(),
  });
  if (saved.statusCode !== 302 || saved.headers.location !== '/admin/theme') throw new Error('redesigned theme form did not save to the existing production route');
  const afterSave = await fetchOk('/admin/theme', 'text/html', { cookie });
  if (!afterSave.body.includes('บันทึกธีมสีแล้ว')) throw new Error('theme save did not show its success feedback');
}

async function checkUninstalledRainModule(cookie) {
  const effects = await fetchOk('/admin/effects', 'text/html', { cookie });
  if (!effects.body.includes('เพลงพื้นหลังหน้าเว็บ') || !effects.body.includes('data-snow-toggle')) {
    throw new Error('standard storefront effects are missing from admin');
  }
  if (effects.body.includes('class="effects-rain-form"')) {
    throw new Error('rain controls are visible even though the system module is not installed');
  }
  const update = await request('/admin/effects/rain', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'color=%2378c8ff&intensity=medium',
  });
  if (update.statusCode !== 302 || update.headers.location !== '/admin/effects') {
    throw new Error(`installed rain update returned HTTP ${update.statusCode}`);
  }
  const home = await fetchOk('/', 'text/html');
  if (home.body.includes('id="store-rain"')) {
    throw new Error('disabled rain module rendered on storefront');
  }
}

async function checkBulkFolderImportFallback(cookie) {
  const boundary = `----lilteam-${process.pid}`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="ajax"\r\n\r\n1\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="productTitles"\r\n\r\nfolder-import-smoke\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="price"\r\n\r\n10\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="productImages"; filename="folder-smoke.png"\r\nContent-Type: image/png\r\n\r\n`,
  ];
  const body = Buffer.concat([Buffer.from(parts.join('')), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const response = await request('/admin/products/bulk-import', { method: 'POST', headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, body });
  if (response.statusCode !== 200) throw new Error(`folder import fallback returned HTTP ${response.statusCode}`);
  const result = JSON.parse(response.body);
  if (!result.ok || result.created !== 1) throw new Error('folder import fallback did not create its product');
  const products = await fetchOk('/admin/products', 'text/html', { cookie });
  if (!products.body.includes('folder-import-smoke')) throw new Error('folder-imported product is missing from admin products');
}

async function checkStorefrontModels(cookie) {
  const page = await fetchOk('/admin/storefront-models', 'text/html', { cookie });
  if (!page.body.includes('โมเดลหน้าร้าน LINE Rangers') || !page.body.includes('value="line-rangers"')) throw new Error('storefront model admin is incomplete');
  if (page.body.includes('value="rangers-market"') || page.body.includes('/preview/rangers-market')) throw new Error('System Lab Rangers Market model leaked into main admin');
  const preview = await request('/preview/rangers-market', { headers: { cookie } });
  if (preview.statusCode !== 404) throw new Error(`main admin can preview System Lab Rangers Market (HTTP ${preview.statusCode})`);
  const marketUpdate = await request('/admin/storefront-models', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'model=rangers-market' });
  if (marketUpdate.statusCode !== 302 || marketUpdate.headers.location !== '/admin/storefront-models') throw new Error('Rangers Market rejection failed');
  const marketHome = await fetchOk('/', 'text/html');
  if (marketHome.body.includes('data-rangers-market') || marketHome.body.includes('storefront-model-rangers-market')) throw new Error('rejected Rangers Market model activated on main storefront');
  const update = await request('/admin/storefront-models', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'model=line-rangers' });
  if (update.statusCode !== 302 || update.headers.location !== '/admin/storefront-models') throw new Error('LINE Rangers model update failed');
  const home = await fetchOk('/', 'text/html');
  if (!home.body.includes('storefront-model-line-rangers') || !home.body.includes('storefront-line-rangers-v1.css')) throw new Error('LINE Rangers model is not active on storefront');
}

async function checkHomeSectionDelete(cookie) {
  const page = await fetchOk('/admin/home-sections', 'text/html', { cookie });
  const action = page.body.match(/action="(\/admin\/home-sections\/[^"/]+\/delete)"/)?.[1];
  if (!action || !page.body.includes('hsx-icon-button is-danger')) throw new Error('home section does not expose its delete action');

  const editAction = page.body.match(/action="(\/admin\/home-sections\/[^"/]+\/edit)"/)?.[1];
  const productIds = [...page.body.matchAll(/name="productIds" value="([^"]+)"/g)]
    .map(match => match[1]).filter(Boolean).slice(0, 2);
  if (!editAction || productIds.length < 2) throw new Error('home section picker does not expose editable products');
  const editBody = [
    'title=selection-smoke', 'mode=manual', 'limit=5',
    ...productIds.map(id => `productIds=${encodeURIComponent(id)}`),
  ].join('&');
  const edited = await request(editAction, {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: editBody,
  });
  if (edited.statusCode !== 302 || edited.headers.location !== '/admin/home-sections') throw new Error('home section selection save failed');
  const afterEdit = await fetchOk('/admin/home-sections', 'text/html', { cookie });
  for (const id of productIds) {
    if (!afterEdit.body.includes(`value="${id}"`) || !new RegExp(`value="${id}"[\\s\\S]{0,180}checked`).test(afterEdit.body)) {
      throw new Error(`home section selection ${id} was not persisted`);
    }
  }
  const storefront = await fetchOk('/', 'text/html', { cookie });
  if (!storefront.body.includes('selection-smoke')) throw new Error('saved home section is missing from storefront');

  const deleted = await request(action, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
  if (deleted.statusCode !== 302 || deleted.headers.location !== '/admin/home-sections') throw new Error('home section delete failed');
  const after = await fetchOk('/admin/home-sections', 'text/html', { cookie });
  if (after.body.includes(`action="${action}"`)) throw new Error('deleted home section is still present');
}

async function checkBulkFilterDelete(cookie) {
  const page = await fetchOk('/admin/filter-tags', 'text/html', { cookie });
  const ids = [...page.body.matchAll(/data-filter-card\b[^>]*\bdata-filter-id="([^"]+)"/g)].map(match => match[1]).slice(0, 2);
  if (!ids.length) throw new Error('filter-tag page has no tags for bulk-delete smoke test');
  const response = await request('/admin/filter-tags/bulk-delete', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: ids.map(id => `tagIds=${encodeURIComponent(id)}`).join('&'),
  });
  if (response.statusCode !== 302 || response.headers.location !== '/admin/filter-tags') throw new Error(`bulk filter delete returned HTTP ${response.statusCode}`);
  const manyIds = Array.from({ length: 150 }, (_, index) => `synthetic-${index}`).join(',');
  const many = await request('/admin/filter-tags/bulk-delete', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: `tagIds=${encodeURIComponent(manyIds)}`,
  });
  if (many.statusCode !== 302 || many.headers.location !== '/admin/filter-tags') throw new Error(`bulk filter delete 150 IDs returned HTTP ${many.statusCode}`);
}

async function run() {
  try {
    let ready = false;
    let lastError = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await request('/health', { timeout: 1000 });
        if (response.statusCode >= 200 && response.statusCode < 300) { ready = true; break; }
        lastError = new Error(`/health returned HTTP ${response.statusCode}`);
      } catch (error) { lastError = error; }
      await wait(500);
    }
    if (!ready) throw new Error(`server did not become healthy: ${lastError && lastError.message}\n${output}`);
    await fetchOk('/health', 'application/json');
    const home = await fetchOk('/', 'text/html');
    if (!home.body.includes('/css/tailwind.generated.css')) throw new Error('home is missing the precompiled Tailwind stylesheet');
    if (!home.body.includes('class="relative flex-1 storefront-owner-home-v7"')) throw new Error('main home is missing its page-scoped redesign marker');
    if (!home.body.includes('/css/storefront-owner-home-v7.css')) throw new Error('main home is missing its isolated redesign stylesheet');
    if (!home.body.includes('data-owner-home-layout="cozy-marketplace"') || !home.body.includes('/css/storefront-owner-home-v20.css') || !home.body.includes('/css/storefront-home-cozy-v1.css')) throw new Error('main home is missing the cozy marketplace layout');
    const homeSectionOrder = ['class="owner-home-v20-hero ', 'class="store-status-section', 'class="store-announcements', 'class="store-filter-section', 'id="home-catalog"'];
    const sectionPositions = homeSectionOrder.map(marker => home.body.indexOf(marker));
    if (sectionPositions.some(position => position < 0) || sectionPositions.some((position, index) => index && position <= sectionPositions[index - 1])) throw new Error('main home discovery sections are out of order');
    const ownerHomeCss = await fetchOk('/css/storefront-owner-home-v7.css', 'text/css');
    if (!/#site-page-shell\.storefront-owner-home-v7\s*\{[^}]*background-color:\s*var\(--bg\)\s*!important/s.test(ownerHomeCss.body)) throw new Error('owner homepage background does not cover the shared storefront artwork');
    const ownerHomeV20Css = await fetchOk('/css/storefront-owner-home-v20.css', 'text/css');
    await fetchOk('/css/storefront-home-cozy-v1.css', 'text/css');
    if (!/\.owner-home-v20-artwork img\s*\{[^}]*object-fit:\s*contain/s.test(ownerHomeV20Css.body)) throw new Error('main shop banner is not shown in full');
    if (!['background: var(--bg)', 'background: var(--card)', 'color: var(--text)', 'color: var(--gold-text)'].every(token => ownerHomeV20Css.body.includes(token))) throw new Error('main shop homepage is not using the saved storefront theme tokens');
    if (/--(?:gold|bg|card|input|border|text):\s*#[0-9a-f]{3,8}/i.test(ownerHomeV20Css.body)) throw new Error('main shop homepage overrides the saved storefront theme palette');
    if (!home.body.includes('owner-home-v23-hero')) throw new Error('main home is missing its featured hero');
    if (!home.body.includes('owner-home-v23-spotlight') || !home.body.includes('main-store-product-stock')) throw new Error('main home is missing the real-data featured item or stock status');
    const ownerHomeV23Css = await fetchOk('/css/storefront-owner-home-hero-v23.css', 'text/css');
    if (!ownerHomeV23Css.body.includes('.owner-home-v23-spotlight') || !ownerHomeV23Css.body.includes('prefers-reduced-motion')) throw new Error('main hero spotlight is missing its responsive motion-safe styles');
    const ownerHomeV21Css = await fetchOk('/css/storefront-owner-home-v21.css', 'text/css');
    if (!/\.owner-home-v21-media\s*>\s*img\s*\{[^}]*object-fit:\s*contain/s.test(ownerHomeV21Css.body)) throw new Error('main shop product artwork must remain fully visible without cropping');
    const ownerProductImageCss = await fetchOk('/css/storefront-owner-home-v1.css', 'text/css');
    if (!/\.main-store-product-card img\s*\{[^}]*height:\s*auto\s*!important[^}]*aspect-ratio:\s*auto\s*!important[^}]*object-fit:\s*contain\s*!important/s.test(ownerProductImageCss.body)) throw new Error('main-store product images must use their full intrinsic aspect ratio');
    if (!/\.main-store-product-card :is\(\.catalog-image, \.owner-home-v21-media, \.owner-home-v20-poster\)\s*\{[^}]*aspect-ratio:\s*auto\s*!important[^}]*overflow:\s*visible\s*!important/s.test(ownerProductImageCss.body)) throw new Error('main-store product image frames must not clip uploaded artwork');
    if (home.body.includes('cdn.tailwindcss.com')) throw new Error('home still loads the Tailwind browser compiler');
    if (!home.body.includes('data-seamless-navigation="true"')) throw new Error('home is missing persistent navigation for uninterrupted music');
    if (!home.body.includes('/js/interaction-performance-v1.js')) throw new Error('home is missing shared interaction performance helpers');
    if (!home.body.includes("menu.addEventListener('click'")) throw new Error('mobile navigation does not close when a menu link is selected');
    await fetchOk('/products', 'text/html');
    const productDetail = await fetchOk('/game/shadow-realm-chronicles', 'text/html');
    if (productDetail.body.includes('class="relative flex-1 storefront-owner-home-v7"')) throw new Error('the owner homepage marker leaked into another storefront page');
    if (!productDetail.body.includes('ตัวที่มีในไอดีนี้') || !productDetail.body.includes('แนะนำ')) {
      throw new Error('product detail is missing its assigned filter information');
    }
    const missingProduct = await request('/game/smoke-product-that-does-not-exist');
    if (missingProduct.statusCode !== 404) throw new Error(`missing product returned HTTP ${missingProduct.statusCode} instead of 404`);
    await fetchOk('/css/storefront-mobile-v1.css', 'text/css');
    const scrollMotionCss = await fetchOk('/css/scroll-motion-v1.css', 'text/css');
    if (scrollMotionCss.body.includes('content-visibility:auto')) {
      throw new Error('product cards still use content-visibility with native lazy-loaded images');
    }
    if (!scrollMotionCss.body.includes('mobile-is-scrolling')) throw new Error('mobile scroll performance guard is missing');
    if (!scrollMotionCss.body.includes('.premium-product-card,.catalog-card{box-shadow:none!important;filter:none!important}')) throw new Error('product cards still gain a shadow/filter while scrolling');
    if (scrollMotionCss.body.includes('translate3d(0,34px,0) scale(.92)')) throw new Error('mobile product reveal still performs expensive image scaling');
    if (!scrollMotionCss.body.includes('transition-delay:0ms!important')) throw new Error('mobile product reveals still use staggered delays');
    const scrollMotionJs = await fetchOk('/js/scroll-motion-v1.js', 'application/javascript');
    if (scrollMotionJs.body.includes('getBoundingClientRect')) throw new Error('scroll reveal performs a forced layout sweep');
    const interactionPerformanceJs = await fetchOk('/js/interaction-performance-v1.js', 'application/javascript');
    if (!interactionPerformanceJs.body.includes('page-is-scrolling')) throw new Error('desktop scroll performance guard is missing');
    const mainLayoutSource = fs.readFileSync(path.join(__dirname, '..', 'src/views/layouts/main.ejs'), 'utf8');
    if (mainLayoutSource.includes("getContext('2d',{alpha:true,desynchronized:true})")) throw new Error('rain canvas still uses unsafe desynchronized compositing');
    if (mainLayoutSource.includes("contains('page-is-scrolling')||now-last")) throw new Error('rain still freezes while the user scrolls');
    if (/mobile-is-scrolling[^\n]{0,120}(return|continue)/.test(mainLayoutSource)) throw new Error('rain still pauses during touch scrolling');
    if (!mainLayoutSource.includes("Math.min(.08,Math.max(.001,(now-last)/1000))")) throw new Error('rain does not recover its velocity after dropped frames');
    if (!mainLayoutSource.includes("addEventListener('pageshow',start)")) throw new Error('rain lifecycle does not restart reliably');
    if (mainLayoutSource.includes("now-last<(coarse?34:25)")) throw new Error('rain is still throttled below the display refresh rate');
    if (!mainLayoutSource.includes("coarse&&w&&Math.abs(nextW-w)<2")) throw new Error('mobile browser chrome resize guard is missing');
    if (mainLayoutSource.includes('drops.filter(')) throw new Error('rain allocates filtered drop arrays during animation');
    if (mainLayoutSource.includes('Math.sin(d.phase)') || mainLayoutSource.includes('g.arc(sw*.28')) throw new Error('rain still twinkles or renders star-like heads');
    if (/id="store-rain"[^>]*(?:translateZ\(0\)|will-change:transform)/.test(mainLayoutSource)) throw new Error('full-screen rain canvas still forces a GPU layer');
    if (mainLayoutSource.includes('createLinearGradient') || mainLayoutSource.includes('drawImage(sprite')) throw new Error('rain still renders meteor-like gradient tails');
    if (!mainLayoutSource.includes('function rainPath(bucket)')) throw new Error('rain is not batched into lightweight depth layers');
    if (!mainLayoutSource.includes('430+Math.random()*300')) throw new Error('rain velocity is outside the natural rainfall range');
    if (!mainLayoutSource.includes('light:coarse?14:30,medium:coarse?24:52,heavy:coarse?34:72')) throw new Error('mobile rain density is too high');
    if (!mainLayoutSource.includes('drop.wind=-12+Math.random()*30')) throw new Error('rain still falls in one horizontal direction');
    if (!mainLayoutSource.includes("addEventListener('pageshow'")) throw new Error('rain does not resume after a back-forward cache restore');
    await checkCustomerOrderDetail();
    const cookie = await loginAsAdmin();
    await checkMusicAcrossStorefront(cookie);
    await checkRecommendedCategoryHomepage(cookie);
    await checkScheduledProductWorkflow(cookie);
    const mainAdmin = await fetchOk('/admin', 'text/html', { cookie });
    if (!mainAdmin.body.includes('admin-site')) throw new Error('admin is missing its motion scope');
    const filterTagsPage = await fetchOk('/admin/filter-tags', 'text/html', { cookie });
    if (!filterTagsPage.body.includes('href="/admin/filter-tags/efootball/import"')) throw new Error('player-card import does not open its review page');
    const playerImportPreview = await fetchOk('/admin/filter-tags/efootball/import', 'text/html', { cookie });
    if (!playerImportPreview.body.includes('IMPORT PREVIEW') || !playerImportPreview.body.includes('การ์ดที่จะนำเข้า')) throw new Error('player-card import preview is missing its review UI');
    if (!playerImportPreview.body.includes('ยืนยันนำเข้า')) throw new Error('player-card import preview is missing its confirmation action');
    const playerImportCss = await fetchOk('/css/admin-experiment-efootball-import-v1.css', 'text/css');
    if (!playerImportCss.body.includes('.efhub-player-grid')) throw new Error('player-card import preview is missing its responsive styles');
    if (mainAdmin.body.includes('admin-scroll-motion-v1.css') || mainAdmin.body.includes('admin-mobile-motion.js')) throw new Error('admin still loads the removed motion system');
    if (mainAdmin.body.includes('backdrop-filter: blur(4px)')) throw new Error('admin navigation overlay still forces full-screen blur compositing');
    if (/closest\('a\[href\]'\)[\s\S]{0,500}markNavigating\(\)/.test(mainAdmin.body)) throw new Error('ordinary admin links still trigger a blocking navigation spinner');
    if (mainAdmin.body.includes('admin-page-surface')) throw new Error('admin still exposes the removed animated page surface');
    if (mainAdmin.body.includes('/admin/rangers-catalog')) throw new Error('System Lab catalog leaked into the main admin menu');
    const protectedCatalog = await request('/admin/rangers-catalog', { headers: { cookie } });
    if (protectedCatalog.statusCode !== 404) throw new Error(`main admin can access System Lab catalog (HTTP ${protectedCatalog.statusCode})`);
    await checkUninstalledRainModule(cookie);
    await checkThemePage(cookie);
    await checkStorefrontModels(cookie);
    await checkBulkFilterDelete(cookie);
    await checkHomeSectionDelete(cookie);
    const adminPageCount = await crawlAdmin(cookie);
    await checkBulkPrice(cookie);
    await checkBulkFolderImportFallback(cookie);
    await checkRandomBoxWorkflow(cookie);
    const missing = await request('/definitely-missing');
    if (missing.statusCode !== 404 || !missing.body.includes('>404<')) throw new Error('404 page does not identify HTTP 404');
    console.log(`Smoke checks passed: storefront, assets, undeployed module isolation, ${adminPageCount} admin pages, bulk pricing, error page`);
  } finally { cleanup(); }
}

run().catch(error => { console.error(`${error.message}\n${output}`); cleanup(); process.exitCode = 1; });
