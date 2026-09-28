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
  if (!form.body.includes('name="productKind"') || !form.body.includes('random-box-product-fields-v1.css')
    || !form.body.includes('name="randomBoxRate"') || !form.body.includes('min="0.01"') || !form.body.includes('max="100"')
    || form.body.includes('name="randomBoxPrizeName"') || form.body.includes('data-random-box-range')
    || /สินค้า\s*1\s*ชิ้น\s*(?:ต่อ|ในช่วง)\s*85\s*[–-]\s*110/.test(form.body)) {
    throw new Error('product form does not expose the random-box product type and setup UI');
  }
  const title = `random-box-smoke-${process.pid}`;
  const payload = new URLSearchParams();
  payload.set('title', title);
  payload.set('productKind', 'random-box');
  payload.set('randomBoxRate', '1');
  payload.set('price', '999');
  const created = await request('/admin/products/new', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: payload.toString(),
  });
  const productId = decodeURIComponent(created.headers.location?.match(/[?&]productId=([^&#]+)/)?.[1] || '');
  if (created.statusCode !== 302 || !productId) throw new Error('random-box product was not created into the main product workflow');
  let data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  let product = data.products.find(item => item.id === productId);
  if (!product || product.specialType !== 'random-box' || product.price !== 1 || product.randomBox.rate !== 1 || product.randomBox.prizes.length !== 0) {
    throw new Error('random-box product setup did not create the direct-inventory model');
  }
  const emptyStockPage = await fetchOk(`/admin/products/${encodeURIComponent(productId)}/stock`, 'text/html', { cookie: adminCookie });
  if (emptyStockPage.body.includes('name="randomBoxPrizeName"') || emptyStockPage.body.includes('name="randomBoxPrizePercent"')
    || !emptyStockPage.body.includes('name="randomBoxMissMessage"')
    || !emptyStockPage.body.includes('1 บรรทัดนับเป็น 1 ชิ้น') || emptyStockPage.body.includes('เรทปัจจุบัน')
    || /สินค้า\s*1\s*ชิ้น\s*(?:ต่อ|ในช่วง)\s*85\s*[–-]\s*110/.test(emptyStockPage.body)) {
    throw new Error('random-box stock page still asks for prize categories or reveals the payout range');
  }

  const editWithoutRewardFields = await request(`/admin/products/${encodeURIComponent(productId)}/edit`, {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, productKind: 'random-box', randomBoxRate: '1', status: 'active' }).toString(),
  });
  if (editWithoutRewardFields.statusCode !== 302) throw new Error('the random-box product form did not save without reward rows');
  product = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).products.find(item => item.id === productId);
  if (product.randomBox.rate !== 1) throw new Error('editing the random-box product changed its configured rate');

  const missMessage = 'เกลือ';
  const saveMissMessage = await request(`/admin/products/${encodeURIComponent(productId)}/stock/random-box-message`, {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ randomBoxMissMessage: `  ${missMessage}  ` }).toString(),
  });
  product = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).products.find(item => item.id === productId);
  if (saveMissMessage.statusCode !== 302 || product.randomBox.missMessage !== missMessage) {
    throw new Error('the configured miss message was not trimmed and saved');
  }

  const addStock = await request(`/admin/products/${encodeURIComponent(productId)}/stock/add`, {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ bulk: 'smoke-user:smoke-key\nraw-key-only\nremove-this-key' }).toString(),
  });
  if (addStock.statusCode !== 302 || addStock.headers.location !== `/admin/products/${productId}/stock#add-stock`) {
    throw new Error('random-box stock lines could not be added directly');
  }
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  product = data.products.find(item => item.id === productId);
  let directStockItems = data.stockItems.filter(item => item.productId === productId && item.status === 'available');
  const removableStock = directStockItems.find(item => item.username === 'remove-this-key');
  if (directStockItems.length !== 3 || directStockItems.some(item => item.randomBoxPrizeId) || !removableStock) {
    throw new Error('each direct stock line was not saved as one prize without a reward category');
  }
  const removedStock = await request(`/admin/products/${encodeURIComponent(productId)}/stock/${encodeURIComponent(removableStock.id)}/delete`, {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (removedStock.statusCode !== 302) throw new Error('an unused random-box stock line could not be removed');
  directStockItems = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).stockItems.filter(item => item.productId === productId && item.status === 'available');
  if (directStockItems.length !== 2 || directStockItems.some(item => item.username === 'remove-this-key')) {
    throw new Error('removing an unused stock line did not update the available inventory count');
  }
  const appendStock = await request(`/admin/products/${encodeURIComponent(productId)}/stock/add`, {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ bulk: 'appended-key' }).toString(),
  });
  if (appendStock.statusCode !== 302) throw new Error('new random-box stock could not be appended');
  const stockPage = await fetchOk(`/admin/products/${encodeURIComponent(productId)}/stock`, 'text/html', { cookie: adminCookie });
  const firstStockRow = stockPage.body.indexOf('smoke-user');
  const secondStockRow = stockPage.body.indexOf('raw-key-only');
  const appendedStockRow = stockPage.body.indexOf('appended-key');
  if (!stockPage.body.includes('ส่งคีย์/ไอดีจากสต็อกให้อัตโนมัติ') || !stockPage.body.includes('smoke-user')
    || stockPage.body.includes('สินค้า 1 ชิ้น ต่อ') || /สินค้า\s*1\s*ชิ้น\s*(?:ต่อ|ในช่วง)\s*\d+\s*[–-]\s*\d+/.test(stockPage.body)
    || !stockPage.body.includes('ระบบยังนำสินค้าสต็อกพร้อมขายรายการอื่นในเว็บหลักมาจัดเป็นชุดรางวัลให้อัตโนมัติ')
    || !stockPage.body.includes('รายการสินค้าที่นำมาเป็นรางวัลได้')
    || !stockPage.body.includes('รายการคีย์ / ไอดีที่พร้อมขาย (3)')
    || !(firstStockRow < secondStockRow && secondStockRow < appendedStockRow)
    || !/<th[^>]*>ลำดับ<\/th>/.test(stockPage.body) || !/>1<\/td>/.test(stockPage.body) || !/>2<\/td>/.test(stockPage.body)) {
    throw new Error('random-box stock page does not append new stock at the bottom or reveals the payout range');
  }

  const scheduled = await request('/admin/scheduled-products', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ productId, publishAt: '2020-01-01T00:00' }).toString(),
  });
  if (scheduled.statusCode !== 302) throw new Error('random-box product could not be published through the existing schedule workflow');
  product = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).products.find(item => item.id === productId);
  const anonymousPage = await fetchOk(`/game/${encodeURIComponent(product.slug)}`, 'text/html');
  if (anonymousPage.body.includes('85–110') || anonymousPage.body.includes('85-110')
    || anonymousPage.body.includes('สินค้า 1 ชิ้น ต่อ') || anonymousPage.body.includes('ความคืบหน้ารอบ')) {
    throw new Error('anonymous random-box storefront exposes payout thresholds or round progress');
  }
  const customerCookie = await loginAsCustomer();
  const page = await fetchOk(`/game/${encodeURIComponent(product.slug)}`, 'text/html', { cookie: customerCookie });
  const storefrontProblems = [
    !page.body.includes('฿1') && 'one-baht price missing',
    !page.body.includes('ส่งข้อมูลจากสต็อกให้อัตโนมัติ') && 'automatic-delivery note missing',
    !page.body.includes('name="drawCount"') && 'draw count input missing',
    !page.body.includes('name="drawCount" type="number" min="1" max="500"') && 'draw count limit is not above 100',
    (!page.body.includes('form.addEventListener(\'submit\'') || !page.body.includes('requestId.value = freshId')) && 'draw submission does not rotate its idempotency key',
    !page.body.includes('if (event.persisted) window.location.reload()') && 'back-forward cache restoration does not refresh the draw page',
    !page.body.includes('จำนวนครั้งที่ต้องการสุ่ม') && 'draw count label missing',
    !page.body.includes('data-random-box-total') && 'total preview missing',
    !page.body.includes('data-random-box-button-total') && 'button total missing',
    page.body.includes('เรทออกรางวัล') && 'rate label leaked',
    page.body.includes('เปอร์เซ็นต์ใช้เลือกชนิดรางวัล') && 'reward percentage leaked',
    page.body.includes('นับยอดสะสมรวมทุกคน') && 'shared progress explanation leaked',
    page.body.includes('สินค้า 1 ชิ้น ต่อ') && 'payout interval leaked',
    page.body.includes('ความคืบหน้ารอบ') && 'round progress explanation leaked',
    /สินค้า\s*1\s*ชิ้น\s*(?:ต่อ|ในช่วง)\s*\d+\s*[–-]\s*\d+/.test(page.body) && 'numeric payout interval leaked',
  ].filter(Boolean);
  if (storefrontProblems.length) {
    throw new Error(`random-box storefront check failed: ${storefrontProblems.join(', ')}`);
  }

  const balanceBeforeDraw = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).users.find(user => user.username === 'demo')?.walletBalance;
  const drawRequestId = crypto.randomUUID();
  const drawBody = new URLSearchParams({ drawRequestId, drawCount: '1' }).toString();
  const firstDraw = await request(`/random-box/${encodeURIComponent(productId)}/draw`, {
    method: 'POST', headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: drawBody,
  });
  if (firstDraw.statusCode !== 302 || !/^\/account\/orders\//.test(firstDraw.headers.location || '')) {
    throw new Error(`random-box draw route did not return an order (HTTP ${firstDraw.statusCode})`);
  }
  const customerOrderPage = await fetchOk(firstDraw.headers.location, 'text/html', { cookie: customerCookie });
  if (!customerOrderPage.body.includes(missMessage) || !customerOrderPage.body.includes('ไม่ได้รับรางวัล')
    || !customerOrderPage.body.includes('data-random-box-result-status="miss"')
    || !customerOrderPage.body.includes('h-auto max-h-32 w-full bg-[var(--input)] object-contain object-center')
    || /<img data-random-box-product-image[^>]*\b(?:width|height)=/.test(customerOrderPage.body)
    || !customerOrderPage.body.includes('data-random-box-product')
    || !customerOrderPage.body.includes('data-random-box-purchase-list')
    || !customerOrderPage.body.includes('aria-label="รายการผลการสุ่ม"')
    || !/<li[^>]*data-random-box-draw-row="1"/.test(customerOrderPage.body)
    || !customerOrderPage.body.includes('ครั้งที่ 1')
    || (customerOrderPage.body.match(/data-random-box-product-image/g) || []).length !== 1
    || (customerOrderPage.body.match(/data-random-box-draw-row=/g) || []).length !== 1
    || /รอบรวม\s*\d+\s*\/\s*\d+/.test(customerOrderPage.body)
    || customerOrderPage.body.includes('ความคืบหน้ารอบ')) {
    throw new Error('random-box order page should show one product and a purchase-results list without shared-round progress');
  }
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  product = data.products.find(item => item.id === productId);
  const buyer = data.users.find(user => user.username === 'demo');
  const order = data.orders.find(item => item.id === firstDraw.headers.location.split('/').pop());
  if (!buyer || buyer.walletBalance !== balanceBeforeDraw - 1 || !order?.randomBoxOrder || order.total !== 1
    || order.items[0].randomBoxDraw.roundProgress !== 1 || order.items[0].randomBoxDraw.isWin
    || order.items[0].randomBoxDraw.missMessage !== missMessage) {
    throw new Error('a random-box attempt did not create its ฿1 order and shared-round progress atomically');
  }

  const revisedMissMessage = 'รอบนี้ยังไม่ถูกรางวัล';
  const reviseMissMessage = await request(`/admin/products/${encodeURIComponent(productId)}/stock/random-box-message`, {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ randomBoxMissMessage: revisedMissMessage }).toString(),
  });
  const historicalOrderPage = await fetchOk(firstDraw.headers.location, 'text/html', { cookie: customerCookie });
  if (reviseMissMessage.statusCode !== 302 || !historicalOrderPage.body.includes(missMessage)
    || historicalOrderPage.body.includes(revisedMissMessage)) {
    throw new Error('changing the miss message rewrote a previously completed draw');
  }
  const balanceBeforeBatch = buyer.walletBalance;
  const batchRequestId = crypto.randomUUID();
  const batchResponse = await request(`/random-box/${encodeURIComponent(productId)}/draw`, {
    method: 'POST', headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ drawRequestId: batchRequestId, drawCount: '3' }).toString(),
  });
  if (batchResponse.statusCode !== 302 || !/^\/account\/orders\//.test(batchResponse.headers.location || '')) {
    throw new Error('a selected multi-draw request did not create an order');
  }
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const batchOrder = data.orders.find(item => item.id === batchResponse.headers.location.split('/').pop());
  if (!batchOrder?.randomBoxOrder || batchOrder.items.length !== 3 || batchOrder.total !== 3
    || batchOrder.items.some(item => item.price !== 1 || item.randomBoxDraw.isWin)
    || data.users.find(user => user.username === 'demo').walletBalance !== balanceBeforeBatch - 3) {
    throw new Error('the selected draw count did not create separate attempts and charge one baht per attempt');
  }
  const batchOrderPage = await fetchOk(batchResponse.headers.location, 'text/html', { cookie: customerCookie });
  if (!batchOrderPage.body.includes('สุ่ม 3 ครั้ง') || !batchOrderPage.body.includes('ครั้งที่ 3')
    || !batchOrderPage.body.includes(revisedMissMessage)
    || (batchOrderPage.body.match(/data-random-box-product-image/g) || []).length !== 1
    || (batchOrderPage.body.match(/<li[^>]*data-random-box-draw-row=/g) || []).length !== 3) {
    throw new Error('the batch order page does not summarize and list all selected draws');
  }
  const batchReplay = await request(`/random-box/${encodeURIComponent(productId)}/draw`, {
    method: 'POST', headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ drawRequestId: batchRequestId, drawCount: '3' }).toString(),
  });
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  if (batchReplay.headers.location !== batchResponse.headers.location
    || data.users.find(user => user.username === 'demo').walletBalance !== balanceBeforeBatch - 3
    || data.orders.filter(item => item.randomBoxRequestId === batchRequestId).length !== 1) {
    throw new Error('replaying a selected multi-draw request charged the wallet more than once');
  }
  const replay = await request(`/random-box/${encodeURIComponent(productId)}/draw`, {
    method: 'POST', headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: drawBody,
  });
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  if (replay.headers.location !== firstDraw.headers.location
    || data.users.find(user => user.username === 'demo').walletBalance !== balanceBeforeDraw - 4
    || data.orders.filter(item => item.randomBoxRequestId === drawRequestId).length !== 1) {
    throw new Error('replaying the same draw request debited the wallet or created a second order');
  }

  let round = data.randomBoxRounds[productId];
  if (!round || round.progress !== 4 || round.target < 85 || round.target > 110) {
    throw new Error('the pooled random-box counter was not persisted after the first draw');
  }
  for (let progress = round.progress; progress < round.target - 1; progress += 1) {
    const additionalDraw = await request(`/random-box/${encodeURIComponent(productId)}/draw`, {
      method: 'POST', headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ drawRequestId: crypto.randomUUID() }).toString(),
    });
    if (additionalDraw.statusCode !== 302) throw new Error(`pooled random-box draw ${progress + 1} failed`);
  }
  const winnerRequestId = crypto.randomUUID();
  const winnerResponse = await request(`/random-box/${encodeURIComponent(productId)}/draw`, {
    method: 'POST', headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ drawRequestId: winnerRequestId }).toString(),
  });
  if (winnerResponse.statusCode !== 302) throw new Error('the draw that completed a pooled round failed');
  data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
  const winningOrderId = winnerResponse.headers.location.split('/').pop();
  const winningOrder = data.orders.find(item => item.id === winningOrderId);
  const deliveredStock = data.stockItems.find(item => item.id === winningOrder?.items[0]?.stockItemId);
  const expectedPrizeLabel = [deliveredStock?.username, deliveredStock?.password, deliveredStock?.extra].filter(Boolean).join(':');
  const deliveredPage = await fetchOk(winnerResponse.headers.location, 'text/html', { cookie: customerCookie });
  if (winningOrder?.status !== 'completed' || !winningOrder?.items[0]?.randomBoxDraw?.isWin
    || winningOrder.items[0].randomBoxDraw.prizeName !== expectedPrizeLabel
    || !deliveredPage.body.includes('data-random-box-result-status="win"')
    || (deliveredPage.body.match(/data-random-box-product-image/g) || []).length !== 1
    || (deliveredPage.body.match(/<li[^>]*data-random-box-draw-row=/g) || []).length !== 1
    || !deliveredPage.body.includes('ได้รับรางวัล')
    || !deliveredPage.body.includes('ติดต่อร้านเพื่อรับสินค้า')
    || !deliveredPage.body.includes('data-contact-order-container')
    || !/data-contact-url="[^"]+"/.test(deliveredPage.body)
    || !deliveredPage.body.includes(`ผลสุ่มครั้งที่: 1`)
    || !deliveredPage.body.includes(expectedPrizeLabel)
    || deliveredStock?.status !== 'sold' || deliveredStock.soldOrderId !== winningOrderId
    || !deliveredStock || !deliveredPage.body.includes(deliveredStock.username)
    || (deliveredStock.password && !deliveredPage.body.includes(deliveredStock.password))) {
    throw new Error('the winning draw did not consume one stock key and reveal it automatically in the customer order');
  }
  const remainingStock = data.stockItems.filter(item => item.productId === productId);
  const remainingAvailable = remainingStock.filter(item => item.status === 'available').length;
  const soldCount = remainingStock.length - remainingAvailable;
  const soldStockPage = await fetchOk(`/admin/products/${encodeURIComponent(productId)}/stock`, 'text/html', { cookie: adminCookie });
  if (soldStockPage.body.includes(deliveredStock.username)
    || (deliveredStock.password && soldStockPage.body.includes(deliveredStock.password))
    || !soldStockPage.body.includes(`รายการคีย์ / ไอดีที่พร้อมขาย (${remainingAvailable})`)
    || !new RegExp(`ขายแล้วซ่อนจากรายการ:\\s*<b[^>]*>${soldCount}</b>`).test(soldStockPage.body)) {
    throw new Error('sold stock still appears in the inventory table instead of being hidden from the available list');
  }
  const deletedDeliveredStock = await request(`/admin/products/${encodeURIComponent(productId)}/stock/${encodeURIComponent(deliveredStock.id)}/delete`, {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  const preservedDeliveredStock = JSON.parse(fs.readFileSync(testDbPath, 'utf8')).stockItems.find(item => item.id === deliveredStock.id);
  if (deletedDeliveredStock.statusCode !== 302 || preservedDeliveredStock?.status !== 'sold') {
    throw new Error('a delivered random-box stock line was deleted from order history');
  }
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
    if (!page.body.includes('data-admin-theme-toggle') || !page.body.includes('aria-pressed="false"')) {
      throw new Error(`main admin route is missing the accessible saved dark/light theme toggle: ${requestPath}`);
    }
    if (!page.body.includes('/css/admin-dark-mode-v1.css') || !page.body.includes('/js/admin-theme-bootstrap-v1.js') || !page.body.includes('/js/admin-theme-toggle-v1.js') || !page.body.includes('/js/admin-dark-surface-audit-v1.js')) {
      throw new Error(`main admin route is missing its shared dark/light theme assets: ${requestPath}`);
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
  if (checked.size < 15) throw new Error(`admin crawl covered only ${checked.size} pages`);
  await fetchOk('/css/admin-dark-mode-v1.css', 'text/css');
  await fetchOk('/js/admin-theme-bootstrap-v1.js', 'application/javascript');
  await fetchOk('/js/admin-theme-toggle-v1.js', 'application/javascript');
  await fetchOk('/js/admin-dark-surface-audit-v1.js', 'application/javascript');
  return checked.size;
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
    await checkRecommendedCategoryHomepage(cookie);
    await checkScheduledProductWorkflow(cookie);
    const mainAdmin = await fetchOk('/admin', 'text/html', { cookie });
    if (!mainAdmin.body.includes('admin-site')) throw new Error('admin is missing its motion scope');
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
