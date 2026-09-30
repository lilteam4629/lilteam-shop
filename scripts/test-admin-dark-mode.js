'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/css/admin-dark-mode-v1.css'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '../src/views/admin/dashboard-experiment.ejs'), 'utf8');
const adminLayout = fs.readFileSync(path.join(__dirname, '../src/views/layouts/admin-experiment.ejs'), 'utf8');
const legacyLayout = fs.readFileSync(path.join(__dirname, '../src/views/layouts/admin.ejs'), 'utf8');

function color(name) {
  const matches = Array.from(css.matchAll(new RegExp(`--${name}:\\s*(#[\\da-f]{6})`, 'gi')));
  assert.ok(matches.length, `missing ${name} dark theme token`);
  return matches[matches.length - 1][1];
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
assert.equal(canvas, '#0b0f14');
assert.equal(surface, '#151b22');
assert.equal(raised, '#1d2630');
assert.equal(input, '#202b36');
assert.ok(contrast(text, canvas) >= 7, 'primary text must remain clear on the page canvas');
assert.ok(contrast(muted, input) >= 4.5, 'muted labels and placeholders must remain readable');
assert.ok(contrast(line, canvas) >= 3, 'control borders must remain visible on the page canvas');
assert.match(css, /:root\[data-admin-theme="dark"\][\s\S]*?--card:\s*var\(--admin-dark-surface\)/);
assert.match(css, /html\[data-admin-theme="dark"\] body\.admin-site\s*\{[\s\S]*?--card:\s*var\(--admin-dark-surface\) !important/,
  'page-local theme tokens must inherit the dark palette');
assert.match(css, /:where\(main, #admin-content, \.admin-content\)[\s\S]*?color: var\(--admin-dark-text\) !important/,
  'older admin page copy must not keep fixed dark text');
assert.match(css, /\.experiment-button\.primary[\s\S]*?background-color: var\(--gold\) !important/,
  'primary actions need a visible dark-theme accent fill');
assert.match(css, /\.experiment-filter-radar-item\.sage[\s\S]*?background-color: #10261c !important/);
assert.match(css, /\.mgx-game-tab\.is-active[\s\S]*?background-color: #10261c !important/);
assert.match(css, /\.coupons-status\.active[\s\S]*?background-color: #10261c !important/);
assert.match(css, /\.users-more-action[\s\S]*?background-color: var\(--admin-dark-raised\) !important/);
assert.match(css, /:focus-visible[\s\S]*?outline-color: var\(--admin-brand-readable/,
  'keyboard focus must remain visible');
assert.match(css, /\.settings-storefront-stage/, 'do not recolor the embedded live storefront preview');
assert.match(css, /html\.admin-theme-switching[\s\S]*transition:\s*none !important/);
assert.doesNotMatch(css, /admin-dark-surface-audit-v1\.js/, 'dark mode must not depend on delayed recoloring scans');
assert.match(adminLayout, /admin-dark-mode-v1\.css/);
assert.match(legacyLayout, /admin-dark-mode-v1\.css/);
assert.match(dashboard, /lowStockProducts\.slice\(0,\s*24\)/);
assert.match(dashboard, /<template id="experiment-stock-alert-more">/);

console.log('Admin dark theme checks passed: layered contrast, scoped legacy tokens, readable buttons, representative page surfaces, preserved previews, and both layouts.');
