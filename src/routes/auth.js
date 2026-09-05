const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const store = require('../data/store');
const recaptcha = require('../services/recaptcha');

function safeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeEnvironmentValue(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

const loginAttempts = new Map();
function isLoginAllowed(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return true;
  if (now > entry.resetAt) {
    loginAttempts.delete(key);
    return true;
  }
  return entry.count < 8;
}
function recordFailedAttempt(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + 5 * 60 * 1000 };
  entry.count += 1;
  loginAttempts.set(key, entry);
}
function clearAttempts(key) {
  loginAttempts.delete(key);
}

router.get('/login', (req, res) => {
  res.render('shop/login', { title: 'เข้าสู่ระบบ' });
});

router.post('/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!isLoginAllowed(ip)) {
    req.flash('error', 'คุณพยายามเข้าสู่ระบบผิดพลาดหลายครั้งเกินไป กรุณารอ 5 นาทีแล้วลองใหม่');
    return res.redirect('/login');
  }

  const password = req.body.password;
  const username = (req.body.username || '').trim();
  const usernameLower = username.toLowerCase();
  const user = store.data.users.find(u =>
    (u.username || '').toLowerCase() === usernameLower || (u.email || '').toLowerCase() === usernameLower);

  // Hosted emergency-admin access uses Railway's environment value directly.
  // This avoids stale/corrupt password hashes while keeping the secret out of Git.
  const managedUsername = normalizeEnvironmentValue(process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const managedPassword = normalizeEnvironmentValue(process.env.ADMIN_PASSWORD);
  if (managedPassword && usernameLower === managedUsername && safeTextEqual(password, managedPassword)) {
    const managedAdmin = store.data.users.find(u => (u.username || '').toLowerCase() === managedUsername && u.role === 'admin');
    if (managedAdmin) {
      clearAttempts(ip);
      await regenerateSession(req);
      req.session.userId = managedAdmin.id;
      req.flash('success', `ยินดีต้อนรับ ${managedAdmin.username}`);
      return res.redirect('/admin');
    }
  }

  const isPasswordValid = user && (await bcrypt.compare(password || '', user.passwordHash));
  if (!user || !isPasswordValid) {
    recordFailedAttempt(ip);
    req.flash('error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    return res.redirect('/login');
  }
  if (user.status === 'banned') {
    req.flash('error', 'บัญชีนี้ถูกระงับการใช้งาน');
    return res.redirect('/login');
  }

  clearAttempts(ip);
  await regenerateSession(req);
  req.session.userId = user.id;
  req.flash('success', `ยินดีต้อนรับ ${user.username}`);
  res.redirect(user.role === 'admin' ? '/admin' : '/');
});

router.get('/register', (req, res) => {
  res.render('shop/register', { title: 'สมัครสมาชิก', recaptchaSiteKey: recaptcha.siteKey() });
});

router.post('/register', async (req, res) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim();
  const { password, confirmPassword } = req.body;
  if (!username || !email || !password) {
    req.flash('error', 'กรุณากรอกข้อมูลให้ครบถ้วน');
    return res.redirect('/register');
  }
  if (!(await recaptcha.verify(req.body['g-recaptcha-response'], req.ip))) {
    req.flash('error', 'กรุณายืนยันแคปช่าให้ถูกต้อง');
    return res.redirect('/register');
  }
  if (password !== confirmPassword) {
    req.flash('error', 'รหัสผ่านไม่ตรงกัน');
    return res.redirect('/register');
  }
  if (store.data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    req.flash('error', 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
    return res.redirect('/register');
  }
  if (store.data.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    req.flash('error', 'อีเมลนี้ถูกใช้งานแล้ว');
    return res.redirect('/register');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: store.genId(8),
    username,
    email,
    passwordHash,
    role: 'customer',
    walletBalance: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  store.data.users.push(user);
  await store.save();

  await regenerateSession(req);
  req.session.userId = user.id;
  req.flash('success', 'สมัครสมาชิกสำเร็จ! ยินดีต้อนรับสู่ ' + store.data.settings.shopName);
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

module.exports = router;
