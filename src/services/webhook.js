// Per-shop topup notification webhook — each shop pastes its own Discord
// (or any Discord-webhook-compatible service, e.g. most support the same
// {embeds:[...]} JSON shape) incoming webhook URL at /admin/topups, never
// shared or mixed with any other shop. Fire-and-forget: a failed/slow
// webhook must never affect the customer's topup flow.
const axios = require('axios');

async function notifyTopup({ webhookUrl, username, email, amount, refCode, method, slipUrl, autoApproved, adminUrl }) {
  if (!webhookUrl) return;
  try {
    const embed = {
      title: autoApproved ? '✅ เติมเงินสำเร็จอัตโนมัติ' : '🕐 มีคำขอเติมเงินใหม่ — รอตรวจสอบ',
      color: autoApproved ? 0x2ecc71 : 0xf1c40f,
      fields: [
        { name: 'ผู้ใช้', value: `${username || 'ไม่ทราบชื่อ'}${email ? ` (${email})` : ''}`, inline: false },
        { name: 'จำนวนเงิน', value: `฿${Number(amount || 0).toLocaleString()}`, inline: true },
        { name: 'ช่องทาง', value: method === 'bank_transfer' ? 'โอนธนาคาร' : 'พร้อมเพย์', inline: true },
        { name: 'รหัสอ้างอิง', value: `#${refCode || '-'}`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };
    if (slipUrl) embed.image = { url: slipUrl };
    if (adminUrl) {
      embed.fields.push({ name: 'กดตรวจสอบ/อนุมัติ (ต้องล็อกอินแอดมิน)', value: adminUrl, inline: false });
    }
    await axios.post(webhookUrl, { embeds: [embed] }, { timeout: 10000 });
  } catch (err) {
    console.error('[webhook] topup notify failed:', err.message);
  }
}

module.exports = { notifyTopup };
