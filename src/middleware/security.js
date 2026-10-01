'use strict';
const crypto = require('node:crypto');
const net = require('node:net');
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
// Cloudflare's published proxy networks, checked 2026-10-01. Origin firewall must be verified separately.
const trustedProxies = ['loopback', 'linklocal', 'uniquelocal',
  '173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22',
  '141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20',
  '197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13',
  '104.24.0.0/14','172.64.0.0/13','131.0.72.0/22',
  '2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32',
  '2405:8100::/32','2a06:98c0::/29','2c0f:f248::/32'];
function equalSecret(a, b) {
  const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || ''));
  return right.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}
function addressKey(ip) {
  const raw = String(ip || 'unknown').replace(/^::ffff:/, '');
  if (net.isIP(raw) !== 6) return raw;
  // Canonicalize compressed IPv6, then group rotating interface addresses /64.
  const normalized = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
  const [left, right = ''] = normalized.split('::');
  const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
  const parts = normalized.includes('::') ? [...a, ...Array(8-a.length-b.length).fill('0'), ...b] : a;
  return parts.slice(0, 4).map(p => p.padStart(4, '0')).join(':');
}
function createLimiter({ limit, windowMs, maxKeys = 20000, key = req => addressKey(req.ip), clock = Date.now }) {
  const entries = new Map();
  let nextSweep = 0;
  return (req, res, next) => {
    const now = clock();
    if (now >= nextSweep) {
      for (const [id, entry] of entries) if (entry.until <= now) entries.delete(id);
      nextSweep = now + Math.min(windowMs, 30000);
    }
    const id = key(req); let entry = entries.get(id);
    if (!entry || entry.until <= now) {
      if (!entry && entries.size >= maxKeys) return res.status(503).set('Retry-After', '30').send('ระบบมีคำขอจำนวนมาก กรุณาลองใหม่ภายหลัง');
      entry = { count: 0, until: now + windowMs }; entries.set(id, entry);
    }
    if (++entry.count > limit) return res.status(429).set('Retry-After', String(Math.max(1, Math.ceil((entry.until-now)/1000)))).send('ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่');
    next();
  };
}
function headers(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '0', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // Preserve existing inline scripts/third-party assets; constrain document capabilities.
    'Content-Security-Policy': "base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'",
    'X-Security-Policy': 'lilteam-20261001'
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  if (/^\/(?:admin|account|wallet|my-shops|sales|login|register|internal\/api)(?:\/|$)/.test(req.path)) {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
  }
  next();
}
function sameOrigin(req, res, next) {
  if (SAFE.has(req.method) || /^\/internal\/api(?:\/|$)/.test(req.path)) return next();
  const source = req.get('Origin') || req.get('Referer');
  if (!source) {
    // CLI-only local tests may omit browser metadata. Production always fails closed.
    if (process.env.NODE_ENV !== 'production' && !req.get('Sec-Fetch-Site')) return next();
    return res.status(403).send('ยืนยันแหล่งที่มาของคำขอไม่ได้ กรุณารีเฟรชหน้าแล้วลองใหม่');
  }
  try {
    const origin = new URL(source), host = req.get('Host');
    if (origin.origin !== new URL(`${req.protocol}://${host}`).origin || origin.username || origin.password) throw new Error('origin');
    // Same-site sibling shops are deliberately NOT accepted as same-origin.
    if (req.get('Sec-Fetch-Site') === 'cross-site') throw new Error('fetch-site');
    return next();
  } catch { return res.status(403).send('ไม่อนุญาตคำสั่งจากเว็บไซต์อื่น กรุณาเปิดหน้าของเว็บนี้แล้วลองใหม่'); }
}
function requestFirewall(req, res, next) {
  // Never let a caller select another tenant using X-Forwarded-Host.
  delete req.headers['x-forwarded-host'];
  if (/\/(?:\.(?:env|git|svn)(?:[/.]|$)|(?:cloud-data|settings|db(?:\.shop\.[^/]+)?)\.json$)|^\/(?:data|src|node_modules|sessions)(?:\/|$)/i.test(req.path)) return res.sendStatus(404);
  if (Number(req.get('Content-Length')) > 70 * 1024 * 1024) return res.sendStatus(413);
  next();
}
function traffic() {
  const general = createLimiter({ limit: 1200, windowMs: 60000 });
  const dynamic = createLimiter({ limit: 300, windowMs: 60000 });
  const auth = createLimiter({ limit: 30, windowMs: 10 * 60000 });
  const signup = createLimiter({ limit: 10, windowMs: 60 * 60000 });
  const writes = createLimiter({ limit: 120, windowMs: 60000 });
  const payments = createLimiter({ limit: 30, windowMs: 60000 });
  return (req, res, next) => {
    general(req, res, () => {
      if (/^\/(?:css|js|images|fonts|media|uploads)(?:\/|$)/.test(req.path)) return next();
      dynamic(req, res, () => {
        if (SAFE.has(req.method) || /^\/internal\/api(?:\/|$)/.test(req.path)) return next();
        if (/^\/(?:admin\/)?login\/?$/.test(req.path)) return auth(req, res, next);
        if (req.path === '/register') return signup(req, res, next);
        writes(req, res, () => /\/(?:topup|wallet)(?:\/|$)/.test(req.path) ? payments(req, res, next) : next());
      });
    });
  };
}
function bindSession(req, res, next) {
  if (!req.session || (!req.session.userId && !req.session.siteScope)) return next();
  const scope = String(req.tenantShop?.id || 'platform');
  if (req.session.siteScope && req.session.siteScope !== scope) {
    return req.session.destroy(() => res.status(403).send('เซสชันนี้เป็นของอีกเว็บไซต์ กรุณาเข้าสู่ระบบใหม่'));
  }
  req.session.siteScope = scope;
  next();
}
function errorResponse(error, req, res, next) {
  if (res.headersSent) return next(error);
  const tooLarge = error.type === 'entity.too.large' || /^LIMIT_/.test(error.code || '');
  const status = tooLarge ? 413 : error.type === 'entity.parse.failed' ? 400 : 0;
  if (!status) return next(error);
  res.status(status).send(status === 413 ? 'ข้อมูลหรือไฟล์มีขนาดเกินกำหนด' : 'รูปแบบข้อมูลไม่ถูกต้อง');
}
module.exports = { trustedProxies, equalSecret, addressKey, createLimiter, headers, sameOrigin, requestFirewall, traffic, bindSession, errorResponse };
