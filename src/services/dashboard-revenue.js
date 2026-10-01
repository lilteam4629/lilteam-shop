const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});

function bangkokDay(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dayFormatter.format(date) : null;
}

function countedOrders(data, day) {
  return (data.orders || []).filter(order => order.status !== 'cancelled'
    && order.salesChannel !== 'catalog-api-fulfillment' && bangkokDay(order.createdAt) === day);
}

function cents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function todayRevenue(data, { mainSite = false, now = new Date() } = {}) {
  const day = bangkokDay(now);
  const reset = mainSite && data.settings?.dashboardRevenueReset;
  const baseline = reset && reset.day === day ? new Map(reset.orders) : new Map();
  return countedOrders(data, day).reduce((sum, order) => sum
    + Math.max(0, cents(order.total) - (baseline.get(String(order.id)) || 0)), 0) / 100;
}

function resetTodayRevenue(data, { mainSite = false, adminUserId, now = new Date() } = {}) {
  if (!mainSite || !(data.users || []).some(user => user.id === adminUserId
    && user.role === 'admin' && user.status !== 'banned')) {
    throw new Error('รีเซ็ตได้เฉพาะแอดมินเว็บหลัก');
  }
  const day = bangkokDay(now);
  if (!day) throw new Error('วันที่ไม่ถูกต้อง');
  const previousRevenue = todayRevenue(data, { mainSite, now });
  data.settings ||= {};
  data.settings.dashboardRevenueReset = {
    day, resetAt: new Date(now).toISOString(), adminUserId, previousRevenue,
    orders: countedOrders(data, day).map(order => [String(order.id), cents(order.total)]),
  };
}

module.exports = { todayRevenue, resetTodayRevenue };
