'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const layout = path.join(__dirname, '../src/views/layouts/admin-experiment.ejs');
const shared = {
  title: 'ทดสอบหลังบ้าน',
  settings: { shopName: 'Test Shop', branding: {} },
  asset: name => `/${name}`,
  pendingTopupCount: 3,
  active: 'promotions',
  isMainSite: true,
};

(async () => {
  const promotionBody = await ejs.renderFile(path.join(__dirname, '../src/views/admin/promotions.ejs'), {
    ...shared,
    config: { campaigns: [], referral: {} },
    claims: [],
    history: [],
    messages: { success: [], error: [] },
    csrf: 'test-token',
    storefrontEnabled: true,
  });
  const categoriesBody = await ejs.renderFile(path.join(__dirname, '../src/views/admin/recommended-categories-experiment.ejs'), {
    ...shared,
    categories: [],
    products: [],
    csrf: 'test-token',
  });
  for (const [label, body] of [
    ['promotions page', promotionBody],
    ['recommended categories page', categoriesBody],
    ['missing topbar', '<div class="experiment-app"><div class="experiment-main"><main class="experiment-content">โปรโมชั่น</main></div></div>'],
    ['existing topbar', '<div class="experiment-app"><div class="experiment-main"><header class="experiment-topbar"><span>old</span></header><main class="experiment-content">หมวดหมู่</main></div></div>'],
  ]) {
    const html = await ejs.renderFile(layout, { ...shared, body });
    assert.equal((html.match(/<header class="experiment-topbar"/g) || []).length, 1, `${label}: one canonical topbar`);
    assert.match(html, /data-admin-theme-toggle/, `${label}: theme control`);
    assert.match(html, /data-experiment-notifications/, `${label}: notification control`);
    assert.match(html, /experiment-notification-count[^>]*>3</, `${label}: notification badge`);
    assert.doesNotMatch(html, /<span>old<\/span>/, `${label}: legacy topbar removed`);
  }
  console.log('Admin shell render checks passed: pages with and without a topbar get the same controls.');
})().catch(error => { console.error(error); process.exitCode = 1; });
