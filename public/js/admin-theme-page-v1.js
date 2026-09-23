(() => {
  const page = document.querySelector('[data-admin-theme]');
  if (!page) return;

  const form = page.querySelector('[data-theme-form]');
  const preview = page.querySelector('[data-theme-store-preview]');
  const mainMono = page.dataset.mainMono === 'true';
  const accentPicker = page.querySelector('[data-theme-accent-picker]');
  const customAccent = page.querySelector('[data-theme-accent-custom]');
  const backgroundPicker = page.querySelector('[data-theme-background-picker]');
  const backgroundMode = page.querySelector('[data-theme-bg-mode]');
  const backgroundColor = page.querySelector('[data-theme-bg-color-value]');
  const customBackground = page.querySelector('[data-theme-bg-choice="custom"]');
  const status = page.querySelector('[data-theme-page-state]');
  const saveState = page.querySelector('[data-theme-save-state]');
  const actionState = page.querySelector('[data-theme-action-state]');
  const submitButton = page.querySelector('[data-theme-submit]');
  const presetNodes = Array.from(page.querySelectorAll('[data-theme-bg-seed]'));
  const accentOptions = Array.from(page.querySelectorAll('[data-theme-accent-choice]'));
  const backgroundOptions = Array.from(page.querySelectorAll('[data-theme-bg-choice]'));
  const monoSurfaceOptions = Array.from(page.querySelectorAll('[data-theme-mono-surface]'));
  const styleOptions = Array.from(page.querySelectorAll('[data-theme-style-choice]'));
  const isHex = value => /^#[0-9a-f]{6}$/i.test(String(value || ''));
  const defaultState = {
    accent: isHex(page.dataset.seedAccent) ? page.dataset.seedAccent : '#c8a63f',
    bgPreset: page.dataset.seedBgPreset || presetNodes[0]?.dataset.key || 'warmDark',
    bgColor: isHex(page.dataset.seedBgColor) ? page.dataset.seedBgColor : '',
    darkSurface: page.dataset.seedDarkSurface === 'white' ? 'white' : 'black',
    lightSurface: page.dataset.seedLightSurface === 'black' ? 'black' : 'white',
    style: page.dataset.seedStyle || 'normal',
  };
  const presetKeys = new Set(presetNodes.map(node => node.dataset.key));
  const styleKeys = new Set(styleOptions.map(node => node.value));
  let draft = mainMono
    ? { ...defaultState, bgPreset: page.dataset.mainBgPreset || presetNodes[0]?.dataset.key || 'monochrome', bgColor: '' }
    : { ...defaultState };
  let previewMode = 'dark';
  let dirty = false;

  function normalize(value) {
    return {
      accent: isHex(value.accent) ? value.accent : defaultState.accent,
      bgPreset: presetKeys.has(value.bgPreset) ? value.bgPreset : defaultState.bgPreset,
      bgColor: isHex(value.bgColor) ? value.bgColor : '',
      darkSurface: value.darkSurface === 'white' ? 'white' : 'black',
      lightSurface: value.lightSurface === 'black' ? 'black' : 'white',
      style: styleKeys.has(value.style) ? value.style : defaultState.style,
    };
  }

  function hexToRgb(hex) {
    const clean = String(hex).replace('#', '');
    return [0, 2, 4].map(offset => parseInt(clean.slice(offset, offset + 2), 16));
  }

  function rgbToHex(rgb) {
    return `#${rgb.map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
  }

  function mixHex(first, second, amount) {
    const a = hexToRgb(first);
    const b = hexToRgb(second);
    return rgbToHex(a.map((channel, index) => channel * (1 - amount) + b[index] * amount));
  }

  function hexToHsl(hex) {
    const [r, g, b] = hexToRgb(hex).map(channel => channel / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    let hue = 0;
    let saturation = 0;
    if (delta) {
      saturation = delta / (1 - Math.abs(2 * lightness - 1));
      if (max === r) hue = 60 * (((g - b) / delta) % 6);
      else if (max === g) hue = 60 * ((b - r) / delta + 2);
      else hue = 60 * ((r - g) / delta + 4);
    }
    return { h: (hue + 360) % 360, s: saturation, l: lightness };
  }

  function hslToHex(hue, saturation, lightness) {
    const h = ((hue % 360) + 360) % 360;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
    const m = lightness - chroma / 2;
    let channels;
    if (h < 60) channels = [chroma, x, 0];
    else if (h < 120) channels = [x, chroma, 0];
    else if (h < 180) channels = [0, chroma, x];
    else if (h < 240) channels = [0, x, chroma];
    else if (h < 300) channels = [x, 0, chroma];
    else channels = [chroma, 0, x];
    return rgbToHex(channels.map(value => (value + m) * 255));
  }

  function relativeLuminance(hex) {
    const channel = value => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = hexToRgb(hex).map(channel);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(first, second) {
    const a = relativeLuminance(first);
    const b = relativeLuminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function contrastText(hex) {
    const luminance = relativeLuminance(hex);
    const white = 1.05 / (luminance + 0.05);
    const black = (luminance + 0.05) / 0.05;
    return black >= white ? '#000000' : '#ffffff';
  }

  function readableAccent(accent, surfaces, minimum = 4.5) {
    if (surfaces.every(surface => contrastRatio(accent, surface) >= minimum)) return accent;
    const { h, s } = hexToHsl(accent);
    const darkBackground = surfaces.reduce((sum, surface) => sum + relativeLuminance(surface), 0) / surfaces.length < 0.4;
    const saturation = s < 0.05 ? 0 : Math.max(s, 0.35);
    for (let step = 1; step <= 20; step += 1) {
      const lightness = darkBackground ? 0.5 + step * 0.025 : 0.5 - step * 0.025;
      if (lightness < 0.04 || lightness > 0.96) break;
      const candidate = hslToHex(h, saturation, lightness);
      if (surfaces.every(surface => contrastRatio(candidate, surface) >= minimum)) return candidate;
    }
    return darkBackground ? '#f5f5f5' : '#111111';
  }

  function visibleAccent(accent, surfaces) {
    if (surfaces.every(surface => contrastRatio(accent, surface) >= 3)) return accent;
    if (hexToHsl(accent).s < 0.05) {
      const average = surfaces.reduce((sum, surface) => sum + relativeLuminance(surface), 0) / surfaces.length;
      return average < 0.4 ? '#ffffff' : '#000000';
    }
    return readableAccent(accent, surfaces, 3);
  }

  function customPalette(hex, mode) {
    const { h } = hexToHsl(hex);
    const shade = (saturation, lightness) => hslToHex(h, saturation, lightness);
    if (mode === 'dark') {
      return {
        bg: shade(0.46, 0.08), card: shade(0.46, 0.13), border: shade(0.46, 0.26),
        input: shade(0.46, 0.16), text: shade(0.08, 0.94), muted: shade(0.12, 0.63),
      };
    }
    return {
      bg: shade(0.5, 0.89), card: shade(0.35, 0.98), border: shade(0.4, 0.78),
      input: shade(0.42, 0.86), text: shade(0.1, 0.14), muted: shade(0.1, 0.4),
    };
  }

  function getPalette(mode) {
    if (mainMono) {
      const surface = (mode === 'dark' ? draft.darkSurface : draft.lightSurface) === 'white' ? 'white' : 'black';
      return surface === 'black'
        ? { bg: '#000000', card: '#000000', border: '#3a3a3a', input: '#000000', text: '#ffffff', muted: '#c2c2c2' }
        : { bg: '#ffffff', card: '#ffffff', border: '#dedede', input: '#ffffff', text: '#000000', muted: '#404040' };
    }
    if (draft.bgColor) return customPalette(draft.bgColor, mode);
    const preset = presetNodes.find(node => node.dataset.key === draft.bgPreset) || presetNodes[0];
    const paletteMode = mode === 'dark' ? 'dark' : 'light';
    const bg = preset?.dataset[`${paletteMode}Bg`] || (mode === 'dark' ? '#100e08' : '#faf6eb');
    const card = preset?.dataset[`${paletteMode}Card`] || '#ffffff';
    const text = preset?.dataset[`${paletteMode}Text`] || '#222222';
    return {
      bg,
      card,
      text,
      input: mode === 'dark' ? mixHex(bg, card, 0.24) : mixHex(bg, '#000000', 0.035),
      border: mode === 'dark' ? mixHex(bg, '#ffffff', 0.16) : mixHex(bg, '#000000', 0.12),
      muted: mode === 'dark' ? mixHex(text, bg, 0.28) : mixHex(text, bg, 0.38),
    };
  }

  function chosenBackgroundLabel() {
    if (mainMono) {
      const dark = draft.darkSurface === 'black' ? 'ดำ' : 'ขาว';
      const light = draft.lightSurface === 'black' ? 'ดำ' : 'ขาว';
      return `มืด: ${dark} · สว่าง: ${light}`;
    }
    if (draft.bgColor) return 'กำหนดเอง';
    const input = backgroundOptions.find(option => option.value === draft.bgPreset);
    return input?.closest('.admin-theme-background-option')?.querySelector('strong')?.textContent?.trim() || 'ธีมร้าน';
  }

  function chosenStyleLabel() {
    const input = styleOptions.find(option => option.value === draft.style);
    const label = input?.closest('.admin-theme-effect-option')?.querySelector('strong')?.textContent?.trim() || draft.style;
    return label.replace(/^[^\p{L}\p{N}]+/u, '').trim() || label;
  }

  function updatePreview() {
    const palette = getPalette(previewMode);
    const accentFill = visibleAccent(draft.accent, [palette.bg, palette.card, palette.input]);
    const accentText = readableAccent(draft.accent, [palette.bg, palette.card]);
    const accentHover = relativeLuminance(accentFill) < 0.5
      ? mixHex(accentFill, '#ffffff', 0.14)
      : mixHex(accentFill, '#000000', 0.12);
    const properties = {
      '--demo-bg': palette.bg,
      '--demo-card': palette.card,
      '--demo-border': palette.border,
      '--demo-input': palette.input,
      '--demo-text': palette.text,
      '--demo-muted': palette.muted,
      '--demo-accent': draft.accent,
      '--demo-accent-fill': accentFill,
      '--demo-accent-hover': accentHover,
      '--demo-accent-contrast': contrastText(accentFill),
      '--demo-accent-text': accentText,
    };
    Object.entries(properties).forEach(([key, value]) => preview.style.setProperty(key, value));
    preview.dataset.mode = previewMode;
    preview.dataset.style = draft.style;

    page.querySelector('[data-theme-current-dot]').style.backgroundColor = draft.accent;
    page.querySelector('[data-theme-current-accent]').textContent = draft.accent.toUpperCase();
    page.querySelector('[data-theme-summary-dot]').style.backgroundColor = draft.accent;
    page.querySelector('[data-theme-summary-accent]').textContent = draft.accent.toUpperCase();
    page.querySelector('[data-theme-summary-background]').textContent = chosenBackgroundLabel();
    page.querySelector('[data-theme-summary-style]').textContent = chosenStyleLabel();
  }

  function updateDirtyState() {
    dirty = JSON.stringify(draft) !== JSON.stringify(defaultState);
    status.dataset.dirty = String(dirty);
    saveState.textContent = dirty ? 'มีการเปลี่ยนแปลงที่ยังไม่บันทึก' : 'ค่าปัจจุบันของร้าน';
    actionState.textContent = dirty ? 'ตรวจตัวอย่างแล้วกดบันทึกเพื่อนำไปใช้' : 'ยังไม่มีการเปลี่ยนแปลง';
  }

  function syncControls() {
    const accentPreset = accentOptions.find(option => option.value.toLowerCase() === draft.accent.toLowerCase());
    accentOptions.forEach(option => { option.checked = option === accentPreset; });
    customAccent.checked = !accentPreset;
    customAccent.value = draft.accent;
    accentPicker.value = draft.accent;
    customAccentChoiceSync();

    const backgroundPreset = backgroundOptions.find(option => option.value === draft.bgPreset);
    backgroundOptions.forEach(option => { option.checked = !draft.bgColor && option === backgroundPreset; });
    if (customBackground) customBackground.checked = Boolean(draft.bgColor);
    if (backgroundPicker) backgroundPicker.value = draft.bgColor || '#365a4a';
    backgroundMode.value = draft.bgColor ? 'custom' : 'preset';
    backgroundColor.value = draft.bgColor;
    monoSurfaceOptions.forEach(option => {
      const key = option.dataset.themeMonoSurface === 'dark' ? 'darkSurface' : 'lightSurface';
      option.checked = option.value === draft[key];
    });

    styleOptions.forEach(option => { option.checked = option.value === draft.style; });
  }

  function customAccentChoiceSync() {
    customAccent.value = accentPicker.value;
  }

  accentOptions.forEach(option => option.addEventListener('change', () => {
    if (!option.checked) return;
    draft.accent = option.value;
    accentPicker.value = option.value;
    customAccent.value = option.value;
    updateDirtyState();
    updatePreview();
  }));

  accentPicker.addEventListener('input', () => {
    customAccent.value = accentPicker.value;
    customAccent.checked = true;
    draft.accent = accentPicker.value;
    updateDirtyState();
    updatePreview();
  });

  backgroundOptions.forEach(option => option.addEventListener('change', () => {
    if (!option.checked) return;
    if (option.value === 'custom') {
      draft.bgColor = backgroundPicker.value;
      backgroundMode.value = 'custom';
      backgroundColor.value = backgroundPicker.value;
    } else {
      draft.bgPreset = option.value;
      draft.bgColor = '';
      backgroundMode.value = 'preset';
      backgroundColor.value = '';
    }
    updateDirtyState();
    updatePreview();
  }));

  backgroundPicker?.addEventListener('input', () => {
    customBackground.checked = true;
    draft.bgColor = backgroundPicker.value;
    backgroundMode.value = 'custom';
    backgroundColor.value = backgroundPicker.value;
    updateDirtyState();
    updatePreview();
  });

  monoSurfaceOptions.forEach(option => option.addEventListener('change', () => {
    if (!option.checked) return;
    const key = option.dataset.themeMonoSurface === 'dark' ? 'darkSurface' : 'lightSurface';
    draft[key] = option.value === 'white' ? 'white' : 'black';
    updateDirtyState();
    updatePreview();
  }));

  styleOptions.forEach(option => option.addEventListener('change', () => {
    if (!option.checked) return;
    draft.style = option.value;
    updateDirtyState();
    updatePreview();
  }));

  page.querySelectorAll('[data-theme-preview-mode]').forEach(button => button.addEventListener('click', () => {
    previewMode = button.dataset.themePreviewMode;
    page.querySelectorAll('[data-theme-preview-mode]').forEach(modeButton => {
      modeButton.setAttribute('aria-pressed', String(modeButton === button));
    });
    updatePreview();
  }));

  form.addEventListener('submit', () => {
    customAccent.value = accentPicker.value;
    if (customBackground?.checked) {
      backgroundMode.value = 'custom';
      backgroundColor.value = backgroundPicker.value;
    }
    submitButton.disabled = true;
    const label = submitButton.querySelector('span');
    if (label) label.textContent = 'กำลังบันทึก…';
  });

  syncControls();
  updateDirtyState();
  updatePreview();
})();
