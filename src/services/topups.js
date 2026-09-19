const store = require('../data/store');

function isPartnerTopup(request) {
  return Boolean(request?.catalogApiTopup && request?.tenantShopId);
}

function findRequest(requestId) {
  return store.data.topupRequests.find(item => item.id === requestId)
    || (store.isTenantContext() ? store.platformData.topupRequests.find(item => isPartnerTopup(item)
      && (!store.currentTenantId || String(item.tenantShopId) === String(store.currentTenantId()))
      && item.id === requestId) : null);
}

function withRequestStore(request, callback) {
  return isPartnerTopup(request) ? store.runOnPlatform(callback) : callback();
}

async function creditPartnerWallet(request) {
  const tenantDb = await store.loadTenantDb(request.tenantShopId);
  if (!tenantDb) return { ok: false, error: 'ไม่พบข้อมูลร้านเช่าสำหรับเติมเงินสินค้า API' };
  const userId = request.tenantUserId || request.userId;
  return store.runInTenant(request.tenantShopId, tenantDb, () => store.transact(data => {
    data.walletTransactions ||= [];
    const user = data.users.find(item => item.id === userId);
    if (!user) return { ok: false, error: 'ไม่พบบัญชีลูกค้าในร้านเช่า' };
    const existing = data.walletTransactions.find(item => item.topupRequestId === request.id);
    if (existing) return { ok: true, alreadyCredited: true, user };
    const amount = Math.round((Number(request.amount) || 0) * 100) / 100;
    user.catalogWalletBalance = Math.round(((Number(user.catalogWalletBalance) || 0) + amount) * 100) / 100;
    data.walletTransactions.push({
      id: store.genId(10), userId: user.id, type: 'catalog-topup', catalogApiTopup: true,
      amount, topupRequestId: request.id, tenantShopId: String(request.tenantShopId),
      note: `เติมเงินสินค้า API สำเร็จ (ร้านหลัก, อ้างอิง ${request.refCode})`, createdAt: new Date().toISOString(),
    });
    return { ok: true, alreadyCredited: false, user };
  }));
}

async function approvePartnerTopup(request, requestId) {
  const transRef = String(request.slipCheck?.transRef || '').trim();
  if (transRef && !request.slipCheck?.verified && !(await store.claimGlobalSlipRef(transRef, { source: 'main-site', requestId }))) {
    return { ok: false, error: 'สลิปนี้เคยถูกใช้เติมเงินในอีกเว็บแล้ว' };
  }
  const credit = await creditPartnerWallet(request);
  if (!credit.ok) return credit;
  const approved = await store.runOnPlatform(() => store.transact(data => {
    const freshRequest = data.topupRequests.find(item => item.id === requestId);
    if (!freshRequest || freshRequest.status === 'rejected') return false;
    freshRequest.status = 'approved';
    freshRequest.reviewedAt = new Date().toISOString();
    freshRequest.reviewNote = 'อนุมัติโดยแอดมินร้านหลักและเติมเข้ากระเป๋า API ของร้านเช่าแล้ว';
    return true;
  }));
  if (!approved) return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  return { ok: true, request: store.platformData.topupRequests.find(item => item.id === requestId), user: credit.user };
}

async function approveTopup(requestId) {
  const request = findRequest(requestId);
  if (!request) return { ok: false, error: 'ไม่พบคำขอ' };
  if (request.status === 'approved' || request.status === 'rejected') {
    return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  }
  if (isPartnerTopup(request)) return approvePartnerTopup(request, requestId);

  const user = store.data.users.find(u => u.id === request.userId);
  if (!user) return { ok: false, error: 'ไม่พบผู้ใช้' };
  const transRef = String(request.slipCheck?.transRef || '').trim();
  if (transRef && !request.slipCheck?.verified && !(await store.claimGlobalSlipRef(transRef, { source: 'main-site', requestId }))) {
    return { ok: false, error: 'สลิปนี้เคยถูกใช้เติมเงินในอีกเว็บแล้ว' };
  }

  const approved = await store.transact((data) => {
    const freshRequest = data.topupRequests.find(t => t.id === requestId);
    if (!freshRequest || freshRequest.status === 'approved' || freshRequest.status === 'rejected') return false;
    const freshUser = data.users.find(u => u.id === freshRequest.userId);
    if (!freshUser) return false;
    const isCatalog = Boolean(freshRequest.catalogApiTopup);
    if (isCatalog) {
      freshUser.catalogWalletBalance = Math.round(((Number(freshUser.catalogWalletBalance) || 0) + Number(freshRequest.amount)) * 100) / 100;
    } else {
      freshUser.walletBalance = Math.round(((Number(freshUser.walletBalance) || 0) + Number(freshRequest.amount)) * 100) / 100;
    }
    data.walletTransactions ||= [];
    data.walletTransactions.push({
      id: store.genId(10), userId: freshUser.id, type: isCatalog ? 'catalog-topup' : 'topup', catalogApiTopup: isCatalog,
      topupRequestId: freshRequest.id, amount: freshRequest.amount,
      note: `${isCatalog ? 'เติมเงินสินค้า API' : 'เติมเงิน'}สำเร็จ (อ้างอิง ${freshRequest.refCode})`, createdAt: new Date().toISOString(),
    });
    freshRequest.status = 'approved';
    freshRequest.reviewedAt = new Date().toISOString();
    return true;
  });
  if (!approved) return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  return { ok: true, request: store.data.topupRequests.find(t => t.id === requestId), user };
}

async function rejectTopup(requestId, reviewNote) {
  const request = findRequest(requestId);
  if (!request) return { ok: false, error: 'ไม่พบคำขอ' };
  if (request.status === 'approved' || request.status === 'rejected') {
    return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  }
  const rejected = await withRequestStore(request, () => store.transact((data) => {
    const freshRequest = data.topupRequests.find(t => t.id === requestId);
    if (!freshRequest || freshRequest.status === 'approved' || freshRequest.status === 'rejected') return false;
    freshRequest.status = 'rejected';
    freshRequest.reviewedAt = new Date().toISOString();
    freshRequest.reviewNote = reviewNote || '';
    return true;
  }));
  if (!rejected) return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  return { ok: true };
}

async function deleteTopup(requestId) {
  const request = findRequest(requestId);
  if (!request) return { ok: false, error: 'ไม่พบคำขอเติมเงิน' };
  if (request.status === 'approved') {
    return { ok: false, error: 'ลบรายการที่อนุมัติแล้วไม่ได้ เพราะต้องเก็บประวัติยอดเงินของลูกค้า' };
  }
  const deleted = await withRequestStore(request, () => store.transact((data) => {
    const index = data.topupRequests.findIndex(t => t.id === requestId);
    if (index < 0 || data.topupRequests[index].status === 'approved') return false;
    data.topupRequests.splice(index, 1);
    return true;
  }));
  return deleted ? { ok: true, request } : { ok: false, error: 'ลบรายการนี้ไม่ได้ กรุณาลองใหม่' };
}

module.exports = { approveTopup, rejectTopup, deleteTopup };
