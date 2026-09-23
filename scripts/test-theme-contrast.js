'use strict';

const assert = require('node:assert/strict');
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
for (const background of backgrounds) {
  for (const accent of accents) {
    for (const vars of modeVariables(theme.renderCss({ ...background, accent }))) {
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
