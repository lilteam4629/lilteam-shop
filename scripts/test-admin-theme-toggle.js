'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const bootstrapSource = read('../src/views/partials/admin-theme-bootstrap.ejs')
  .replace(/^\s*<script>\s*/, '')
  .replace(/\s*<\/script>\s*$/, '');
const toggleSource = read('../public/js/admin-theme-toggle-v1.js');
const legacyLayout = read('../src/views/layouts/admin.ejs');
const experimentLayout = read('../src/views/layouts/admin-experiment.ejs');
const adminCss = read('../public/css/admin-dark-mode-v1.css');

function makeRoot() {
  const classes = new Set();
  return {
    dataset: {},
    style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
  };
}

function boot(savedTheme) {
  const root = makeRoot();
  const storage = { getItem(key) { assert.equal(key, 'lilteam_admin_theme'); return savedTheme; } };
  vm.runInNewContext(bootstrapSource, { document: { documentElement: root }, localStorage: storage });
  return root;
}

for (const savedTheme of ['dark', 'light', null, 'invalid']) {
  const root = boot(savedTheme);
  const expected = savedTheme === 'dark' ? 'dark' : 'light';
  assert.equal(root.dataset.adminTheme, expected, 'only a valid saved preference should be applied before paint');
  assert.equal(root.style.colorScheme, expected, 'native controls should use the saved color scheme');
  assert.equal(root.classList.contains('dark'), expected === 'dark');
  assert.equal(root.classList.contains('light'), expected === 'light');
  assert.equal(root.style.backgroundColor, expected === 'dark' ? '#0b0f14' : '#f6f8f8');
}

const root = makeRoot();
root.dataset.adminTheme = 'light';
const attributes = {};
const label = { textContent: '' };
const button = {
  setAttribute(key, value) { attributes[key] = value; },
  querySelector(selector) { return selector === '[data-admin-theme-label]' ? label : null; },
};
const listeners = {};
const animationFrames = [];
const storageValues = {};
const document = {
  documentElement: root,
  querySelectorAll(selector) { return selector === '[data-admin-theme-toggle]' ? [button] : []; },
  addEventListener(type, handler) { listeners[type] = handler; },
};
vm.runInNewContext(toggleSource, {
  document,
  localStorage: { setItem(key, value) { storageValues[key] = value; } },
  requestAnimationFrame(callback) { animationFrames.push(callback); },
});
assert.equal(attributes['aria-pressed'], 'false');
assert.equal(attributes['aria-label'], 'เปลี่ยนเป็นโหมดมืด');
assert.equal(label.textContent, 'โหมดมืด');
listeners.click({ target: { closest(selector) { return selector === '[data-admin-theme-toggle]' ? button : null; } } });
assert.equal(root.dataset.adminTheme, 'dark', 'activating the switch should apply dark mode without reloading');
assert.equal(root.style.colorScheme, 'dark');
assert.equal(root.style.backgroundColor, '#0b0f14', 'dark mode must paint the layered canvas immediately');
assert.equal(storageValues.lilteam_admin_theme, 'dark', 'the selected mode must survive navigation');
assert.equal(attributes['aria-pressed'], 'true');
assert.equal(attributes['aria-label'], 'เปลี่ยนเป็นโหมดสว่าง');
assert.equal(label.textContent, 'โหมดสว่าง');
animationFrames.shift()();
animationFrames.shift()();
assert.equal(root.classList.contains('admin-theme-switching'), false, 'the no-transition guard should clear after two frames');

for (const [name, layout] of [['legacy', legacyLayout], ['experiment', experimentLayout]]) {
  const bootstrapIndex = layout.indexOf('partials/admin-theme-bootstrap');
  const stylesheetIndex = layout.indexOf('rel="stylesheet"');
  assert.ok(bootstrapIndex >= 0 && bootstrapIndex < stylesheetIndex, name + ' theme preference must be applied before stylesheets');
  assert.doesNotMatch(layout, /admin-theme-bootstrap-v1\.js/, name + ' layout must not block first paint on a theme boot request');
  assert.match(layout, /admin-theme-toggle-v1\.js/, name + ' layout must install the switch handler');
  assert.match(layout, /admin-dark-mode-v1\.css/, name + ' layout must include the shared theme palette');
  assert.match(layout, /partials\/admin-theme-toggle/, name + ' layout must include the accessible theme control');
  assert.match(layout, /fonts\.googleapis\.com\/css2\?family=Kanit/, name + ' layout must load the storefront typeface');
  assert.doesNotMatch(layout, /family=Nunito\+Sans|family=Rubik/, name + ' layout must not load a different admin typeface');
}
assert.match(adminCss, /html\.admin-unified-site body\.admin-site[\s\S]*font-family:\s*'Kanit'/, 'Kanit must be enforced on all admin pages');
assert.match(adminCss, /html\.admin-theme-switching[\s\S]*transition:\s*none\s*!important/, 'theme changes must disable color transitions briefly');
assert.doesNotMatch(experimentLayout + legacyLayout, /admin-dark-surface-audit-v1\.js/, 'dark surfaces must be styled before paint without a late DOM recolor scan');

console.log('Admin theme checks passed: saved mode boots before CSS, the switch persists across navigation, and both layouts use Kanit.');
