'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const dbPath = path.join(os.tmpdir(), `lilteam-nav-audit-${process.pid}.json`);
let server;
let browser;

function findBrowser() {
  const candidates = [
    process.env.BROWSER_BIN,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('Set BROWSER_BIN to Edge or Chrome to run the navigation audit.');
  return found;
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

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.setTimeout(5000, () => req.destroy(new Error('local server timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error('Test server exited before becoming ready.');
    try { if (await request(port, '/health') === 200) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Test server did not become ready.');
}

async function auditViewport(port, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    try { localStorage.setItem('lilteam_theme', 'dark'); } catch (_) {}
  });
  await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle', timeout: 30000 });
  const initial = await page.evaluate(() => {
    window.__navigationAuditOriginalShell = document.querySelector('#site-page-shell');
    return {
      title: document.title,
      theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      bodyStylesheets: document.body.querySelectorAll('link[rel="stylesheet"]').length,
      headRouteStylesheets: document.head.querySelectorAll('link[data-route-stylesheet]').length,
    };
  });
  if (initial.theme !== 'dark') throw new Error(`${viewport.width}px storefront did not start in the saved dark theme.`);
  if (initial.bodyStylesheets) throw new Error(`${viewport.width}px storefront still has stylesheet links in <body>.`);

  let releaseStylesheet;
  let announceStylesheet;
  const cssRequested = new Promise(resolve => { announceStylesheet = resolve; });
  const cssGate = new Promise(resolve => { releaseStylesheet = resolve; });
  let cssRequests = 0;
  await page.route(/\/css\/storefront-catalog-shared-v[12]\.css(?:\?|$)/, async route => {
    cssRequests += 1;
    announceStylesheet();
    await cssGate;
    await route.continue();
  });

  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/products';
    link.id = 'navigation-audit-link';
    link.textContent = 'เปิดรายการสินค้า';
    document.body.appendChild(link);
    link.click();
  });

  await Promise.race([
    cssRequested,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Product-list CSS was not requested during navigation.')), 10000)),
  ]);
  await new Promise(resolve => setTimeout(resolve, 200));
  const waiting = await page.evaluate(() => ({
    url: location.pathname,
    oldShellStillVisible: window.__navigationAuditOriginalShell?.isConnected === true,
    navigationOverlay: document.documentElement.classList.contains('lilteam-navigating'),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    lightThemeFlashed: document.documentElement.classList.contains('light'),
  }));
  if (waiting.url !== '/' || !waiting.oldShellStillVisible) {
    releaseStylesheet();
    throw new Error(`${viewport.width}px page shell was replaced before destination CSS finished loading.`);
  }
  if (waiting.lightThemeFlashed || waiting.bodyBackground !== initial.bodyBackground) {
    releaseStylesheet();
    throw new Error(`${viewport.width}px navigation changed the canvas/theme while waiting for page CSS.`);
  }

  releaseStylesheet();
  await page.waitForURL(url => url.pathname === '/products', { timeout: 10000 });
  const finalState = await page.evaluate(() => ({
    bodyStylesheets: document.body.querySelectorAll('link[rel="stylesheet"]').length,
    routeStylesheets: Array.from(document.head.querySelectorAll('link[data-route-stylesheet]')).map(link => new URL(link.href).pathname),
    theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
    title: document.title,
  }));
  await context.close();

  if (finalState.bodyStylesheets) throw new Error(`${viewport.width}px destination left a stylesheet in <body>.`);
  if (!finalState.routeStylesheets.some(style => style.includes('storefront-catalog-shared'))) {
    throw new Error(`${viewport.width}px destination styles were not committed with the page.`);
  }
  if (finalState.theme !== 'dark') throw new Error(`${viewport.width}px navigation lost the saved theme.`);
  if (errors.length) throw new Error(`${viewport.width}px browser errors: ${errors.join('; ')}`);
  console.log(`${viewport.width}x${viewport.height}: destination CSS waited before swap; theme/canvas stayed stable; ${cssRequests} route stylesheet(s) loaded.`);
}

async function cleanup() {
  if (browser) { try { await browser.close(); } catch (_) {} }
  if (server && !server.killed) server.kill();
  await new Promise(resolve => setTimeout(resolve, 300));
  try { fs.unlinkSync(dbPath); } catch (_) {}
}

(async () => {
  const port = await freePort();
  server = spawn(process.execPath, ['src/app.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', TEST_DB_PATH: dbPath, MONGODB_URI: '', DISCORD_BOT_TOKEN: '', LICENSE_GATE: 'off' },
    stdio: 'ignore',
  });
  await waitForServer(port);
  browser = await chromium.launch({
    headless: true,
    executablePath: findBrowser(),
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-features=Translate,MediaRouter'],
  });
  await auditViewport(port, { width: 1440, height: 900 });
  await auditViewport(port, { width: 390, height: 844, isMobile: true, hasTouch: true });
  await cleanup();
  console.log('Storefront navigation audit passed.');
})().catch(async error => {
  console.error(error.stack || error);
  await cleanup();
  process.exitCode = 1;
});
