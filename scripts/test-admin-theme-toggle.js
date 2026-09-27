'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const bootstrapSource = fs.readFileSync(path.join(__dirname, '../public/js/admin-theme-bootstrap-v1.js'), 'utf8');
const toggleSource = fs.readFileSync(path.join(__dirname, '../public/js/admin-theme-toggle-v1.js'), 'utf8');

function bootstrap(savedTheme, storageThrows = false) {
  const root = { dataset: {}, style: {} };
  const localStorage = {
    getItem(key) {
      assert.equal(key, 'lilteam_admin_theme');
      if (storageThrows) throw new Error('storage unavailable');
      return savedTheme;
    },
  };
  vm.runInNewContext(bootstrapSource, { document: { documentElement: root }, localStorage });
  return root;
}

function createPage(initialTheme = 'light', storageThrows = false) {
  const attributes = {};
  let clickHandler;
  const root = { dataset: { adminTheme: initialTheme }, style: {} };
  const toggle = {
    title: '',
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener(name, handler) { if (name === 'click') clickHandler = handler; },
  };
  const values = new Map();
  const localStorage = {
    setItem(key, value) {
      if (storageThrows) throw new Error('storage unavailable');
      values.set(key, value);
    },
  };
  const document = {
    documentElement: root,
    querySelector(selector) { return selector === '[data-admin-theme-toggle]' ? toggle : null; },
  };
  vm.runInNewContext(toggleSource, { document, localStorage });
  return { root, toggle, attributes, values, click() { clickHandler(); } };
}

assert.equal(bootstrap('dark').dataset.adminTheme, 'dark');
assert.equal(bootstrap('dark').style.colorScheme, 'dark');
assert.equal(bootstrap('invalid').dataset.adminTheme, 'light');
assert.equal(bootstrap('dark', true).dataset.adminTheme, 'light');

const page = createPage('dark');
assert.equal(page.root.dataset.adminTheme, 'dark');
assert.equal(page.root.style.colorScheme, 'dark');
assert.equal(page.attributes['aria-pressed'], 'true');
assert.equal(page.attributes['aria-label'], 'เปลี่ยนเป็นโหมดสว่าง');
assert.equal(page.toggle.title, 'เปลี่ยนเป็นโหมดสว่าง');
page.click();
assert.equal(page.root.dataset.adminTheme, 'light');
assert.equal(page.root.style.colorScheme, 'light');
assert.equal(page.attributes['aria-pressed'], 'false');
assert.equal(page.attributes['aria-label'], 'เปลี่ยนเป็นโหมดมืด');
assert.equal(page.values.get('lilteam_admin_theme'), 'light');
page.click();
assert.equal(page.root.dataset.adminTheme, 'dark');
assert.equal(page.values.get('lilteam_admin_theme'), 'dark');

const unavailableStoragePage = createPage('light', true);
assert.doesNotThrow(() => unavailableStoragePage.click());
assert.equal(unavailableStoragePage.root.dataset.adminTheme, 'dark');

const noButtonPage = {
  document: { documentElement: { dataset: { adminTheme: 'dark' } }, querySelector() { return null; } },
  localStorage: { setItem() { throw new Error('should not run'); } },
};
assert.doesNotThrow(() => vm.runInNewContext(toggleSource, noButtonPage));

console.log('Admin dark/light theme checks passed (saved preference, toggle, storage, and missing control).');
