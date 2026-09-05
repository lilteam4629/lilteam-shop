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
  roseDark: {
    label: 'มืดชมพูเข้ม (LilTeam)',
    dark: { bg: '#1e0b11', card: '#30121b', border: '#612436', borderLight: '#732b40', input: '#3c1621', text: '#f1eeef', text2: '#d6cdcf', text3: '#ac959c', text4: '#86656e' },
    light: { bg: '#faf0f2', card: '#ffffff', border: '#e8cad1', borderLight: '#dcabb6', input: '#f5e4e8', text: '#291016', text2: '#471c26', text3: '#6a3240', text4: '#8c485a' },
  },
};

const ACCENT_PRESETS = [
  { key: 'gold', label: 'ทอง (ค่าเริ่มต้น)', color: '#c8a63f' },
  { key: 'champagne', label: 'แชมเปญ', color: '#e8c873' },
  { key: 'bronze', label: 'บรอนซ์', color: '#a9762f' },
  { key: 'amber', label: 'อำพัน', color: '#d9891f' },
  { key: 'orange', label: 'ส้ม', color: '#e0722b' },
  { key: 'crimson', label: 'แดงเลือดหมู', color: '#c0392b' },
  { key: 'ruby', label: 'ทับทิม', color: '#e0344e' },
  { key: 'rose', label: 'ชมพูกุหลาบ', color: '#d6547a' },
  { key: 'magenta', label: 'บานเย็น', color: '#c23bce' },
  { key: 'violet', label: 'ม่วง', color: '#8b5cf6' },
  { key: 'purple', label: 'ม่วงเข้ม', color: '#6d28d9' },
  { key: 'indigo', label: 'คราม', color: '#4f5fd6' },
  { key: 'azure', label: 'ฟ้า', color: '#2f8fd0' },
  { key: 'skyblue', label: 'ฟ้าใส', color: '#38bdf8' },
  { key: 'teal', label: 'ฟ้าอมเขียว', color: '#1f9c8c' },
  { key: 'mint', label: 'มินต์', color: '#2dd4a7' },
  { key: 'emerald', label: 'เขียวมรกต', color: '#2ea86e' },
  { key: 'green', label: 'เขียว', color: '#3f9142' },
  { key: 'lime', label: 'เขียวมะนาว', color: '#7cb342' },
  { key: 'yellow', label: 'เหลือง', color: '#e0b31e' },
  { key: 'brown', label: 'น้ำตาล', color: '#8a5a3a' },
  { key: 'slate', label: 'เทาน้ำเงิน', color: '#64748b' },
  { key: 'silver', label: 'เงิน', color: '#9aa1ac' },
  { key: 'black', label: 'ดำ', color: '#3a3a3a' },
];

const STYLE_LABELS = {
  normal: 'ปกติ',
  glow: '✨ เรืองแสง',
  gradient: '🌈 หลายสีปนกัน',
};

function getStyles() {
  return Object.entries(STYLE_LABELS).map(([key, label]) => ({ key, label }));
}

function getBgPresets() {
  return Object.entries(BG_PRESETS).map(([key, p]) => ({ key, label: p.label }));
}

function getAccentPresets() {
  return ACCENT_PRESETS;
}

// Slightly lighten a hex color for the hover-state variant (and a bigger
// lighten/darken pair for gradient boxes like the logo tile and quick-
// action icons, so those follow the chosen accent too instead of a
// hardcoded gold gradient).
function lighten(hex, amount = 0.14) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
  const num = parseInt(clean, 16);
  const r = Math.min(255, Math.round(((num >> 16) & 255) + (255 - ((num >> 16) & 255)) * amount));
  const g = Math.min(255, Math.round(((num >> 8) & 255) + (255 - ((num >> 8) & 255)) * amount));
  const b = Math.min(255, Math.round((num & 255) + (255 - (num & 255)) * amount));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function darken(hex, amount = 0.45) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
  const num = parseInt(clean, 16);
  const r = Math.max(0, Math.round(((num >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((num >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round((num & 255) * (1 - amount)));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToHsl(hex) {
  const clean = String(hex || '').replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = 60 * (((g - b) / d) % 6); break;
      case g: h = 60 * ((b - r) / d + 2); break;
      case b: h = 60 * ((r - g) / d + 4); break;
    }
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Generates a full dark+light bg preset tinted with a hue picked freely by
// the shop owner, instead of only the curated presets — near-black/near-
// white lightness kept for readability, just shifted toward the chosen hue.
function generateBgFromColor(hex) {
  const { h } = hexToHsl(hex);
  const dark = (l, s = 0.46) => hslToHex(h, s, l);
  const light = (l, s = 0.5) => hslToHex(h, s, l);
  return {
    dark: {
      bg: dark(0.08), card: dark(0.13), border: dark(0.26), borderLight: dark(0.31),
      input: dark(0.16), text: dark(0.94, 0.08), text2: dark(0.82, 0.1),
      text3: dark(0.63, 0.12), text4: dark(0.46, 0.14),
    },
    light: {
      bg: light(0.89, 0.5), card: light(0.98, 0.35), border: light(0.78, 0.4), borderLight: light(0.72, 0.4),
      input: light(0.86, 0.42), text: light(0.14, 0.1), text2: light(0.26, 0.1),
      text3: light(0.4, 0.1), text4: light(0.55, 0.1),
    },
  };
}

/**
 * Renders the CSS variable declarations for a shop's chosen theme, to be
 * dropped straight into a <style> tag in place of the hardcoded defaults.
 */
function renderCss(theme) {
  const customBg = theme && /^#[0-9a-fA-F]{6}$/.test(theme.bgColor) ? theme.bgColor : null;
  const preset = customBg ? generateBgFromColor(customBg) : (BG_PRESETS[theme && theme.bgPreset] || BG_PRESETS.warmDark);
  const accent = (theme && /^#[0-9a-fA-F]{6}$/.test(theme.accent)) ? theme.accent : ACCENT_PRESETS[0].color;
  const accentHover = lighten(accent);
  const accentLight = lighten(accent, 0.45);
  const accentDark = darken(accent, 0.42);
  const style = (theme && STYLE_LABELS[theme.style]) ? theme.style : 'normal';
  const { h: accentHue } = hexToHsl(accent);
  const gradA = accent, gradB = hslToHex(accentHue + 40, 0.75, 0.55), gradC = hslToHex(accentHue - 40, 0.75, 0.5);

  const block = (vars) => `
      --bg: ${vars.bg};
      --card: ${vars.card};
      --border: ${vars.border};
      --border-light: ${vars.borderLight};
      --input: ${vars.input};
      --gold: ${accent};
      --gold-hover: ${accentHover};
      --gold-light: ${accentLight};
      --gold-dark: ${accentDark};
      --text: ${vars.text};
      --text-2: ${vars.text2};
      --text-3: ${vars.text3};
      --text-4: ${vars.text4};
      --coral: #e2836f;`;

  let extra = '';
  if (style === 'glow') {
    // Matches elements whose class attribute contains the literal
    // "bg-[var(--gold)]" utility (an attribute-value substring match, not
    // a CSS class selector, so Tailwind's bracket syntax needs no escaping)
    // — adds a soft glow to every gold-filled button/badge across the site.
    extra = `
    a[class*="bg-[var(--gold)]"], button[class*="bg-[var(--gold)]"] {
      box-shadow: 0 0 16px 1px color-mix(in srgb, var(--gold) 55%, transparent), 0 0 32px color-mix(in srgb, var(--gold) 25%, transparent);
    }
    .premium-product-card, .ready-glow {
      box-shadow: 0 0 14px color-mix(in srgb, var(--gold) 35%, transparent);
    }`;
  } else if (style === 'gradient') {
    extra = `
    @keyframes theme-gradient-flow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
    a[class*="bg-[var(--gold)]"], button[class*="bg-[var(--gold)]"] {
      background: linear-gradient(120deg, ${gradA}, ${gradB}, ${gradC}, ${gradA}) !important;
      background-size: 300% 300%;
      animation: theme-gradient-flow 6s ease infinite;
    }`;
  }

  return `:root {${block(preset.dark)}
    }
    html.light {${block(preset.light)}
    }
    ${extra}`;
}

module.exports = { getBgPresets, getAccentPresets, getStyles, renderCss };
