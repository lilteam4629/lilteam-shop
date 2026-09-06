const store = require('../data/store');

function parsePromoFields(body) {
  const promo = body.promo === 'on' || body.promo === true;
  const promoLimit = promo && body.promoLimit ? Math.max(1, parseInt(body.promoLimit, 10) || 0) || null : null;
  const promoExpiresAt = promo && body.promoExpiresAt ? new Date(body.promoExpiresAt).getTime() || null : null;
  return { promo, promoLimit, promoExpiresAt };
}

function listPlans() {
  return store.data.licensePlans;
}

async function createPlan(body) {
  const days = Math.max(1, parseInt(body.days, 10) || 0);
  const price = Math.max(0, Number(body.price) || 0);
  if (!days || !price) return { ok: false, error: 'กรุณากรอกจำนวนวันและราคาให้ถูกต้อง' };
  const plan = {
    id: store.genId(8), days, price, active: true, createdAt: new Date().toISOString(),
    promoUsedCount: 0, ...parsePromoFields(body),
  };
  store.data.licensePlans.push(plan);
  await store.save();
  return { ok: true, plan };
}

async function editPlan(id, body) {
  const plan = store.data.licensePlans.find(p => p.id === id);
  if (!plan) return { ok: false, error: 'ไม่พบแพ็กเกจนี้' };
  const days = Math.max(1, parseInt(body.days, 10) || 0);
  const price = Math.max(0, Number(body.price) || 0);
  if (!days || !price) return { ok: false, error: 'กรุณากรอกจำนวนวันและราคาให้ถูกต้อง' };
  plan.days = days;
  plan.price = price;
  Object.assign(plan, parsePromoFields(body));
  await store.save();
  return { ok: true, plan };
}

async function togglePlan(id) {
  const plan = store.data.licensePlans.find(p => p.id === id);
  if (!plan) return { ok: false, error: 'ไม่พบแพ็กเกจนี้' };
  plan.active = !plan.active;
  await store.save();
  return { ok: true, plan };
}

async function deletePlan(id) {
  const before = store.data.licensePlans.length;
  store.data.licensePlans = store.data.licensePlans.filter(p => p.id !== id);
  if (store.data.licensePlans.length === before) return { ok: false, error: 'ไม่พบแพ็กเกจนี้' };
  await store.save();
  return { ok: true };
}

module.exports = { listPlans, createPlan, editPlan, togglePlan, deletePlan };
