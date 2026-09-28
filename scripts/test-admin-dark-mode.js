'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const css = fs.readFileSync(path.join(__dirname, '../public/css/admin-dark-mode-v1.css'), 'utf8');
const surfaceAudit = fs.readFileSync(path.join(__dirname, '../public/js/admin-dark-surface-audit-v1.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '../src/views/admin/dashboard-experiment.ejs'), 'utf8');
const adminLayout = fs.readFileSync(path.join(__dirname, '../src/views/layouts/admin-experiment.ejs'), 'utf8');

function color(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[\\da-f]{6})`, 'i'));
  assert.ok(match, `missing ${name} dark theme token`);
  return match[1];
}

function luminance(hex) {
  const values = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255);
  const channels = values.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const canvas = color('admin-dark-canvas');
const surface = color('admin-dark-surface');
const raised = color('admin-dark-raised');
const input = color('admin-dark-input');
const line = color('admin-dark-line');
const text = color('admin-dark-text');
const muted = color('admin-dark-muted');
assert.equal(canvas, '#000000', 'the admin canvas should stay pure black');
assert.deepEqual(new Set([canvas, surface, raised, input]), new Set(['#000000']), 'all dark-mode neutral fills must stay pure black');
assert.ok(contrast(text, surface) >= 7, 'primary text must remain clear on cards');
assert.ok(contrast(muted, input) >= 7, 'muted text must remain clear in form controls');
assert.ok(contrast(line, canvas) >= 4.5, 'control borders must remain visible against pure black');
assert.match(css, /html\[data-admin-theme="dark"\][\s\S]*?border-style:\s*solid;[\s\S]*?border-width:\s*1px;/, 'dark-mode controls need explicit visible outlines');
assert.doesNotMatch(css, /transition-property:\s*[^;]*background(?:-color)?/, 'theme changes must not fade through gray or white backgrounds');
assert.match(css, /transition-property:\s*border-color,\s*outline-color,\s*box-shadow,\s*opacity,\s*transform[^;]*!important/, 'dark mode may animate movement, but never background or text colors');

class Element {
  constructor(tagName = 'div') {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.childNodes = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.style = {};
    this.className = '';
    this.classList = { contains: (name) => this.className.split(/\s+/).includes(name) };
  }
  append(child) {
    child.parentElement = this;
    this.childNodes.push(child);
  }
  hasAttribute(name) { return this.attributes.has(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  matches() { return false; }
  closest() { return null; }
}

const html = new Element('html');
html.dataset = { adminTheme: 'dark' };
html.classList.remove = () => {};
const body = new Element('body');
body.className = 'experiment-admin';
const scanTargets = [];
for (let index = 0; index < 300; index += 1) {
  const child = new Element();
  body.append(child);
  scanTargets.push(child);
}
let mutationHandler;
let styleReads = 0;
const idleQueue = [];
const frameQueue = [];
const document = {
  documentElement: html,
  body,
  createTreeWalker(root) {
    const stack = root.childNodes.filter((node) => node.nodeType === 1).reverse();
    return {
      nextNode() {
        const next = stack.pop() || null;
        if (next) {
          for (let index = next.childNodes.length - 1; index >= 0; index -= 1) {
            if (next.childNodes[index].nodeType === 1) stack.push(next.childNodes[index]);
          }
        }
        return next;
      },
    };
  },
};
function MutationObserver(handler) { mutationHandler = handler; }
MutationObserver.prototype.observe = function () {};
const window = {
  NodeFilter: { SHOW_ELEMENT: 1 },
  __adminDarkSurfaceAuditComplete: undefined,
  getComputedStyle() {
    styleReads += 1;
    return { backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', color: 'rgb(255, 255, 255)', content: 'none' };
  },
  requestIdleCallback(callback) { idleQueue.push(callback); },
  requestAnimationFrame(callback) { frameQueue.push(callback); },
  setTimeout(callback) { idleQueue.push(callback); },
};
vm.runInNewContext(surfaceAudit, { document, window, MutationObserver, WeakMap, Date });
assert.equal(styleReads, 0, 'initial page scan must not read styles synchronously');
assert.equal(frameQueue.length, 1, 'the first viewport scan should run before the next paint');

frameQueue.shift()();
assert.ok(styleReads > 0 && styleReads < 300 * 3, 'the first paint scan must patch only a bounded part of the page');
assert.ok(idleQueue.length > 0, 'the remainder of the page scan should yield to idle time');
const runOneIdleSlice = () => idleQueue.shift()({ didTimeout: false, timeRemaining: () => 50 });
runOneIdleSlice();
assert.ok(styleReads < 300 * 3, 'the first idle slice must still process only part of the page');
while (idleQueue.length) runOneIdleSlice();
assert.ok(styleReads >= 300 * 3, 'the idle scan should eventually cover the full page');
assert.equal(window.__adminDarkSurfaceAuditComplete, true, 'the full page scan should expose a completion signal');

styleReads = 0;
mutationHandler([{ type: 'attributes', target: scanTargets[0], attributeName: 'style' }]);
assert.ok(styleReads > 0 && styleReads < 300 * 3, 'a local visible change should be corrected immediately without scanning the whole page');
assert.equal(idleQueue.length, 0, 'a local one-node rescan should finish in one slice');

assert.match(dashboard, /lowStockProducts\.slice\(0,\s*24\)/, 'the dashboard should initially render a bounded stock list');
assert.match(dashboard, /<template id="experiment-stock-alert-more">/, 'remaining stock items should be deferred');
assert.match(adminLayout, /list\.appendChild\(more\.content\)/, 'the expand control should reveal deferred stock items');
assert.match(adminLayout, /more\.remove\(\)/, 'expanded stock items should not be duplicated on later clicks');

console.log('Admin dark mode checks passed (black canvas, legible controls, idle DOM scan, and bounded dashboard rendering).');
