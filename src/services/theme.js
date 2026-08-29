// Storefront color theming — a shop picks one accent color (free choice)
// plus one background-tone preset (curated, so text stays readable no
// matter what's picked). Rendered as CSS variable overrides that replace
// the hardcoded :root / html.light blocks in layouts/main.ejs.

const BG_PRESETS = {
  warmDark: {
    label: 'มืดอบอุ่น (ค่าเริ่มต้น)',
    dark: { bg: '#100e08', card: '#1a160d', border: '#3a3220', borderLight: '#443a22', input: '#211c11', text: '#f3ecd8', text2: '#d6c9a0', text3: '#a89a6c', text4: '#7a6f47' },
    light: { bg: '#faf6eb', card: '#ffffff', border: '#e2d8bd', borderLight: '#d6c9a8', input: '#f3edd8', text: '#2a2414', text2: '#4a4028', text3: '#6b5e3d', text4: '#8a7c5c' },
  },
  navyDark: {
    label: 'มืดน้ำเงิน',
    dark: { bg: '#0a0e17', card: '#131a29', border: '#28344a', borderLight: '#324156', input: '#182034', text: '#e8ecf5', text2: '#c3ccdd', text3: '#8f9ab3', text4: '#616e88' },
    light: { bg: '#f4f6fb', card: '#ffffff', border: '#d7deec', borderLight: '#c5cfe3', input: '#eaeef8', text: '#161d2e', text2: '#333f57', text3: '#57657f', text4: '#7c88a0' },
  },
  trueBlack: {
    label: 'ดำสนิท',
    dark: { bg: '#050505', card: '#111111', border: '#2a2a2a', borderLight: '#363636', input: '#161616', text: '#f2f2f2', text2: '#cfcfcf', text3: '#999999', text4: '#666666' },
    light: { bg: '#f7f7f7', card: '#ffffff', border: '#dedede', borderLight: '#cfcfcf', input: '#ededed', text: '#161616', text2: '#3a3a3a', text3: '#5f5f5f', text4: '#828282' },
  },
  forestDark: {
    label: 'มืดเขียวป่า',
    dark: { bg: '#0a120d', card: '#121d16', border: '#293c30', borderLight: '#33493b', input: '#16241a', text: '#eaf3ec', text2: '#c6d9cc', text3: '#8fa799', text4: '#5f7568' },
    light: { bg: '#f5f9f5', card: '#ffffff', border: '#d7e5da', borderLight: '#c5d7c9', input: '#e9f1ea', text: '#132018', text2: '#31473a', text3: '#546b5c', text4: '#7a8f80' },
  },
  coolLight: {
    label: 'สว่างเย็นตา',
    dark: { bg: '#14161c', card: '#1e2129', border: '#3a3f4d', borderLight: '#454b5b', input: '#252932', text: '#eef0f5', text2: '#cdd2de', text3: '#98a0b3', text4: '#666e82' },
    light: { bg: '#f2f4f8', card: '#ffffff', border: '#dde1ea', borderLight: '#ccd2df', input: '#e8ebf2', text: '#1c1f27', text2: '#3d4351', text3: '#616a7d', text4: '#858ea3' },
  },
};

const ACCENT_PRESETS = [
  { key: 'gold', label: 'ทอง (ค่าเริ่มต้น)', color: '#c8a63f' },
  { key: 'amber', label: 'อำพัน', color: '#d9891f' },
  { key: 'crimson', label: 'แดงเลือดหมู', color: '#c0392b' },
  { key: 'rose', label: 'ชมพูกุหลาบ', color: '#d6547a' },
  { key: 'violet', label: 'ม่วง', color: '#8b5cf6' },
  { key: 'indigo', label: 'คราม', color: '#4f5fd6' },
  { key: 'azure', label: 'ฟ้า', color: '#2f8fd0' },
  { key: 'teal', label: 'ฟ้าอมเขียว', color: '#1f9c8c' },
  { key: 'emerald', label: 'เขียวมรกต', color: '#2ea86e' },
  { key: 'lime', label: 'เขียวมะนาว', color: '#7cb342' },
  { key: 'silver', label: 'เงิน', color: '#9aa1ac' },
];

function getBgPresets() {
  return Object.entries(BG_PRESETS).map(([key, p]) => ({ key, label: p.label }));
}

function getAccentPresets() {
  return ACCENT_PRESETS;
}

// Slightly lighten a hex color for the hover-state variant.
function lighten(hex, amount = 0.14) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
  const num = parseInt(clean, 16);
  const r = Math.min(255, Math.round(((num >> 16) & 255) + (255 - ((num >> 16) & 255)) * amount));
  const g = Math.min(255, Math.round(((num >> 8) & 255) + (255 - ((num >> 8) & 255)) * amount));
  const b = Math.min(255, Math.round((num & 255) + (255 - (num & 255)) * amount));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Renders the CSS variable declarations for a shop's chosen theme, to be
 * dropped straight into a <style> tag in place of the hardcoded defaults.
 */
function renderCss(theme) {
  const preset = BG_PRESETS[theme && theme.bgPreset] || BG_PRESETS.warmDark;
  const accent = (theme && /^#[0-9a-fA-F]{6}$/.test(theme.accent)) ? theme.accent : ACCENT_PRESETS[0].color;
  const accentHover = lighten(accent);
  const block = (vars) => `
      --bg: ${vars.bg};
      --card: ${vars.card};
      --border: ${vars.border};
      --border-light: ${vars.borderLight};
      --input: ${vars.input};
      --gold: ${accent};
      --gold-hover: ${accentHover};
      --text: ${vars.text};
      --text-2: ${vars.text2};
      --text-3: ${vars.text3};
      --text-4: ${vars.text4};
      --coral: #e2836f;`;
  return `:root {${block(preset.dark)}
    }
    html.light {${block(preset.light)}
    }`;
}

module.exports = { getBgPresets, getAccentPresets, renderCss };
