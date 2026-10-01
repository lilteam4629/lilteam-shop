const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

module.exports = async function checkStockHistory({ baseUrl, testDbPath }) {
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
  assert.ok(executablePath, 'a local browser is required for the history regression');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ baseURL: baseUrl });
    await context.request.post('/login', { form: { username: 'admin', password: 'admin1234' }, headers: { Origin: baseUrl } });
    const page = await context.newPage();
    page.on('pageerror', error => console.error('Browser error:', error.message));
    for (const kind of ['random-box', 'standard', 'contact']) {
      const title = `stock-history-${kind}-${Date.now()}`;
      const created = await context.request.post('/admin/products/new', {
        form: { title, price: '1', productKind: kind === 'random-box' ? kind : 'standard', randomBoxRate: '1' },
        headers: { Origin: baseUrl }, maxRedirects: 0,
      });
      assert.equal(created.status(), 302);
      let data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
      const product = data.products.find(item => item.title === title);
      assert.ok(product, `created product missing: ${created.headers().location}`);
      if (kind === 'contact') await context.request.post(`/admin/products/${product.id}/stock/settings`, {
        form: { fulfillmentMode: 'contact' }, headers: { Origin: baseUrl },
      });
      await page.goto('/admin/products');
      await page.goto(`/admin/products/${product.id}/stock`);
      for (let pass = 0; pass < 2; pass++) {
        const form = page.locator('[data-stock-add-form]');
        if (kind === 'contact') await form.locator('[name="quantity"]').fill('1');
        else await form.locator('[name="bulk"]').fill(`Prize ${pass}`);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'load', timeout: 10000 }).catch(async error => {
            throw new Error(`${kind} save: ${error.message}; form error: ${await page.locator('[data-stock-add-error]').textContent()}`);
          }),
          form.locator('button[type="submit"]').click(),
        ]);
        const input = page.locator('[data-stock-add-form]').locator(kind === 'contact' ? '[name="quantity"]' : '[name="bulk"]');
        if (kind !== 'contact') assert.equal(await input.inputValue(), '');
      }
      data = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
      assert.equal(data.stockItems.filter(item => item.productId === product.id).length, 2, 'each save occurs once');
      await page.goBack({ waitUntil: 'domcontentloaded' });
      assert.equal(new URL(page.url()).pathname, '/admin/products', `${kind}: one Back returns to products`);
      await page.goForward({ waitUntil: 'domcontentloaded' });
      assert.equal(new URL(page.url()).pathname, `/admin/products/${product.id}/stock`);
      if (kind !== 'contact') assert.equal(await page.locator('[data-stock-add-form] [name="bulk"]').inputValue(), '');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    assert.ok(await page.locator('[data-stock-add-form] button[type="submit"]').isVisible());
    console.log('PASS: browser Back/Forward after repeated stock saves, cleared form, random-box/standard/contact and mobile rendering');
  } finally { await browser.close(); }
};
