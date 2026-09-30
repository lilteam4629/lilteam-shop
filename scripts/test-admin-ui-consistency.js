'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const consistency = read('public/css/admin-theme-consistency-v1.css');
const arcade = read('public/css/admin-experiment-minigame-v1.css');
const welcome = read('public/css/admin-welcome-popup-main-v1.css');

for (const layout of ['admin.ejs', 'admin-experiment.ejs']) {
  const source = read(`src/views/layouts/${layout}`);
  const dark = source.indexOf('admin-dark-mode-v1.css');
  const shared = source.indexOf('admin-theme-consistency-v1.css');
  assert(dark >= 0 && shared > dark, `${layout} must apply the shared admin theme after page and dark styles`);
}

assert.match(consistency, /--admin-ui-accent:\s*var\(--admin-brand-fill/);
assert.match(consistency, /--admin-ui-surface:\s*var\(--ex-surface/);
assert.match(consistency, /\.experiment-topbar-spacer\s*\{\s*flex:\s*1 1 auto/);
assert.doesNotMatch(arcade, /\.mgx-app\s+\.experiment-topbar\s*\{\s*justify-content:\s*flex-start/);
assert.doesNotMatch(welcome, /(?<!html\.admin-unified-site )body\.admin-unified-site/);
assert.match(welcome, /html\.admin-unified-site body\.admin-site \.welcome-live-page/);

for (const page of ['.mgx-app', '.welcome-live-page', '.recommended-page', '.announcement-admin-page', '.promo-admin']) {
  assert(consistency.includes(page), `${page} must inherit the shop theme`);
}

console.log('Admin UI consistency checks passed for both layouts, saved brand tokens, and custom pages.');
