'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const theme = require('../src/services/theme');

function variablesFrom(block) {
  return Object.fromEntries(Array.from(block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g), (m) => [m[1], m[2]]));
}

function modeVariables(css) {
  const root = css.match(/:root\s*\{([\s\S]*?)\n\s*\}/);
  const light = css.match(/html\.light\s*\{([\s\S]*?)\n\s*\}/);
  assert(root && light, 'renderCss must contain dark and light variable blocks');
  return [variablesFrom(root[1]), variablesFrom(light[1])];
}

const accents = theme.getAccentPresets().map((item) => item.color).concat(['#000000', '#ffffff', '#050505', '#fafafa']);
const backgrounds = theme.getBgPresets({ includeMain: true }).map((item) => ({ bgPreset: item.key })).concat([
  { bgColor: '#000000' },
  { bgColor: '#ffffff' },
  { bgColor: '#064e3b' },
  { bgColor: '#fef08a' },
]);

let checked = 0;
for (const accent of accents) {
  const adminCss = theme.renderAdminAccentCss({ accent });
  const fill = adminCss.match(/--admin-brand-fill:\s*(#[0-9a-f]{6})/i)?.[1];
  const text = adminCss.match(/--admin-brand-readable:\s*(#[0-9a-f]{6})/i)?.[1];
  const contrast = adminCss.match(/--admin-brand-contrast:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.match(adminCss, /^html\.admin-main-site\s*\{/,
    'admin accent variables must be scoped to the main-site root');
  assert(fill && text && contrast, `admin accent tokens missing for ${accent}`);
  assert(theme.contrastRatio(fill, '#ffffff') >= 4.5,
    `admin accent fill is not readable with white controls: ${accent}`);
  assert(theme.contrastRatio(text, '#ffffff') >= 4.5,
    `admin accent text is not readable on white surfaces: ${accent}`);
  assert(theme.contrastRatio(contrast, fill) >= 4.5,
    `admin accent foreground is not readable on its fill: ${accent}`);
  assert.doesNotMatch(adminCss, /--(?:bg|card|text):/,
    'admin accent CSS must not overwrite the separate admin surface palette');
}

const experimentLayout = fs.readFileSync(path.join(__dirname, '../src/views/layouts/admin-experiment.ejs'), 'utf8');
const legacyLayout = fs.readFileSync(path.join(__dirname, '../src/views/layouts/admin.ejs'), 'utf8');
const experimentCss = fs.readFileSync(path.join(__dirname, '../public/css/admin-experiment-v1.css'), 'utf8');
const couponCss = fs.readFileSync(path.join(__dirname, '../public/css/admin-experiment-coupons-v1.css'), 'utf8');
assert.match(experimentLayout, /admin-main-site/);
assert.match(experimentLayout, /adminBrandCss/);
assert.match(legacyLayout, /admin-main-site/);
assert.match(legacyLayout, /adminBrandCss/);
assert.match(experimentCss, /--ex-green:\s*var\(--admin-brand-fill,/);
assert.match(experimentCss, /--ex-green-dark:\s*var\(--admin-brand-readable,/);
assert.match(experimentCss, /--ex-green-soft:\s*var\(--admin-brand-soft,/);
assert.match(couponCss, /coupons-live-badge\{[^}]*color:#087a5b/s,
  'semantic live status color should remain independent of the brand accent');
console.log('Main admin accent wiring and tenant/status boundaries passed');

for (const background of backgrounds) {
  for (const accent of accents) {
    const renderedTheme = theme.renderCss({ ...background, accent });
    for (const vars of modeVariables(renderedTheme)) {
      assert(renderedTheme.includes(`--theme-page-surface: ${vars.bg};`), 'shared page surface must follow the selected theme');
      assert(renderedTheme.includes(`--theme-card-surface: ${vars.card};`), 'shared card surface must follow the selected theme');
      assert(renderedTheme.includes(`--theme-control-surface: ${vars.input};`), 'shared control surface must follow the selected theme');
      assert(renderedTheme.includes(`--theme-accent: ${vars.gold};`), 'shared accent must follow the contrast-safe selected accent');
      for (const surface of ['bg', 'card']) {
        assert(theme.contrastRatio(vars.text, vars[surface]) >= 4.5, `main text failed on ${surface}: ${accent}`);
        assert(theme.contrastRatio(vars['gold-text'], vars[surface]) >= 4.5, `accent text failed on ${surface}: ${accent}`);
      }
      assert(theme.contrastRatio(vars['gold-contrast'], vars.gold) >= 4.5, `accent button failed: ${accent}`);
      assert(theme.contrastRatio(vars['gold-hover-text'], vars['gold-hover']) >= 4.5, `accent hover failed: ${accent}`);
      for (const surface of ['bg', 'card', 'input']) {
        assert(theme.contrastRatio(vars.gold, vars[surface]) >= 3, `accent fill blends into ${surface}: ${accent}`);
      }
      for (const status of ['success', 'danger', 'warning']) {
        for (const surface of ['bg', 'card', 'input']) {
          assert(theme.contrastRatio(vars[status], vars[surface]) >= 4.5, `${status} failed on ${surface}: ${accent}`);
        }
      }
      checked += 1;
    }
  }
}

console.log(`Theme contrast checks passed: ${checked} dark/light palette combinations`);

const [darkMono, lightMono] = modeVariables(theme.renderCss({ bgPreset: theme.MAIN_BG_PRESET_KEY }));
assert.equal(darkMono.bg, '#000000', 'main dark-mode page background must be pure black');
assert.equal(darkMono.card, '#000000', 'main dark-mode card background must be pure black');
assert.equal(darkMono.input, '#000000', 'main dark-mode input background must be pure black');
assert.equal(lightMono.bg, '#ffffff', 'main light-mode page background must be pure white');
assert.equal(lightMono.card, '#ffffff', 'main light-mode card background must be pure white');
assert.equal(lightMono.input, '#ffffff', 'main light-mode input background must be pure white');
for (const darkSurface of ['black', 'white']) {
  for (const lightSurface of ['black', 'white']) {
    const [darkVars, lightVars] = modeVariables(theme.renderCss({
      bgPreset: theme.MAIN_BG_PRESET_KEY,
      mainMonoSurfaces: { dark: darkSurface, light: lightSurface },
    }));
    assert.equal(darkVars.bg, darkSurface === 'black' ? '#000000' : '#ffffff', `dark surface selection ${darkSurface}`);
    assert.equal(lightVars.bg, lightSurface === 'black' ? '#000000' : '#ffffff', `light surface selection ${lightSurface}`);
    for (const vars of [darkVars, lightVars]) {
      for (const surface of ['bg', 'card', 'input']) {
        assert(theme.contrastRatio(vars.text, vars[surface]) >= 4.5, `monochrome text contrast failed for ${vars[surface]}`);
      }
    }
  }
}
assert.equal(theme.getBgPresets().some((item) => item.key === theme.MAIN_BG_PRESET_KEY), false, 'tenant preset list must not gain the main-only palette');
assert.deepEqual(theme.getBgPresets({ mainShopOnly: true }).map((item) => item.key), [theme.MAIN_BG_PRESET_KEY]);
console.log('Main-shop monochrome surfaces and tenant palette isolation passed');

const mainLayout = fs.readFileSync(path.join(__dirname, '../src/views/layouts/main.ejs'), 'utf8');
assert(mainLayout.includes("asset('css/storefront-theme-cohesion-v1.css')"), 'every storefront page must load the shared theme layer');
assert(fs.existsSync(path.join(__dirname, '../public/css/storefront-theme-cohesion-v1.css')), 'shared storefront theme layer must exist');
console.log('Shared storefront theme layer is connected to the public layout');

const legacyNavbarCss = fs.readFileSync(path.join(__dirname, '../public/css/storefront-navbar-v1.css'), 'utf8');
const cozyNavbarCss = fs.readFileSync(path.join(__dirname, '../public/css/storefront-navbar-cozy-v2.css'), 'utf8');
assert.match(legacyNavbarCss, /html:not\(\.light\) \.store-nav__wallet[^}]*background:var\(--card\)!important/,
  'legacy dark-mode wallet rule remains the cascade source that must be guarded');
const cozyDarkWalletRule = cozyNavbarCss.match(/html:not\(\.light\) \.store-nav--cozy-owner \.store-nav__wallet\s*\{([^}]*)\}/);
assert(cozyDarkWalletRule, 'main-shop wallet needs an explicit dark-mode cascade guard');
assert.match(cozyDarkWalletRule[1], /background:\s*transparent\s*!important/,
  'main-shop wallet must leave its selected-color surface to the surrounding group');
assert.match(cozyDarkWalletRule[1], /color:\s*var\(--theme-ink,\s*var\(--text\)\)\s*!important/,
  'main-shop wallet text must follow the active theme in dark mode');
console.log('Main-shop wallet theme cascade checks passed');
