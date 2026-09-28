'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const bootstrapSource = fs.readFileSync(path.join(__dirname, '../public/js/admin-theme-bootstrap-v1.js'), 'utf8');
const toggleSource = fs.readFileSync(path.join(__dirname, '../public/js/admin-theme-toggle-v1.js'), 'utf8');

function bootstrap(savedTheme, storageThrows = false) {
  const classNames = new Set();
  const root = {
    dataset: {},
    style: {},
    classList: {
      add(name) { classNames.add(name); },
      remove(name) { classNames.delete(name); },
      contains(name) { return classNames.has(name); },
    },
  };
  let bootTimeouts = 0;
  const localStorage = {
    getItem(key) {
      assert.equal(key, 'lilteam_admin_theme');
      if (storageThrows) throw new Error('storage unavailable');
      return savedTheme;
    },
  };
  vm.runInNewContext(bootstrapSource, {
    document: { documentElement: root },
    localStorage,
    window: { setTimeout() { bootTimeouts += 1; } },
  });
  root.bootTimeouts = bootTimeouts;
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
const lightBoot = bootstrap('light');
assert.equal(lightBoot.dataset.adminTheme, 'light');
assert.equal(lightBoot.classList.contains('admin-theme-booting'), false);
const invalidBoot = bootstrap('invalid');
assert.equal(invalidBoot.dataset.adminTheme, 'light');
assert.equal(invalidBoot.classList.contains('admin-theme-booting'), false);
const unavailableStorageBoot = bootstrap('dark', true);
assert.equal(unavailableStorageBoot.dataset.adminTheme, 'light');
assert.equal(unavailableStorageBoot.classList.contains('admin-theme-booting'), false);
const darkBoot = bootstrap('dark');
assert.equal(darkBoot.dataset.adminTheme, 'dark');
assert.equal(darkBoot.classList.contains('admin-theme-booting'), false);
assert.equal(darkBoot.bootTimeouts, 0);

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
