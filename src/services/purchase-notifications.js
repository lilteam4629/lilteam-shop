const axios = require('axios');

function config(settings = {}) {
  const saved = settings.purchaseNotifications || {};
  return { storefrontEnabled: saved.storefrontEnabled !== false, webhookUrl: String(saved.webhookUrl || '') };
}

function isPurchaseWebhookUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'].includes(url.hostname)
      && /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname);
  } catch (_) { return false; }
}

function recentPurchases(data, now = Date.now()) {
  if (!config(data.settings).storefrontEnabled) return [];
  const users = new Map(data.users.map(user => [user.id, user]));
  return data.orders.filter(order => ['completed', 'pending'].includes(order.status)
    && order.salesChannel !== 'catalog-api-fulfillment' && order.items?.length
    && Date.parse(order.createdAt) <= now && Date.parse(order.createdAt) > now - 10 * 60 * 1000)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5)
    .map(order => ({
      id: order.id,
      buyer: `${String(users.get(order.userId)?.username || 'ลูกค้า').slice(0, 2)}***`,
      title: String(order.items[0].title || 'สินค้า').slice(0, 160),
      quantity: order.items.length,
      createdAt: order.createdAt,
    }));
}

// Call only after payment/order persistence. A webhook failure cannot undo a sale.
async function notifyPurchase({ data, order, user }) {
  const webhookUrl = config(data.settings).webhookUrl;
  if (!isPurchaseWebhookUrl(webhookUrl)) return;
  const clip = value => String(value || '-').slice(0, 1000);
  const products = new Map();
  for (const item of order.items || []) products.set(item.title, (products.get(item.title) || 0) + 1);
  const embed = {
    title: 'มีคนซื้อสินค้า — ชำระเงินสำเร็จ', color: 0x2ecc71,
    fields: [
      { name: 'ร้าน', value: clip(data.settings.shopName) },
      { name: 'คำสั่งซื้อ', value: clip(`#${order.id}`), inline: true },
      { name: 'ผู้ซื้อ', value: clip(user?.username || 'ลูกค้าร้านเช่า'), inline: true },
      { name: 'สินค้า', value: clip([...products].map(([title, qty]) => `${title} × ${qty}`).join('\n')) },
      { name: 'ยอดชำระ', value: `฿${Number(order.total || 0).toLocaleString('th-TH')}`, inline: true },
      { name: 'การจัดส่ง', value: order.status === 'completed' ? 'ส่งสินค้าแล้ว' : 'รอร้านจัดส่ง / ติดต่อรับสินค้า', inline: true },
    ], timestamp: order.createdAt,
  };
  try {
    await axios.post(webhookUrl, { embeds: [embed], allowed_mentions: { parse: [] } }, { timeout: 10000, maxRedirects: 0 });
  } catch (_) { console.error('[purchase webhook] delivery failed'); }
}

module.exports = { config, isPurchaseWebhookUrl, recentPurchases, notifyPurchase };
