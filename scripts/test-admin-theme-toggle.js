'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const bootstrapSource = read('../public/js/admin-theme-bootstrap-v1.js');
const compatibilitySource = read('../public/js/admin-theme-toggle-v1.js');
const legacyLayout = read('../src/views/layouts/admin.ejs');
const experimentLayout = read('../src/views/layouts/admin-experiment.ejs');

function boot(savedTheme) {
  const root = { dataset: {}, style: {} };
  const storage = { getItem(key) { assert.equal(key, 'lilteam_admin_theme'); return savedTheme; } };
  vm.runInNewContext(bootstrapSource, { document: { documentElement: root }, localStorage: storage });
  return root;
}

for (const savedTheme of ['dark', 'light', null, 'invalid']) {
  const root = boot(savedTheme);
  assert.equal(root.dataset.adminTheme, 'light', 'saved dark preferences must not activate admin dark mode');
  assert.equal(root.style.colorScheme, 'light', 'native admin controls must remain light');
}

const compatibilityRoot = { dataset: { adminTheme: 'dark' }, style: {} };
vm.runInNewContext(compatibilitySource, { document: { documentElement: compatibilityRoot } });
assert.equal(compatibilityRoot.dataset.adminTheme, 'light');
assert.equal(compatibilityRoot.style.colorScheme, 'light');

for (const [name, layout] of [['legacy', legacyLayout], ['experiment', experimentLayout]]) {
  assert.equal(layout.includes('theme-toggle-btn'), false, name + ' admin layout must not render a theme switch');
  assert.equal(layout.includes('data-admin-theme-toggle'), false, name + ' admin layout must not render a theme switch');
  assert.ok(layout.includes('data-admin-theme="light"') || layout.includes('class="light '), name + ' admin layout must boot in light mode');
  assert.equal(layout.includes('admin-theme-toggle-v1.js'), false, name + ' admin layout must not load a toggle handler');
}
assert.equal(experimentLayout.includes('admin-dark-surface-audit-v1.js'), false, 'paused dark-mode surface scanning must not run on admin pages');
assert.equal(experimentLayout.includes('admin-dark-mode-v1.css'), false, 'paused dark-mode styles must not load on admin pages');

console.log('Admin theme pause checks passed: saved dark preferences boot light, no switch is rendered, and no dark-mode scan runs.');
