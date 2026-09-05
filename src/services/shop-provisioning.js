// Core "buy a plan -> get a real tenant shop" logic, shared by the web
// route (src/routes/tenant.js, used by the main site's own /start UI) and
// the internal API (src/routes/internal-api.js, used by the separate
// rent-app). Keeping this in one place means there is exactly one
// implementation of the sensitive parts — wallet debit, shop creation,
// refund-on-failure, per-user locking — instead of two copies that could
// silently drift apart.
const bcrypt = require('bcryptjs');
const store = require('../data/store');
const discordBot = require('./discord-bot');
const recaptcha = require('./recaptcha');
const { getShopUrl } = require('../middleware/tenant');

// A promo plan disappears on its own once it expires or sells out — no
// admin cleanup needed. Non-promo plans are unaffected.
function isPlanAvailable(plan) {
  if (!plan.active) return false;
  if (!plan.promo) return true;
  if (plan.promoExpiresAt && Date.now() > plan.promoExpiresAt) return false;
  if (plan.promoLimit && (plan.promoUsedCount || 0) >= plan.promoLimit) return false;
  return true;
}

function slugify(str) {
  return String(str || '').toLowerCase().trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const RESERVED_SLUGS = new Set([
  'www', 'admin', 'administrator', 'api', 'app', 'mail', 'email', 'smtp',
  'pop', 'imap', 'ftp', 'ssh', 'cpanel', 'webmail', 'media', 'cdn',
  'static', 'assets', 'public', 'cart', 'account', 'login', 'register',
  'auth', 'start', 'shop', 'tenant', 'license', 'system', 'root', 'bot',
  'discord', 'webhook', 'easyslip', 'slipok', 'promptpay', 'preview', 'my-shops',
  'rent', 'rent-website',
]);

// Keyed by userId — prevents the same buyer from double-submitting a
// purchase before the first one finishes (e.g. a slow network + impatient
// double-click). Only meaningful within this one process, which is fine:
// this logic only ever runs inside the main app (see the internal API
// design note in the plan — the separate rent-app never touches this
// module or the database directly, only this process does).
const tenantActionLocks = new Set();

async function provisionShop({ user, planId, shopName, adminUsername, adminPassword, recaptchaResponse, ip }) {
  if (tenantActionLocks.has(user.id)) {
    return { ok: false, error: 'ระบบกำลังดำเนินการรายการก่อนหน้า กรุณารอสักครู่' };
  }
  tenantActionLocks.add(user.id);
  try {
    if (!(await recaptcha.verify(recaptchaResponse, ip))) {
      return { ok: false, error: 'กรุณายืนยันแคปช่าให้ถูกต้อง' };
    }
    const plan = store.data.licensePlans.find(p => p.id === planId && isPlanAvailable(p));
    shopName = String(shopName || '').trim();
    adminUsername = String(adminUsername || '').trim();
    adminPassword = String(adminPassword || '');

    if (!plan) return { ok: false, error: 'กรุณาเลือกแพ็กเกจ' };
    if (!shopName) return { ok: false, error: 'กรุณากรอกชื่อร้าน' };
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(adminUsername)) {
      return { ok: false, error: 'ชื่อผู้ใช้แอดมินต้องเป็นตัวอักษร a-z, 0-9 และ _ เท่านั้น ยาว 3-20 ตัว' };
    }
    if (adminPassword.length < 8) {
      return { ok: false, error: 'รหัสผ่านแอดมินต้องมีอย่างน้อย 8 ตัวอักษร' };
    }
    if (user.walletBalance < plan.price) {
      return { ok: false, error: 'ยอดเครดิตไม่พอ กรุณาเติมเงินก่อน' };
    }

    let slug = slugify(shopName) || 'shop';
    if (RESERVED_SLUGS.has(slug) || store.data.shops.some(s => (s.slug || '').toLowerCase() === slug.toLowerCase())) {
      slug = `${slug}-${store.genId(4).toLowerCase()}`;
    }
    slug = slug.toLowerCase();

    user.walletBalance -= plan.price;
    if (plan.promo) plan.promoUsedCount = (plan.promoUsedCount || 0) + 1;
    store.data.walletTransactions.push({
      id: store.genId(10), userId: user.id, type: 'shop_purchase', amount: -plan.price,
      note: `เปิดร้านใหม่ "${shopName}" (${plan.days} วัน)`, createdAt: new Date().toISOString(),
    });

    const shopId = store.genId(10);
    const expiresAt = Date.now() + plan.days * 24 * 60 * 60 * 1000;
    store.data.shops.push({
      id: shopId, slug, name: shopName, ownerId: user.id, ownerUsername: user.username,
      expiresAt, createdAt: new Date().toISOString(),
    });
    await store.save();

    try {
      const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
      await store.createTenantDb(shopId, {
        shopName, adminUsername, adminEmail: user.email || `${adminUsername}@${slug}.local`,
        adminPasswordHash,
      });
    } catch (err) {
      store.data.shops = store.data.shops.filter(s => s.id !== shopId);
      user.walletBalance += plan.price;
      if (plan.promo && plan.promoUsedCount > 0) plan.promoUsedCount -= 1;
      store.data.walletTransactions.push({
        id: store.genId(10), userId: user.id, type: 'shop_purchase_refund', amount: plan.price,
        note: `คืนเครดิต — เปิดร้าน "${shopName}" ไม่สำเร็จ`, createdAt: new Date().toISOString(),
      });
      await store.save();
      return { ok: false, error: 'สร้างร้านไม่สำเร็จ ลองใหม่อีกครั้ง (คืนเครดิตให้แล้ว)' };
    }

    discordBot.notifyNewRental({
      shopName, ownerUsername: user.username, days: plan.days, price: plan.price, expiresAt,
    }).catch((err) => console.error('[discord-bot] notifyNewRental failed:', err));

    return { ok: true, shopId, slug, shopName, adminUsername, expiresAt, targetUrl: getShopUrl(slug) };
  } catch (err) {
    console.error('[provisionShop] error:', err);
    return { ok: false, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' };
  } finally {
    tenantActionLocks.delete(user.id);
  }
}

async function renewShop({ user, shopId, planId }) {
  if (tenantActionLocks.has(user.id)) {
    return { ok: false, error: 'ระบบกำลังดำเนินการรายการก่อนหน้า กรุณารอสักครู่' };
  }
  tenantActionLocks.add(user.id);
  try {
    const shop = store.data.shops.find(s => s.id === shopId && s.ownerId === user.id);
    const plan = store.data.licensePlans.find(p => p.id === planId && isPlanAvailable(p));
    if (!shop || !plan) return { ok: false, error: 'ไม่พบร้านหรือแพ็กเกจนี้' };
    if (user.walletBalance < plan.price) return { ok: false, error: 'ยอดเครดิตไม่พอ กรุณาเติมเงินก่อน' };

    user.walletBalance -= plan.price;
    if (plan.promo) plan.promoUsedCount = (plan.promoUsedCount || 0) + 1;
    store.data.walletTransactions.push({
      id: store.genId(10), userId: user.id, type: 'shop_renewal', amount: -plan.price,
      note: `ต่ออายุร้าน "${shop.name}" (${plan.days} วัน)`, createdAt: new Date().toISOString(),
    });
    const base = shop.expiresAt && Date.now() < shop.expiresAt ? shop.expiresAt : Date.now();
    shop.expiresAt = base + plan.days * 24 * 60 * 60 * 1000;
    await store.save();

    discordBot.notifyRenewal({
      shopName: shop.name, ownerUsername: user.username, days: plan.days, price: plan.price, expiresAt: shop.expiresAt,
    }).catch((err) => console.error('[discord-bot] notifyRenewal failed:', err));

    return { ok: true, shop };
  } catch (err) {
    console.error('[renewShop] error:', err);
    return { ok: false, error: 'เกิดข้อผิดพลาดในการต่ออายุ' };
  } finally {
    tenantActionLocks.delete(user.id);
  }
}

module.exports = { isPlanAvailable, slugify, RESERVED_SLUGS, tenantActionLocks, provisionShop, renewShop };
