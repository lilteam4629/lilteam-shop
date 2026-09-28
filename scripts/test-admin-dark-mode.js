'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/css/admin-dark-mode-v1.css'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '../src/views/admin/dashboard-experiment.ejs'), 'utf8');
const adminLayout = fs.readFileSync(path.join(__dirname, '../src/views/layouts/admin-experiment.ejs'), 'utf8');
const legacyLayout = fs.readFileSync(path.join(__dirname, '../src/views/layouts/admin.ejs'), 'utf8');

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
assert.equal(canvas, '#000000', 'dark canvas must be pure black');
assert.equal(surface, '#000000', 'dark panels must be pure black');
assert.equal(raised, '#000000', 'dark raised controls must be pure black');
assert.equal(input, '#000000', 'dark form fields must be pure black');
assert.ok(contrast(text, canvas) >= 7, 'primary text must remain clear on black');
assert.ok(contrast(muted, input) >= 4.5, 'muted labels and placeholders must remain readable');
assert.ok(contrast(line, canvas) >= 3, 'control borders must remain visible on the page canvas');
assert.match(css, /html\[data-admin-theme="dark"\] body\.admin-site[\s\S]*?border:\s*1px solid var\(--admin-dark-line\)/,
  'dark mode must apply readable, outlined controls to both admin layouts');
assert.match(css, /\.admin-theme-switch\s*\{[\s\S]*?min-height:\s*38px/, 'theme control must have a clear, usable target');
assert.doesNotMatch(css, /transition-property:\s*[^;]*background(?:-color)?/, 'theme changes must not fade through white backgrounds');
assert.match(css, /html\.admin-theme-switching[\s\S]*transition:\s*none\s*!important/, 'theme changes must disable transitions while colors update');
assert.match(css, /--admin-brand-fill:\s*var\(--admin-brand-fill-dark/, 'dark mode must use the selected store accent');
assert.ok(css.includes('[style*="background:#fff" i]'), 'inline white surfaces must be overridden before painting');
assert.ok(css.includes('[style*="background-color:color(srgb" i]'), 'modern inline color() fills must be overridden in pure-black mode');
assert.doesNotMatch(css, /admin-dark-surface-audit-v1\.js/, 'the dark theme must not depend on a delayed recoloring scan');
assert.match(adminLayout, /admin-dark-mode-v1\.css/);
assert.match(legacyLayout, /admin-dark-mode-v1\.css/);
assert.match(dashboard, /lowStockProducts\.slice\(0,\s*24\)/, 'the dashboard should initially render a bounded stock list');
assert.match(dashboard, /<template id="experiment-stock-alert-more">/, 'remaining stock items should be deferred');
assert.match(css, /color:\s*var\(--admin-brand-contrast-dark/, 'dark accent buttons must use the selected accent’s readable ink');
assert.match(css, /border-color:\s*#3b362f\s*!important/, 'ordinary dark-page borders should stay subdued');
assert.match(css, /\.effects-stage \*/, 'the live storefront preview must keep its chosen visual colors');
assert.match(css, /@layer admin-main-neutral-borders[\s\S]*?focus-visible[\s\S]*?outline:\s*2px solid var\(--admin-brand-readable/, 'dark mode must keep keyboard focus visible after neutral border rules');
assert.match(css, /effects-preview::before[\s\S]*?display:\s*none\s*!important/, 'dark effects settings should not retain decorative paper tape');
assert.match(dashboard, /experiment-chart-empty/, 'a zero-sales chart should have a helpful, compact empty state');

console.log('Admin dark theme checks passed: pure-black surfaces, readable controls, selected accent, no late DOM repaint, and bounded dashboard rendering.');
