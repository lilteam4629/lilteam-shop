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

async function loginAsCustomer() {
  const body = 'username=demo&password=demo1234';
  const response = await request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const cookie = (response.headers['set-cookie'] || [])[0];
  if (response.statusCode !== 302 || !cookie) throw new Error(`customer login returned HTTP ${response.statusCode}`);
  return cookie.split(';')[0];
}

async function checkCustomerOrderDetail() {
  const cookie = await loginAsCustomer();
  const productPage = await fetchOk('/game/shadow-realm-chronicles', 'text/html', { cookie });
  const productId = productPage.body.match(/\/cart\/add\/([^"']+)/)?.[1];
  if (!productId) throw new Error('customer product page does not expose an add-to-cart action');
  const add = await request(`/cart/add/${productId}`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'qty=1' });
  if (add.statusCode !== 302) throw new Error(`add to cart returned HTTP ${add.statusCode}`);
  const checkout = await request('/cart/checkout', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
  if (checkout.statusCode !== 302) throw new Error(`checkout returned HTTP ${checkout.statusCode}`);
  const orders = await fetchOk('/account/orders', 'text/html', { cookie });
  const detailPath = orders.body.match(/href="(\/account\/orders\/[^"]+)"/)?.[1];
  if (!detailPath) throw new Error('customer order history does not link to its order detail');
  const detail = await fetchOk(detailPath, 'text/html', { cookie });
  if (!detail.body.includes('alt="รูปสินค้า Shadow Realm Chronicles"') || !detail.body.includes('Shadow Realm Chronicles')) {
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
    if (!page.body.includes('admin-mobile-motion.js') || !page.body.includes('admin-page-surface')) throw new Error(`missing restored admin motion layout: ${requestPath}`);
    if (page.body.includes('admin-scroll-motion-v1.js')) throw new Error(`competing admin motion: ${requestPath}`);
    for (const match of page.body.matchAll(/href=["']([^"'#]+)["']/g)) {
      if (!match[1].startsWith('/admin')) continue;
      const url = new URL(match[1], baseUrl);
      const nextPath = url.pathname + url.search;
      if (!checked.has(nextPath)) queue.push(nextPath);
    }
  }
  if (checked.size < 15) throw new Error(`admin crawl covered only ${checked.size} pages`);
  return checked.size;
}

async function checkBulkPrice(cookie) {
  const productsPage = await fetchOk('/admin/products', 'text/html', { cookie });
  const product = productsPage.body.match(/class="[^"]*product-select[^"]*"[^>]*value="([^"]+)"[\s\S]*?data-price="([^"]+)"/);
  if (!product) throw new Error('admin products page does not expose selectable products for bulk pricing');
  const invalid = await request('/admin/products/bulk-price', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'operation=discount&scope=all&percentage=0',
  });
  if (invalid.statusCode !== 302 || invalid.headers.location !== '/admin/products') throw new Error(`invalid bulk price returned HTTP ${invalid.statusCode}`);
  const originalPrice = Number(product[2]);
  const validBody = new URLSearchParams({ operation: 'increase', scope: 'selected', percentage: '10', productIds: product[1] }).toString();
  const valid = await request('/admin/products/bulk-price', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: validBody,
  });
  if (valid.statusCode !== 302 || valid.headers.location !== '/admin/products') throw new Error(`valid bulk price returned HTTP ${valid.statusCode}`);
  const updatedPage = await fetchOk('/admin/products', 'text/html', { cookie });
  const updatedProduct = updatedPage.body.match(new RegExp(`class="[^"]*product-select[^"]*"[^>]*value="${product[1]}"[\\s\\S]*?data-price="([^"]+)"`));
  const expected = Math.round(originalPrice * 1.1);
  if (!updatedProduct || Number(updatedProduct[1]) !== expected) throw new Error(`bulk price did not update ${originalPrice} to ${expected}`);
}

async function checkInstalledDisabledRainModule(cookie) {
  const effects = await fetchOk('/admin/effects', 'text/html', { cookie });
  if (!effects.body.includes('เพลงพื้นหลังหน้าเว็บ') || !effects.body.includes('เอฟเฟกต์หิมะตกหน้าเว็บ')) {
    throw new Error('standard storefront effects are missing from admin');
  }
  if (!effects.body.includes('ระบบฝนตกหน้าเว็บ')) {
    throw new Error('installed rain controls are missing from admin');
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
    if (home.body.includes('cdn.tailwindcss.com')) throw new Error('home still loads the Tailwind browser compiler');
    if (!home.body.includes('data-seamless-navigation="true"')) throw new Error('home is missing persistent navigation for uninterrupted music');
    if (!home.body.includes('/js/interaction-performance-v1.js')) throw new Error('home is missing shared interaction performance helpers');
    if (!home.body.includes("menu.addEventListener('click'")) throw new Error('mobile navigation does not close when a menu link is selected');
    await fetchOk('/products', 'text/html');
    const productDetail = await fetchOk('/game/shadow-realm-chronicles', 'text/html');
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
    const adminMotionCss = await fetchOk('/css/admin-scroll-motion-v1.css', 'text/css');
    const adminMotionJs = await fetchOk('/js/admin-mobile-motion.js', 'application/javascript');
    const interactionPerformanceJs = await fetchOk('/js/interaction-performance-v1.js', 'application/javascript');
    if (!interactionPerformanceJs.body.includes('page-is-scrolling')) throw new Error('desktop scroll performance guard is missing');
    const mainLayoutSource = fs.readFileSync(path.join(__dirname, '..', 'src/views/layouts/main.ejs'), 'utf8');
    if (mainLayoutSource.includes("getContext('2d',{alpha:true,desynchronized:true})")) throw new Error('rain canvas still uses unsafe desynchronized compositing');
    if (mainLayoutSource.includes("contains('page-is-scrolling')||now-last")) throw new Error('rain still freezes while the user scrolls');
    if (mainLayoutSource.includes("now-last<(coarse?34:25)")) throw new Error('rain is still throttled below the display refresh rate');
    if (!mainLayoutSource.includes("coarse&&w&&Math.abs(nextW-w)<2")) throw new Error('mobile browser chrome resize guard is missing');
    if (mainLayoutSource.includes('drops.filter(')) throw new Error('rain allocates filtered drop arrays during animation');
    if (mainLayoutSource.includes('Math.sin(d.phase)') || mainLayoutSource.includes('g.arc(sw*.28')) throw new Error('rain still twinkles or renders star-like heads');
    if (mainLayoutSource.includes('createLinearGradient') || mainLayoutSource.includes('drawImage(sprite')) throw new Error('rain still renders meteor-like gradient tails');
    if (!mainLayoutSource.includes('function rainPath(bucket)')) throw new Error('rain is not batched into lightweight depth layers');
    if (!mainLayoutSource.includes('430+Math.random()*300')) throw new Error('rain velocity is outside the natural rainfall range');
    if (!mainLayoutSource.includes('light:coarse?14:30,medium:coarse?24:52,heavy:coarse?34:72')) throw new Error('mobile rain density is too high');
    if (!mainLayoutSource.includes('drop.wind=-12+Math.random()*30')) throw new Error('rain still falls in one horizontal direction');
    if (!mainLayoutSource.includes("addEventListener('pageshow'")) throw new Error('rain does not resume after a back-forward cache restore');
    await checkCustomerOrderDetail();
    const cookie = await loginAsAdmin();
    const mainAdmin = await fetchOk('/admin', 'text/html', { cookie });
    if (!mainAdmin.body.includes('admin-site')) throw new Error('admin is missing its motion scope');
    if (!mainAdmin.body.includes('admin-scroll-motion-v1.css') || !mainAdmin.body.includes('admin-mobile-motion.js')) throw new Error('admin is not loading the restored motion on every viewport');
    if (mainAdmin.body.includes('backdrop-filter: blur(4px)')) throw new Error('admin navigation overlay still forces full-screen blur compositing');
    if (/closest\('a\[href\]'\)[\s\S]{0,500}markNavigating\(\)/.test(mainAdmin.body)) throw new Error('ordinary admin links still trigger a blocking navigation spinner');
    if (!mainAdmin.body.includes('<main class="admin-page-surface')) throw new Error('admin right-hand page surface is missing entrance motion');
    await checkInstalledDisabledRainModule(cookie);
    const adminPageCount = await crawlAdmin(cookie);
    await checkBulkPrice(cookie);
    const missing = await request('/definitely-missing');
    if (missing.statusCode !== 404 || !missing.body.includes('>404<')) throw new Error('404 page does not identify HTTP 404');
    console.log(`Smoke checks passed: storefront, assets, undeployed module isolation, ${adminPageCount} admin pages, bulk pricing, error page`);
  } finally { cleanup(); }
}

run().catch(error => { console.error(`${error.message}\n${output}`); cleanup(); process.exitCode = 1; });
