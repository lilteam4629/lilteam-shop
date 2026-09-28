'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const dbPath = path.join(os.tmpdir(), `lilteam-admin-dark-audit-${process.pid}.json`);
const browserPath = findBrowser();
let server;
let browser;
let browserContext;
let browserPage;
let cdp;
let dbPort;

function findBrowser() {
  const candidates = [
    process.env.BROWSER_BIN,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('Install Microsoft Edge/Chrome or set BROWSER_BIN to run this browser audit.');
  return found;
}

function request(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || '';
    const headers = { ...(options.headers || {}) };
    if (body && headers['content-length'] === undefined) headers['content-length'] = Buffer.byteLength(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method: options.method || 'GET', headers }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, headers: response.headers, body: responseBody }));
    });
    req.setTimeout(options.timeout || 15000, () => req.destroy(new Error(`request timed out: ${requestPath}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(port) {
  for (let i = 0; i < 60; i += 1) {
    if (server.exitCode !== null) throw new Error('Local test server exited before it became ready.');
    try {
      const response = await request(port, '/login');
      if (response.statusCode === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local test server did not become ready.');
}

async function discoverAdminRoutes(cookie) {
  const queue = ['/admin'];
  const seen = new Set();
  const queuedRouteKeys = new Set(['/admin']);
  const routes = [];
  const routeKey = requestPath => new URL(requestPath, `http://127.0.0.1:${dbPort}`).pathname
    .replace(/\/(?:\d+|[a-f0-9]{24})(?=\/|$)/gi, '/:id');
  while (queue.length) {
    const requestPath = queue.shift();
    if (seen.has(requestPath)) continue;
    seen.add(requestPath);
    if (seen.size > 160) throw new Error('Admin route discovery exceeded its safety limit.');
    const page = await request(dbPort, requestPath, { headers: { cookie } });
    if (page.statusCode < 200 || page.statusCode >= 300) throw new Error(`${requestPath} returned HTTP ${page.statusCode}`);
    if (!page.headers['content-type']?.includes('text/html')) continue;
    if (!/class="experiment-admin admin-site(?:\s|")/.test(page.body)) continue;
    routes.push(requestPath);
    for (const match of page.body.matchAll(/href=["']([^"'#]+)["']/g)) {
      if (!match[1].startsWith('/admin')) continue;
      const url = new URL(match[1].replace(/&amp;/g, '&'), `http://127.0.0.1:${dbPort}`);
      const nextPath = url.pathname + url.search;
      const key = routeKey(nextPath);
      if (!seen.has(nextPath) && !queuedRouteKeys.has(key)) {
        queuedRouteKeys.add(key);
        queue.push(nextPath);
      }
    }
  }
  if (routes.length < 15) throw new Error(`Only found ${routes.length} admin pages; expected at least 15.`);
  return routes;
}

class DevTools {
  async command(method, params = {}) {
    if (method === 'Page.enable' || method === 'Runtime.enable' || method === 'Network.enable') return {};
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      await browserPage.addInitScript(params.source);
      return {};
    }
    if (method === 'Network.setCookie') {
      await browserContext.addCookies([{ name: params.name, value: params.value, url: params.url }]);
      return {};
    }
    if (method === 'Network.setBlockedURLs') {
      await browserPage.route(url => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.href), route => route.abort());
      return {};
    }
    if (method === 'Emulation.setDeviceMetricsOverride') {
      await browserPage.setViewportSize({ width: params.width, height: params.height });
      return {};
    }
    if (method === 'Page.navigate') {
      await browserPage.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return {};
    }
    if (method === 'Runtime.evaluate') {
      const value = await browserPage.evaluate(source => eval(source), params.expression);
      return { result: { value } };
    }
    throw new Error(`Unsupported browser audit operation: ${method}`);
  }
}

async function waitForPage() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await cdp.command('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (state.result?.value !== 'loading') return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('A page did not finish loading in the browser.');
}

async function evaluate(expression) {
  const response = await cdp.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Browser evaluation failed.');
  return response.result?.value;
}

async function auditPage(requestPath, viewport) {
  console.log(`Checking ${viewport.name} ${requestPath}`);
  await cdp.command('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile,
  });
  await cdp.command('Page.navigate', { url: `http://127.0.0.1:${dbPort}${requestPath}` });
  await waitForPage();
  // The theme is fully CSS-driven so dark surfaces are correct before paint;
  // no asynchronous DOM recoloring scan is required anymore.
  const surfaceScanComplete = true;
  if (requestPath === '/admin') {
    const probeResult = await cdp.command('Runtime.evaluate', { expression: `(() => { const dialog = document.querySelector('.experiment-menu-dialog'); if (dialog && !dialog.open) dialog.showModal(); const probe = document.createElement('div'); probe.id = 'admin-dark-audit-probe'; probe.textContent = 'probe'; probe.style.cssText = 'position:fixed;z-index:2147483647;left:2px;bottom:2px;width:40px;height:40px;background:#fff;color:#111'; document.body.appendChild(probe); const srgbProbe = document.createElement('div'); srgbProbe.id = 'admin-dark-srgb-probe'; srgbProbe.textContent = 'srgb'; srgbProbe.style.cssText = 'position:fixed;z-index:2147483647;left:48px;bottom:2px;width:40px;height:40px;background-color:color(srgb 0.92 0.91 0.87);background-image:linear-gradient(color(srgb 0.92 0.91 0.87),color(srgb 0.85 0.84 0.8));color:#111'; document.body.appendChild(srgbProbe); })()`, returnByValue: true });
    if (probeResult.exceptionDetails) throw new Error(probeResult.exceptionDetails.exception?.description || probeResult.exceptionDetails.text || 'Probe injection failed.');
  }
  await new Promise(resolve => setTimeout(resolve, 120));
  const result = await evaluate(`(() => {
    const body = document.body;
    const root = document.documentElement;
    const color = value => {
      const text = String(value || '');
      const match = text.match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+%?))?\\s*\\)/i);
      if (match) return { r: +match[1], g: +match[2], b: +match[3], a: match[4] ? (match[4].endsWith('%') ? +match[4].slice(0, -1) / 100 : +match[4]) : 1 };
      const srgb = text.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+%?))?\\s*\\)/i);
      if (!srgb) return null;
      return { r: +srgb[1] * 255, g: +srgb[2] * 255, b: +srgb[3] * 255, a: srgb[4] ? (srgb[4].endsWith('%') ? +srgb[4].slice(0, -1) / 100 : +srgb[4]) : 1 };
    };
    const linear = value => { const x = value / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    const lum = c => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
    const composite = (c, under) => ({ r: c.r * c.a + under.r * (1 - c.a), g: c.g * c.a + under.g * (1 - c.a), b: c.b * c.a + under.b * (1 - c.a) });
    const isLightNeutral = c => {
      if (!c || c.a < 0.12) return false;
      const visible = composite(c, { r: 0, g: 0, b: 0 });
      const spread = Math.max(visible.r, visible.g, visible.b) - Math.min(visible.r, visible.g, visible.b);
      return spread <= 48 && lum(visible) > 0.67;
    };
    const isOffBlackNeutral = c => {
      if (!c || c.a < 0.12) return false;
      const visible = composite(c, { r: 0, g: 0, b: 0 });
      const spread = Math.max(visible.r, visible.g, visible.b) - Math.min(visible.r, visible.g, visible.b);
      return spread <= 12 && lum(visible) > 0.001;
    };
    const isOffBlackNeutralGradient = value => {
      if (!value || value === 'none' || /url\\s*\\(/i.test(value)) return false;
      const tokens = value.match(/rgba?\\([^)]*\\)|color\\(srgb[^)]*\\)|#[\\da-f]{3,8}\\b/gi) || [];
      const colors = tokens.map(color).filter(candidate => candidate && candidate.a > .05);
      if (!colors.length || colors.some(candidate => {
        const channels = [candidate.r, candidate.g, candidate.b];
        return Math.max(...channels) - Math.min(...channels) > 48;
      })) return false;
      return colors.some(candidate => lum(composite(candidate, { r: 0, g: 0, b: 0 })) > 0.001);
    };
    const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
    const offenders = [];
    const offBlackNeutrals = [];
    const lowContrast = [];
    const semanticSurface = '[class*="success"], [class*="error"], [class*="danger"], [class*="warning"], [class*="pending"], [class*="status"], [class*="badge"], [class*="alert"], [class*="toast"], [class*="ready"], [class*="complete"], [class*="available"], .as-live-pill';
    const elements = Array.from(body.querySelectorAll('*'));
    const visible = el => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && +style.opacity !== 0;
    };
    for (const el of elements) {
      if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|OBJECT|EMBED|SVG|PATH|CIRCLE|RECT|LINE|POLYGON|POLYLINE)$/.test(el.tagName) || el.matches('input[type="color"], input[type="range"], .experiment-chart-bar, .admin-theme-swatch, .admin-theme-store, .welcome-live-save-indicator') || el.closest('.admin-theme-store, .model-preview-window, .admin-theme-effect-sample, .admin-theme-mono-color.is-white, .effects-stage, .admin-theme-swatch, [data-admin-dark-preserve], .admin-dark-mode-preserve') || !visible(el)) continue;
      const style = getComputedStyle(el);
      const bg = color(style.backgroundColor);
      const rect = el.getBoundingClientRect();
      if (rect.width > 3 && rect.height > 3 && isLightNeutral(bg)) {
        offenders.push({ tag: el.tagName.toLowerCase(), className: String(el.className || '').slice(0, 110), color: style.backgroundColor, marker: el.getAttribute('data-admin-dark-bg'), text: (el.childNodes.length && Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue.trim()).join(' ').slice(0, 60)) || '', ancestors: [el.parentElement, el.parentElement?.parentElement].filter(Boolean).map(parent => ({ tag: parent.tagName.toLowerCase(), className: String(parent.className || '').slice(0, 75) })) });
      }
      if (rect.width > 3 && rect.height > 3 && !el.matches(semanticSurface) && !el.closest(semanticSurface) && isOffBlackNeutral(bg)) {
        offBlackNeutrals.push({ tag: el.tagName.toLowerCase(), className: String(el.className || '').slice(0, 110), color: style.backgroundColor, marker: el.getAttribute('data-admin-dark-bg'), ancestors: [el.parentElement, el.parentElement?.parentElement].filter(Boolean).map(parent => ({ tag: parent.tagName.toLowerCase(), className: String(parent.className || '').slice(0, 75) })) });
      }
      if (rect.width > 3 && rect.height > 3 && !el.matches(semanticSurface) && !el.closest(semanticSurface) && isOffBlackNeutralGradient(style.backgroundImage)) {
        offBlackNeutrals.push({ tag: el.tagName.toLowerCase(), className: String(el.className || '').slice(0, 110), image: style.backgroundImage, marker: el.getAttribute('data-admin-dark-bg') });
      }
      let text = '';
      for (const node of el.childNodes) if (node.nodeType === 3 && node.nodeValue.trim()) text += node.nodeValue.trim() + ' ';
      if (!text) continue;
      const fg = color(style.color);
      if (!fg || fg.a < .2) continue;
      let parent = el;
      let bgColor = null;
      while (parent && parent !== body) {
        const parentStyle = getComputedStyle(parent);
        const candidate = color(parentStyle.backgroundColor);
        if (candidate && candidate.a > .92) { bgColor = composite(candidate, { r: 0, g: 0, b: 0 }); break; }
        parent = parent.parentElement;
      }
      if (!bgColor) bgColor = { r: 0, g: 0, b: 0 };
      if (contrast(composite(fg, bgColor), bgColor) < 4.49) {
        const ancestors = [];
        let current = el;
        while (current && current !== body && ancestors.length < 6) {
          const currentStyle = getComputedStyle(current);
          ancestors.push({ tag: current.tagName.toLowerCase(), className: String(current.className || '').slice(0, 75), background: currentStyle.backgroundColor, marker: current.getAttribute('data-admin-dark-bg') });
          current = current.parentElement;
        }
        lowContrast.push({ tag: el.tagName.toLowerCase(), className: String(el.className || '').slice(0, 100), color: style.color, background: bgColor, marker: el.getAttribute('data-admin-dark-ink'), text: text.slice(0, 75), ancestors });
      }
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === 'none' || ps.content === 'normal') continue;
        const pbg = color(ps.backgroundColor);
        if (rect.width > 3 && rect.height > 3 && isLightNeutral(pbg)) {
          offenders.push({ tag: el.tagName.toLowerCase() + pseudo, className: String(el.className || '').slice(0, 100), color: ps.backgroundColor, marker: el.getAttribute('data-admin-dark-' + (pseudo === '::before' ? 'before' : 'after') + '-bg') });
        }
        if (rect.width > 3 && rect.height > 3 && !el.matches(semanticSurface) && !el.closest(semanticSurface) && isOffBlackNeutral(pbg)) {
          offBlackNeutrals.push({ tag: el.tagName.toLowerCase() + pseudo, className: String(el.className || '').slice(0, 100), color: ps.backgroundColor, marker: el.getAttribute('data-admin-dark-' + (pseudo === '::before' ? 'before' : 'after') + '-bg') });
        }
        if (rect.width > 3 && rect.height > 3 && !el.matches(semanticSurface) && !el.closest(semanticSurface) && isOffBlackNeutralGradient(ps.backgroundImage)) {
          offBlackNeutrals.push({ tag: el.tagName.toLowerCase() + pseudo, className: String(el.className || '').slice(0, 100), image: ps.backgroundImage, marker: el.getAttribute('data-admin-dark-' + (pseudo === '::before' ? 'before' : 'after') + '-bg') });
        }
      }
    }
    const auditScript = Array.from(document.scripts).find(script => script.src.includes('admin-dark-surface-audit-v1.js'));
    const scriptTiming = performance.getEntriesByType('resource').find(entry => entry.name.includes('admin-dark-surface-audit-v1.js'));
    const probe = document.querySelector('#admin-dark-audit-probe');
    const probeTextContrast = element => { const foreground = color(getComputedStyle(element).color); return foreground ? contrast(composite(foreground, { r: 0, g: 0, b: 0 }), { r: 0, g: 0, b: 0 }) : 0; };
    const dynamicProbe = probe ? { background: getComputedStyle(probe).backgroundColor, color: getComputedStyle(probe).color, textContrast: probeTextContrast(probe), bgMarker: probe.getAttribute('data-admin-dark-bg'), inkMarker: probe.getAttribute('data-admin-dark-ink') } : null;
    const srgbProbe = document.querySelector('#admin-dark-srgb-probe');
    const dynamicSrgbProbe = srgbProbe ? { background: getComputedStyle(srgbProbe).backgroundColor, image: getComputedStyle(srgbProbe).backgroundImage, color: getComputedStyle(srgbProbe).color, textContrast: probeTextContrast(srgbProbe), bgMarker: srgbProbe.getAttribute('data-admin-dark-bg'), inkMarker: srgbProbe.getAttribute('data-admin-dark-ink') } : null;
    const selectorDiagnostics = ['.catalog-flow-steps i', '.catalog-selection-rule b', '.catalog-selector-filters b', '.catalog-image-open > span', '.announcement-filters button > span', '.users-audience-tabs .active b', '.coupons-create-note > span', '.effects-preview-foot > span', '.settings-preview-head > i', '[data-slip-owner-page] > [data-slip-owner-intro]', '.hsx-art-product'].flatMap(selector => Array.from(body.querySelectorAll(selector)).slice(0, 1).map(el => ({ selector, className: String(el.className || ''), matchesDarkSelector: el.matches('html[data-admin-theme="dark"] body.admin-site ' + selector), background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })));
    const fontTargets = [body, ...body.querySelectorAll('h1,h2,h3,button,[role="button"],input,select,textarea,label,.experiment-nav-item')].filter(visible);
    const wrongFonts = fontTargets.filter(el => {
      const expected = el.matches('code,kbd,samp,pre,.font-mono,[class*="mono"]') ? /JetBrains Mono|monospace/i : /^(?:'|")?Kanit(?:'|")?(?:\s*,|$)/i;
      return !expected.test(getComputedStyle(el).fontFamily.trim());
    });
    const buttonIssues = [];
    for (const control of Array.from(body.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')).filter(visible)) {
      const label = (control.innerText || control.value || control.getAttribute('aria-label') || '').trim();
      if (!label) continue;
      const rect = control.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) continue;
      const fg = color(getComputedStyle(control).color);
      let parent = control;
      let bg = null;
      while (parent && parent !== body) {
        const candidate = color(getComputedStyle(parent).backgroundColor);
        if (candidate && candidate.a > .92) { bg = composite(candidate, { r: 0, g: 0, b: 0 }); break; }
        parent = parent.parentElement;
      }
      if (fg && bg && contrast(composite(fg, bg), bg) < 4.49) buttonIssues.push({ label: label.slice(0, 55), className: String(control.className || '').slice(0, 80), foreground: getComputedStyle(control).color, background: bg });
    }
    return { title: document.title, viewportWidth: innerWidth, status: body.innerText.trim().slice(0, 55), dark: root.dataset.adminTheme, rootInlineBackground: root.style.backgroundColor, rootInlineTheme: root.dataset.adminTheme, toggle: !!document.querySelector('[data-admin-theme-toggle]'), bodyVisible: getComputedStyle(body).visibility !== 'hidden', booting: root.classList.contains('admin-theme-booting'), bootTrace: window.__adminDarkBootTrace || null, bodyClass: body.className, bodyBackground: getComputedStyle(body).backgroundColor, canvasBackground: getComputedStyle(root).backgroundColor, dynamicProbe, dynamicSrgbProbe, selectorDiagnostics, auditScript: auditScript && { src: auditScript.src, loaded: auditScript.readyState || 'present' }, scriptTransferSize: scriptTiming && scriptTiming.transferSize, markedBackgrounds: body.querySelectorAll('[data-admin-dark-bg]').length, fontFamilies: { body: getComputedStyle(body).fontFamily, heading: body.querySelector('h1,h2,h3') ? getComputedStyle(body.querySelector('h1,h2,h3')).fontFamily : null, button: body.querySelector('button') ? getComputedStyle(body.querySelector('button')).fontFamily : null }, wrongFontCount: wrongFonts.length, wrongFontSamples: wrongFonts.slice(0, 5).map(el => ({ tag: el.tagName, className: String(el.className || '').slice(0, 75), family: getComputedStyle(el).fontFamily })), buttonIssues: buttonIssues.slice(0, 6), buttonIssueCount: buttonIssues.length, lightSurfaces: offenders.slice(0, 8), offBlackNeutrals: offBlackNeutrals.slice(0, 8), lowContrast: lowContrast.slice(0, 8), lightSurfaceCount: offenders.length, offBlackNeutralCount: offBlackNeutrals.length, lowContrastCount: lowContrast.length };
  })()`);
  if (requestPath === '/admin') await cdp.command('Runtime.evaluate', { expression: `document.querySelector('#admin-dark-audit-probe')?.remove(); document.querySelector('.experiment-menu-dialog')?.close()` });
  const screenshotRoutes = String(process.env.ADMIN_DARK_AUDIT_SCREENSHOT_ROUTES || '').split(',').map(route => route.trim()).filter(Boolean);
  if (screenshotRoutes.includes(requestPath) && process.env.ADMIN_DARK_AUDIT_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.ADMIN_DARK_AUDIT_SCREENSHOT_DIR, { recursive: true });
    const fileName = `${requestPath.replace(/[^a-z0-9]+/gi, '-')}-${viewport.name}.png`;
    const screenshotPath = path.join(process.env.ADMIN_DARK_AUDIT_SCREENSHOT_DIR, fileName);
    await browserPage.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
    console.log(`SCREENSHOT ${screenshotPath}`);
  }
  result.surfaceScanComplete = surfaceScanComplete;
  return result;
}

async function cleanup() {
  if (browser) {
    try { await browser.close(); } catch (_) {}
  }
  if (server && !server.killed) server.kill();
  await new Promise(resolve => setTimeout(resolve, 400));
  try { fs.unlinkSync(dbPath); } catch (_) {}
}

(async () => {
  dbPort = await freePort();
  server = spawn(process.execPath, ['src/app.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(dbPort), NODE_ENV: 'test', TEST_DB_PATH: dbPath, MONGODB_URI: '', DISCORD_BOT_TOKEN: '', LICENSE_GATE: 'off' },
    stdio: 'ignore',
  });
  await waitForServer(dbPort);

  const login = await request(dbPort, '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=admin1234' });
  const setCookie = login.headers['set-cookie']?.[0];
  if (login.statusCode !== 302 || !setCookie) throw new Error(`Admin login failed (HTTP ${login.statusCode}).`);
  const cookie = setCookie.split(';')[0];
  const [cookieName, ...cookieValueParts] = cookie.split('=');
  const cookieValue = cookieValueParts.join('=');
  const routes = await discoverAdminRoutes(cookie);
  console.log(`Browser audit discovered ${routes.length} distinct admin page templates.`);

  console.log(`Starting isolated headless audit browser: ${path.basename(browserPath)}.`);
  browser = await chromium.launch({
    headless: true,
    executablePath: browserPath,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-features=Translate,MediaRouter'],
  });
  browserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  browserPage = await browserContext.newPage();
  cdp = new DevTools(browserPage);
  await cdp.command('Page.enable');
  await cdp.command('Runtime.enable');
  await cdp.command('Network.enable');
  await cdp.command('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] });
  await cdp.command('Network.setCookie', { name: cookieName, value: cookieValue, url: `http://127.0.0.1:${dbPort}` });
  await cdp.command('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('lilteam_admin_theme', 'dark'); } catch (_) {}\nwindow.__adminDarkBootTrace = { firstBodyVisibility: null, hiddenVisibilitySeen: false };\nconst bootTraceObserver = new MutationObserver(() => { const trace = window.__adminDarkBootTrace; if (!trace || !document.body) return; const visibility = getComputedStyle(document.body).visibility; if (trace.firstBodyVisibility === null) trace.firstBodyVisibility = visibility; if (visibility === 'hidden') trace.hiddenVisibilitySeen = true; });\nbootTraceObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });` });

  const failures = [];
  let checked = 0;
  const routeLimit = Number(process.env.ADMIN_DARK_AUDIT_LIMIT) || routes.length;
  const viewports = [{ name: 'desktop', width: 1440, height: 1000, mobile: false }, { name: 'mobile', width: 390, height: 844, mobile: true }];
  for (const viewport of viewports) {
    for (const route of routes.slice(0, routeLimit)) {
      const result = await auditPage(route, viewport);
      checked += 1;
      if (checked % 5 === 0 || checked === routes.length * viewports.length) {
        console.log(`Browser audit checked ${checked}/${Math.min(routeLimit, routes.length) * viewports.length} page views.`);
      }
      const testedRoute = `${viewport.name}:${route}`;
      if (result.dark !== 'dark' || !result.toggle) failures.push({ route: testedRoute, problem: 'theme did not initialize or toggle missing', result });
      if (!result.bodyVisible || result.booting || result.bootTrace?.hiddenVisibilitySeen) failures.push({ route: testedRoute, problem: 'admin content was hidden while the dark theme initialized', result: { bootTrace: result.bootTrace } });
      if (result.rootInlineTheme !== 'dark' || result.rootInlineBackground !== 'rgb(0, 0, 0)') failures.push({ route: testedRoute, problem: 'dark mode was not applied synchronously before the page styles', result: { rootInlineTheme: result.rootInlineTheme, rootInlineBackground: result.rootInlineBackground, bootTrace: result.bootTrace } });
      if (!result.surfaceScanComplete) failures.push({ route: testedRoute, problem: 'dark surface audit did not finish within 20 seconds', result: { title: result.title, bodyClass: result.bodyClass } });
      if (result.lightSurfaceCount || result.lowContrastCount) failures.push({ route: testedRoute, problem: 'computed colors remain too light / low contrast', result: { title: result.title, viewportWidth: result.viewportWidth, bodyClass: result.bodyClass, bodyBackground: result.bodyBackground, auditScript: result.auditScript, scriptTransferSize: result.scriptTransferSize, markedBackgrounds: result.markedBackgrounds, lightSurfaceCount: result.lightSurfaceCount, lowContrastCount: result.lowContrastCount, lightSurfaces: result.lightSurfaces, lowContrast: result.lowContrast } });
      if (result.offBlackNeutralCount) failures.push({ route: testedRoute, problem: 'neutral UI surfaces are not pure black', result: { offBlackNeutralCount: result.offBlackNeutralCount, offBlackNeutrals: result.offBlackNeutrals } });
      if (result.wrongFontCount) failures.push({ route: testedRoute, problem: 'admin text and controls do not consistently use Kanit', result: { fontFamilies: result.fontFamilies, wrongFontCount: result.wrongFontCount, wrongFontSamples: result.wrongFontSamples } });
      if (result.buttonIssueCount) failures.push({ route: testedRoute, problem: 'button labels are not readable against their surfaces', result: { buttonIssueCount: result.buttonIssueCount, buttonIssues: result.buttonIssues } });
    if (route === '/admin' && (!result.dynamicProbe || result.dynamicProbe.textContrast < 4.5 || result.dynamicProbe.background !== 'rgb(0, 0, 0)')) {
      failures.push({ route: testedRoute, problem: 'new dynamic content did not inherit a dark surface and readable ink', result: { dynamicProbe: result.dynamicProbe } });
    }
      if (route === '/admin' && (!result.dynamicSrgbProbe || result.dynamicSrgbProbe.textContrast < 4.5 || result.dynamicSrgbProbe.background !== 'rgb(0, 0, 0)' || result.dynamicSrgbProbe.image !== 'none')) {
        failures.push({ route: testedRoute, problem: 'modern sRGB colors did not get converted to black surfaces', result: { dynamicSrgbProbe: result.dynamicSrgbProbe } });
      }
      const bodyColor = result.bodyBackground.match(/([\d.]+)/g)?.slice(0, 3).map(Number) || [];
      if (bodyColor.length === 3 && bodyColor.some(channel => channel !== 0)) failures.push({ route: testedRoute, problem: 'admin canvas is not pure black', result });
      const rootColor = result.canvasBackground.match(/([\d.]+)/g)?.slice(0, 3).map(Number) || [];
      if (rootColor.length === 3 && rootColor.some(channel => channel !== 0)) failures.push({ route: testedRoute, problem: 'document canvas is not pure black', result: { canvasBackground: result.canvasBackground, rootClass: result.rootClass, dark: result.dark } });
    }
  }

  const firstRoute = routes[0];
  await cdp.command('Runtime.evaluate', { expression: `document.querySelector('[data-admin-theme-toggle]').click()` });
  await new Promise(resolve => setTimeout(resolve, 230));
  const lightMode = await evaluate(`(() => { const surfaces = Array.from(document.querySelectorAll('.experiment-content,main,.experiment-card,button,input,textarea')).filter(el => { const rect = el.getBoundingClientRect(); return rect.width > 8 && rect.height > 8 && getComputedStyle(el).display !== 'none'; }).slice(0, 8).map(surface => ({ className: String(surface.className || ''), tag: surface.tagName, color: getComputedStyle(surface).backgroundColor })); return { theme: document.documentElement.dataset.adminTheme, colorScheme: document.documentElement.style.colorScheme, saved: localStorage.getItem('lilteam_admin_theme'), surfaces }; })()`);
  await cdp.command('Runtime.evaluate', { expression: `document.querySelector('[data-admin-theme-toggle]').click()` });
  await new Promise(resolve => setTimeout(resolve, 230));
  const darkMode = await evaluate(`document.documentElement.dataset.adminTheme`);
  const restoredLightSurface = lightMode.surfaces.some(surface => {
    const channels = surface.color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
    return channels.length === 3 && Math.min(...channels) > 80;
  });
  if (lightMode.theme !== 'light' || lightMode.colorScheme !== 'light' || lightMode.saved !== 'light' || !restoredLightSurface || darkMode !== 'dark') {
    failures.push({ route: firstRoute, problem: 'light/dark toggle did not switch and persist correctly', result: { lightMode, darkMode } });
  }

  const problemCounts = failures.reduce((counts, failure) => {
    counts[failure.problem] = (counts[failure.problem] || 0) + 1;
    return counts;
  }, {});
  const summary = failures.map(failure => ({
    route: failure.route,
    problem: failure.problem,
    lightSurfaceCount: failure.result?.lightSurfaceCount,
    lowContrastCount: failure.result?.lowContrastCount,
    offBlackNeutralCount: failure.result?.offBlackNeutralCount,
    wrongFontCount: failure.result?.wrongFontCount,
    fontFamilies: failure.result?.fontFamilies,
    wrongFontSamples: failure.result?.wrongFontSamples,
    buttonIssueCount: failure.result?.buttonIssueCount,
    buttonIssues: failure.result?.buttonIssues,
    bootTrace: failure.result?.bootTrace,
    dynamicSrgbProbe: failure.result?.dynamicSrgbProbe,
    toggleCheck: failure.result?.lightMode ? { lightMode: failure.result.lightMode, darkMode: failure.result.darkMode } : undefined,
    examples: [...(failure.result?.lightSurfaces || []), ...(failure.result?.offBlackNeutrals || []), ...(failure.result?.lowContrast || [])].slice(0, 4).map(example => ({ ...example, ancestors: example.ancestors?.slice(0, 3) })),
  }));
  const findings = new Map();
  for (const failure of failures) {
    const categories = [
      ['light', failure.result?.lightSurfaces],
      ['off-black', failure.result?.offBlackNeutrals],
      ['contrast', failure.result?.lowContrast],
    ];
    for (const [kind, elements] of categories) {
      for (const element of elements || []) {
        const key = [kind, element.tag, element.className, element.color, element.image, element.text].join('|');
        if (!findings.has(key)) findings.set(key, { kind, tag: element.tag, className: element.className, color: element.color, image: element.image, text: element.text, background: element.background, routeSet: new Set(), ancestors: element.ancestors?.slice(0, 3) });
        findings.get(key).routeSet.add(failure.route);
      }
    }
  }
  const uniqueFindings = Array.from(findings.values()).map(finding => ({ ...finding, routes: Array.from(finding.routeSet) }));
  console.log(JSON.stringify({ browser: path.basename(browserPath), browserVersion: await browser.version(), adminPagesDiscovered: routes.length, viewportSizes: viewports.map(viewport => ({ name: viewport.name, width: viewport.width, height: viewport.height })), pagesChecked: checked, failureCount: failures.length, problemCounts, uniqueFindings, failures: summary.slice(0, 16), omittedFailures: Math.max(0, summary.length - 16) }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(cleanup);
