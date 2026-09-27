'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const profilePrefix = path.join(os.tmpdir(), 'lilteam-admin-dark-audit-');
const dbPath = path.join(os.tmpdir(), `lilteam-admin-dark-audit-${process.pid}.json`);
const browserPath = findBrowser();
const profilePath = fs.mkdtempSync(profilePrefix);
let server;
let browser;
let cdp;
let dbPort;
let debugPort;

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
  const routes = [];
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
      if (!seen.has(nextPath)) queue.push(nextPath);
    }
  }
  if (routes.length < 15) throw new Error(`Only found ${routes.length} admin pages; expected at least 15.`);
  return routes;
}

class DevTools {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result || {});
        return;
      }
      for (const listener of this.events.get(message.method) || []) listener(message.params || {});
    });
  }

  async command(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket.close(); } catch (_) {}
  }
}

async function waitForDebugEndpoint(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Browser DevTools did not start.');
}

async function waitForPage() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await cdp.command('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (state.result?.value === 'complete') return;
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
  await cdp.command('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile,
  });
  await cdp.command('Page.navigate', { url: `http://127.0.0.1:${dbPort}${requestPath}` });
  await waitForPage();
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
      if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|OBJECT|EMBED|SVG|PATH|CIRCLE|RECT|LINE|POLYGON|POLYLINE)$/.test(el.tagName) || el.matches('.experiment-chart-bar, .admin-theme-swatch, .admin-theme-store, .welcome-live-save-indicator') || el.closest('[data-admin-dark-preserve], .admin-dark-mode-preserve') || !visible(el)) continue;
      const style = getComputedStyle(el);
      const bg = color(style.backgroundColor);
      const rect = el.getBoundingClientRect();
      if (rect.width > 3 && rect.height > 3 && isLightNeutral(bg)) {
        offenders.push({ tag: el.tagName.toLowerCase(), className: String(el.className || '').slice(0, 110), color: style.backgroundColor, marker: el.getAttribute('data-admin-dark-bg'), text: (el.childNodes.length && Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue.trim()).join(' ').slice(0, 60)) || '' });
      }
      if (rect.width > 3 && rect.height > 3 && !el.matches(semanticSurface) && !el.closest(semanticSurface) && isOffBlackNeutral(bg)) {
        offBlackNeutrals.push({ tag: el.tagName.toLowerCase(), className: String(el.className || '').slice(0, 110), color: style.backgroundColor, marker: el.getAttribute('data-admin-dark-bg') });
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
    const dynamicProbe = probe ? { background: getComputedStyle(probe).backgroundColor, color: getComputedStyle(probe).color, bgMarker: probe.getAttribute('data-admin-dark-bg'), inkMarker: probe.getAttribute('data-admin-dark-ink') } : null;
    const srgbProbe = document.querySelector('#admin-dark-srgb-probe');
    const dynamicSrgbProbe = srgbProbe ? { background: getComputedStyle(srgbProbe).backgroundColor, image: getComputedStyle(srgbProbe).backgroundImage, color: getComputedStyle(srgbProbe).color, bgMarker: srgbProbe.getAttribute('data-admin-dark-bg'), inkMarker: srgbProbe.getAttribute('data-admin-dark-ink') } : null;
    return { title: document.title, viewportWidth: innerWidth, status: body.innerText.trim().slice(0, 55), dark: root.dataset.adminTheme, toggle: !!document.querySelector('[data-admin-theme-toggle]'), bodyVisible: getComputedStyle(body).visibility !== 'hidden', booting: root.classList.contains('admin-theme-booting'), bootTrace: window.__adminDarkBootTrace || null, bodyClass: body.className, bodyBackground: getComputedStyle(body).backgroundColor, canvasBackground: getComputedStyle(root).backgroundColor, dynamicProbe, dynamicSrgbProbe, auditScript: auditScript && { src: auditScript.src, loaded: auditScript.readyState || 'present' }, scriptTransferSize: scriptTiming && scriptTiming.transferSize, markedBackgrounds: body.querySelectorAll('[data-admin-dark-bg]').length, lightSurfaces: offenders.slice(0, 8), offBlackNeutrals: offBlackNeutrals.slice(0, 8), lowContrast: lowContrast.slice(0, 8), lightSurfaceCount: offenders.length, offBlackNeutralCount: offBlackNeutrals.length, lowContrastCount: lowContrast.length };
  })()`);
  if (requestPath === '/admin') await cdp.command('Runtime.evaluate', { expression: `document.querySelector('#admin-dark-audit-probe')?.remove(); document.querySelector('.experiment-menu-dialog')?.close()` });
  return result;
}

async function cleanup() {
  if (cdp) cdp.close();
  if (browser && !browser.killed) browser.kill();
  if (server && !server.killed) server.kill();
  await new Promise(resolve => setTimeout(resolve, 400));
  try { fs.unlinkSync(dbPath); } catch (_) {}
  const resolvedProfile = path.resolve(profilePath);
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('lilteam-admin-dark-audit-')) {
    try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch (_) {}
  }
}

(async () => {
  dbPort = await freePort();
  debugPort = await freePort();
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

  browser = spawn(browserPath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-features=Translate,MediaRouter', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`, 'about:blank',
  ], { stdio: 'ignore' });
  const version = await waitForDebugEndpoint(debugPort);
  const targetsResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await targetsResponse.json();
  const target = targets.find(item => item.type === 'page');
  if (!target) throw new Error('Browser did not expose a page target.');
  cdp = new DevTools(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.command('Page.enable');
  await cdp.command('Runtime.enable');
  await cdp.command('Network.enable');
  await cdp.command('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] });
  await cdp.command('Network.setCookie', { name: cookieName, value: cookieValue, url: `http://127.0.0.1:${dbPort}` });
  await cdp.command('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('lilteam_admin_theme', 'dark'); } catch (_) {}\nwindow.__adminDarkBootTrace = { visibilityWhileBooting: null, visibilityAfterScan: null };\nconst bootTraceObserver = new MutationObserver(() => { const trace = window.__adminDarkBootTrace; const root = document.documentElement; if (!trace || !document.body) return; if (root.classList.contains('admin-theme-booting') && trace.visibilityWhileBooting === null) trace.visibilityWhileBooting = getComputedStyle(document.body).visibility; if (trace.visibilityWhileBooting !== null && !root.classList.contains('admin-theme-booting')) { trace.visibilityAfterScan = getComputedStyle(document.body).visibility; bootTraceObserver.disconnect(); } });\nbootTraceObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });` });

  const failures = [];
  let checked = 0;
  const routeLimit = Number(process.env.ADMIN_DARK_AUDIT_LIMIT) || routes.length;
  const viewports = [{ name: 'desktop', width: 1440, height: 1000, mobile: false }, { name: 'mobile', width: 390, height: 844, mobile: true }];
  for (const viewport of viewports) {
    for (const route of routes.slice(0, routeLimit)) {
      const result = await auditPage(route, viewport);
      checked += 1;
      const testedRoute = `${viewport.name}:${route}`;
      if (result.dark !== 'dark' || !result.toggle) failures.push({ route: testedRoute, problem: 'theme did not initialize or toggle missing', result });
      if (!result.bodyVisible || result.booting) failures.push({ route: testedRoute, problem: 'dark-mode first-paint cloak did not clear after the initial scan', result });
      if (!result.bootTrace || result.bootTrace.visibilityWhileBooting !== 'hidden' || result.bootTrace.visibilityAfterScan !== 'visible') failures.push({ route: testedRoute, problem: 'first content was not hidden until dark surfaces finished scanning', result: { bootTrace: result.bootTrace } });
      if (result.lightSurfaceCount || result.lowContrastCount) failures.push({ route: testedRoute, problem: 'computed colors remain too light / low contrast', result: { title: result.title, viewportWidth: result.viewportWidth, bodyClass: result.bodyClass, bodyBackground: result.bodyBackground, auditScript: result.auditScript, scriptTransferSize: result.scriptTransferSize, markedBackgrounds: result.markedBackgrounds, lightSurfaceCount: result.lightSurfaceCount, lowContrastCount: result.lowContrastCount, lightSurfaces: result.lightSurfaces, lowContrast: result.lowContrast } });
      if (result.offBlackNeutralCount) failures.push({ route: testedRoute, problem: 'neutral UI surfaces are not pure black', result: { offBlackNeutralCount: result.offBlackNeutralCount, offBlackNeutrals: result.offBlackNeutrals } });
      if (route === '/admin' && (!result.dynamicProbe || result.dynamicProbe.bgMarker !== 'surface' || result.dynamicProbe.inkMarker !== 'primary' || result.dynamicProbe.background !== 'rgb(0, 0, 0)')) {
        failures.push({ route: testedRoute, problem: 'new dynamic content did not inherit a dark surface and readable ink', result: { dynamicProbe: result.dynamicProbe } });
      }
      if (route === '/admin' && (!result.dynamicSrgbProbe || result.dynamicSrgbProbe.bgMarker !== 'surface' || result.dynamicSrgbProbe.inkMarker !== 'primary' || result.dynamicSrgbProbe.background !== 'rgb(0, 0, 0)' || result.dynamicSrgbProbe.image !== 'none')) {
        failures.push({ route: testedRoute, problem: 'modern sRGB colors did not get converted to black surfaces', result: { dynamicSrgbProbe: result.dynamicSrgbProbe } });
      }
      const bodyColor = result.bodyBackground.match(/([\d.]+)/g)?.slice(0, 3).map(Number) || [];
      if (bodyColor.length === 3 && bodyColor.some(channel => channel !== 0)) failures.push({ route: testedRoute, problem: 'admin canvas is not pure black', result });
    }
  }

  const firstRoute = routes[0];
  await cdp.command('Runtime.evaluate', { expression: `document.querySelector('[data-admin-theme-toggle]').click()` });
  await new Promise(resolve => setTimeout(resolve, 230));
  const lightMode = await evaluate(`(() => { const surfaces = Array.from(document.querySelectorAll('[data-admin-dark-bg]')).slice(0, 8).map(surface => ({ className: String(surface.className || ''), role: surface.dataset.adminDarkBg, color: getComputedStyle(surface).backgroundColor })); return { theme: document.documentElement.dataset.adminTheme, colorScheme: document.documentElement.style.colorScheme, saved: localStorage.getItem('lilteam_admin_theme'), surfaces }; })()`);
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

  const summary = failures.map(failure => ({
    route: failure.route,
    problem: failure.problem,
    lightSurfaceCount: failure.result?.lightSurfaceCount,
    lowContrastCount: failure.result?.lowContrastCount,
    offBlackNeutralCount: failure.result?.offBlackNeutralCount,
    bootTrace: failure.result?.bootTrace,
    dynamicSrgbProbe: failure.result?.dynamicSrgbProbe,
    toggleCheck: failure.result?.lightMode ? { lightMode: failure.result.lightMode, darkMode: failure.result.darkMode } : undefined,
    examples: [...(failure.result?.lightSurfaces || []), ...(failure.result?.offBlackNeutrals || []), ...(failure.result?.lowContrast || [])].slice(0, 4).map(example => ({ ...example, ancestors: example.ancestors?.slice(0, 3) })),
  }));
  console.log(JSON.stringify({ browser: path.basename(browserPath), browserVersion: version.Browser, adminPagesDiscovered: routes.length, viewportSizes: viewports.map(viewport => ({ name: viewport.name, width: viewport.width, height: viewport.height })), pagesChecked: checked, failureCount: failures.length, failures: summary.slice(0, 16), omittedFailures: Math.max(0, summary.length - 16) }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(cleanup);
