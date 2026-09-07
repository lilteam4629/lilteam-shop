// Mounted ONLY behind internal-api's server-to-server authentication.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const store = require('../data/store');
const license = require('../services/license');
const discord = require('../services/discord-bot');
const railway = require('../services/railway');
const router = express.Router();
const publicUser = u => ({ id: u.id, username: u.username, email: u.email, walletBalance: u.walletBalance });
const activeUser = id => store.data.users.find(u => u.id === id && u.status !== 'banned');
const managementLocks = new Set();
router.post('/auth/platform-admin', async (req, res, next) => {
  const username = String(req.body.username || '').trim();
  if (!username || username.length > 100) return res.status(400).json({ error: 'ชื่อผู้ดูแลไม่ถูกต้อง' });
  const key = username.toLowerCase();
  if (managementLocks.has(key)) return res.status(409).json({ error: 'กำลังเชื่อมต่อบัญชี กรุณาลองใหม่' });
  managementLocks.add(key);
  try {
    // Cloud has already checked its ADMIN_USERNAME/PASSWORD. Linking keeps
    // the existing balance, without resetting passwords or granting main-shop admin rights.
    let user = store.data.users.find(u => String(u.username).toLowerCase() === key);
    if (user?.status === 'banned') return res.status(403).json({ error: 'บัญชีนี้ถูกระงับ' });
    if (!user) {
      user = { id: store.genId(8), username, email: '', role: 'customer', status: 'active', walletBalance: 0,
        passwordHash: await bcrypt.hash(crypto.randomBytes(48).toString('hex'), 10), createdAt: new Date().toISOString() };
      store.data.users.push(user);
      await store.save();
    }
    res.json({ ok: true, user: publicUser(user) });
  } catch (error) { next(error); } finally { managementLocks.delete(key); }
});
function verifiedSale(sale) {
  return { ...sale, exp: license.isEnabled() ? license.verifyKey(sale.key).exp || null : null };
}
router.get('/admin/rentals', (req, res) => res.json({
  ok: true,
  rentedShops: [...store.data.shops].sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0)),
  sales: [...store.data.licenseSales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(verifiedSale),
  transactions: store.data.walletTransactions.filter(t => ['shop_purchase', 'shop_renewal', 'shop_purchase_refund'].includes(t.type))
    .map(t => ({ ...t, username: store.data.users.find(u => u.id === t.userId)?.username || t.userId }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  discordSettings: store.data.settings.discord || {}, discordConfigured: discord.isConfigured(), discordReady: discord.isReady(),
}));
router.post('/admin/rentals/:id/delete', async (req, res, next) => {
  try {
    const shop = store.data.shops.find(s => s.id === req.params.id);
    if (!shop) return res.status(404).json({ error: 'ไม่พบร้าน' });
    if (req.body.confirmName !== shop.name) return res.status(400).json({ error: 'ต้องพิมพ์ชื่อร้านให้ตรงก่อนลบ' });
    await store.deleteTenantDb(shop.id);
    store.data.shops = store.data.shops.filter(s => s.id !== shop.id);
    await store.save();
    res.json({ ok: true });
  } catch (error) { next(error); }
});
router.post('/admin/discord/settings', async (req, res, next) => {
  try {
    const values = { enabled: req.body.enabled === 'on' };
    for (const field of ['notifyChannelId', 'ticketPanelChannelId', 'ticketCategoryId', 'ticketLogChannelId', 'supportRoleId']) {
      values[field] = String(req.body[field] || '').trim();
      if (values[field] && !/^\d{15,22}$/.test(values[field])) return res.status(400).json({ error: 'Discord ID ไม่ถูกต้อง' });
    }
    store.data.settings.discord = values;
    await store.save();
    res.json({ ok: true });
  } catch (error) { next(error); }
});
router.post('/admin/discord/post-ticket-panel', async (req, res) => {
  try { await discord.postTicketPanel(); res.json({ ok: true }); }
  catch (error) { res.status(400).json({ error: error.message || 'โพสต์ไม่สำเร็จ' }); }
});
router.get('/payment-info', (req, res) => {
  const p = store.data.settings.payment || {};
  res.json({ ok: true, payment: { promptpayId: p.promptpayId || '', promptpayName: p.promptpayName || '',
    promptpayQrImage: p.promptpayQrImage || null, bankName: p.bankName || '', bankAccount: p.bankAccountNumber || '',
    bankAccountNumber: p.bankAccountNumber || '', bankAccountName: p.bankAccountName || '', bankQrImage: p.bankQrImage || null,
    truemoneyEnabled: p.truemoneyEnabled !== false && Boolean(p.truemoneyPhone),
    truemoneyPhone: p.truemoneyEnabled !== false && Boolean(p.truemoneyPhone) ? 'configured' : '',
    promptpayEnabled: p.slipProvider !== 'slipcheck' && p.slipProvider !== 'rdcw' && p.slipProvider !== 'slip2go' } });
});
router.get('/sales', (req, res) => {
  if (!activeUser(req.query.userId)) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  res.json({ ok: true, sales: store.data.licenseSales.filter(s => s.userId === req.query.userId).map(verifiedSale) });
});
router.get('/sales/:id', (req, res) => {
  const sale = activeUser(req.query.userId) && store.data.licenseSales.find(s => s.id === req.params.id && s.userId === req.query.userId);
  if (!sale) return res.status(404).json({ error: 'ไม่พบรายการ' });
  res.json({ ok: true, sale, exp: verifiedSale(sale).exp });
});
router.post('/sales/:id/sync', async (req, res) => {
  const sale = activeUser(req.body.userId) && store.data.licenseSales.find(s => s.id === req.params.id && s.userId === req.body.userId);
  if (!sale || sale.provisioning?.status !== 'success') return res.status(404).json({ error: 'ไม่พบเว็บหรือเว็บยังไม่พร้อม' });
  const railwayToken = String(req.body.railwayToken || '').trim();
  if (!railwayToken) return res.status(400).json({ error: 'กรุณากรอก Railway API Token' });
  const result = await railway.redeployService({ railwayToken, serviceId: sale.provisioning.serviceId, environmentId: sale.provisioning.environmentId });
  res.status(result.ok ? 200 : 400).json(result);
});
module.exports = router;
