const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
module.exports = async function checkStockPosition({ baseUrl }) {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [1920, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const path of ['/', '/products']) {
        await page.goto(baseUrl + path, { waitUntil: 'load' });
        const cards = page.locator('.owner-home-v21-product-card');
        assert.ok(await cards.count(), `${path}: product cards exist`);
        const result = await cards.first().evaluate(card => {
          const media = card.querySelector('.owner-home-v21-media').getBoundingClientRect();
          const title = card.querySelector('.owner-home-v21-name').getBoundingClientRect();
          const badgeElement = card.querySelector('.owner-home-v21-stock-badge');
          const badge = badgeElement.getBoundingClientRect();
          const bounds = card.getBoundingClientRect();
          return { position: getComputedStyle(badgeElement).position,
            belowImage: badge.top >= media.bottom, belowTitle: badge.top >= title.bottom,
            contained: badge.left >= bounds.left && badge.right <= bounds.right };
        });
        assert.equal(result.position, 'static');
        assert.ok(result.belowImage && result.belowTitle && result.contained, `${width}px ${path}: badge stays below title and within card`);
      }
    }
    console.log('PASS: stock badges below product titles without image overlap on desktop, tablet and mobile');
  } finally { await browser.close(); }
};
