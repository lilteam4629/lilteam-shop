const crypto = require('crypto');
const id = () => crypto.randomBytes(12).toString('hex');
const normalized = value => String(value || '').trim().toLowerCase();
const money = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error('จำนวนพ้อยต้องอยู่ระหว่าง 0 ถึง 100,000');
  return Math.round(n * 100) / 100;
};
function config(data) {
  return data.settings.promotions || { campaigns: [], referral: { enabled: false, referrerAmount: 0, friendAmount: 0 } };
}
function inWindow(item, now = Date.now()) {
  return item?.enabled === true && (!item.startsAt || Date.parse(item.startsAt) <= now)
    && (!item.endsAt || now < Date.parse(item.endsAt));
}
function customer(data, userId) {
  const user = data.users.find(u => u.id === userId && u.role === 'customer' && u.status !== 'banned');
  if (!user) throw new Error('กรุณาเข้าสู่ระบบด้วยบัญชีสมาชิกที่ใช้งานได้');
  return user;
}
function credit(data, user, amount, rewardKey, note, now) {
  data.walletTransactions ||= [];
  if (data.walletTransactions.some(t => t.rewardKey === rewardKey)) return false;
  const balance = Number(user.walletBalance ?? 0);
  if (!Number.isFinite(balance) || balance < 0) throw new Error('ยอดกระเป๋าไม่ถูกต้อง กรุณาติดต่อร้าน');
  user.walletBalance = Math.round((balance + money(amount)) * 100) / 100;
  data.walletTransactions.push({ id: id(), userId: user.id, type: 'promotion-reward', amount: money(amount), rewardKey, note, balanceAfter: user.walletBalance, createdAt: new Date(now).toISOString() });
  return true;
}
function claim(data, userId, campaignId, username, now = Date.now()) {
  const user = customer(data, userId);
  if (normalized(username) !== normalized(user.username)) throw new Error('กรอกชื่อผู้ใช้ของบัญชีที่เข้าสู่ระบบอยู่เท่านั้น');
  const campaign = (config(data).campaigns || []).find(c => c.id === campaignId);
  if (!inWindow(campaign, now)) throw new Error('โปรโมชั่นยังไม่เริ่ม หมดเวลา หรือปิดใช้งานแล้ว');
  if (campaign.newMembersOnly && (!Number.isFinite(Date.parse(user.createdAt)) || !campaign.startsAt || Date.parse(user.createdAt) < Date.parse(campaign.startsAt))) throw new Error('โปรโมชั่นนี้สำหรับสมาชิกที่สมัครในช่วงโปรโมชั่น');
  data.promotionClaims ||= [];
  if (data.promotionClaims.some(c => c.campaignId === campaignId && c.userId === userId) || (data.walletTransactions || []).some(t => t.rewardKey === `campaign:${campaignId}:${userId}`)) throw new Error('คุณรับพ้อยโปรโมชั่นนี้แล้ว');
  if (campaign.maxClaims && data.promotionClaims.filter(c => c.campaignId === campaignId).length >= campaign.maxClaims) throw new Error('สิทธิ์โปรโมชั่นครบจำนวนแล้ว');
  const amount = money(campaign.amount);
  if (!amount) throw new Error('โปรโมชั่นยังไม่ได้กำหนดพ้อย');
  credit(data, user, amount, `campaign:${campaignId}:${userId}`, `โปรโมชั่น: ${campaign.title}`, now);
  data.promotionClaims.push({ id: id(), campaignId, userId, amount, createdAt: new Date(now).toISOString() });
  return amount;
}
function referralAtSignup(data, code, email, now = Date.now()) {
  if (!inWindow(config(data).referral, now)) return null;
  const user = data.users.find(u => u.id === code && u.role === 'customer' && u.status !== 'banned');
  return user && normalized(user.email) !== normalized(email) ? user.id : null;
}
function settleReferral(data, order, now = Date.now()) {
  if (!order || order.status !== 'completed' || order.salesChannel === 'catalog-api-fulfillment' || !(Number(order.total) > 0) || !order.items?.length) return false;
  const isPaid = o => (data.walletTransactions || []).some(t => t.userId === o.userId && ['purchase','catalog-purchase','random_box_draw'].includes(t.type)
    && (t.orderId === o.id || String(t.note || '').includes(`#${o.id}`)) && Number(t.amount) < 0);
  if (!isPaid(order)) return false;
  const policy = config(data).referral;
  if (!inWindow(policy, now)) return false;
  const friend = data.users.find(u => u.id === order.userId && u.role === 'customer' && u.status !== 'banned');
  if (!friend?.referredBy || friend.referralRewardedAt) return false;
  const referrer = data.users.find(u => u.id === friend.referredBy && u.role === 'customer' && u.status !== 'banned');
  if (!referrer || referrer.id === friend.id || normalized(referrer.email) === normalized(friend.email)) return false;
  if (!Number.isFinite(Date.parse(friend.createdAt)) || (policy.startsAt && Date.parse(friend.createdAt) < Date.parse(policy.startsAt))) return false;
  const qualifying = data.orders.filter(o => o.userId === friend.id && o.status === 'completed' && Number(o.total) > 0 && o.items?.length && isPaid(o))
    .sort((a,b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || String(a.id).localeCompare(String(b.id)))[0];
  if (qualifying?.id !== order.id) return false;
  const a = money(policy.referrerAmount || 0), b = money(policy.friendAmount || 0);
  if (!a && !b) return false;
  // Validate both balances before changing either side, including file-backed stores.
  for (const u of [friend, referrer]) if (!Number.isFinite(Number(u.walletBalance ?? 0)) || Number(u.walletBalance ?? 0) < 0) throw new Error('ยอดกระเป๋าไม่ถูกต้อง');
  if (a) credit(data, referrer, a, `referral:${friend.id}:inviter`, `แนะนำเพื่อนซื้อครั้งแรก #${order.id}`, now);
  if (b) credit(data, friend, b, `referral:${friend.id}:friend`, `รางวัลซื้อครั้งแรกจากเพื่อน #${order.id}`, now);
  friend.referralRewardedAt = new Date(now).toISOString();
  friend.referralRewardOrderId = order.id;
  return true;
}
function validateWindow(body) {
  const parse = value => {
    if (!value) return null;
    const n = Date.parse(/(Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}:00+07:00`);
    if (!Number.isFinite(n)) throw new Error('วันเวลาไม่ถูกต้อง');
    return new Date(n).toISOString();
  };
  const startsAt = parse(body.startsAt), endsAt = parse(body.endsAt);
  if (startsAt && endsAt && startsAt >= endsAt) throw new Error('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  return { startsAt, endsAt };
}
module.exports = { config, inWindow, claim, referralAtSignup, settleReferral, money, validateWindow };
