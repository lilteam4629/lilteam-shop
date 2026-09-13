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
const backgrounds = theme.getBgPresets().map((item) => ({ bgPreset: item.key })).concat([
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
