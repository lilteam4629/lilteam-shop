const store = require('../data/store');

async function approveTopup(requestId) {
  const request = store.data.topupRequests.find(t => t.id === requestId);
  if (!request) return { ok: false, error: 'ไม่พบคำขอ' };
  if (request.status === 'approved' || request.status === 'rejected') {
    return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  }
  const user = store.data.users.find(u => u.id === request.userId);
  if (!user) return { ok: false, error: 'ไม่พบผู้ใช้' };
  const transRef = String(request.slipCheck?.transRef || '').trim();
  if (transRef && !(await store.claimGlobalSlipRef(transRef, { source: 'main-site', requestId }))) {
    return { ok: false, error: 'สลิปนี้เคยถูกใช้เติมเงินในอีกเว็บแล้ว' };
  }

  const approved = await store.transact((data) => {
    const freshRequest = data.topupRequests.find(t => t.id === requestId);
    if (!freshRequest || freshRequest.status === 'approved' || freshRequest.status === 'rejected') return false;
    const freshUser = data.users.find(u => u.id === freshRequest.userId);
    if (!freshUser) return false;
    if (freshRequest.catalogApiTopup) {
      freshUser.catalogWalletBalance = Math.round(((Number(freshUser.catalogWalletBalance) || 0) + Number(freshRequest.amount)) * 100) / 100;
    } else {
      freshUser.walletBalance = Math.round(((Number(freshUser.walletBalance) || 0) + Number(freshRequest.amount)) * 100) / 100;
    }
    data.walletTransactions.push({
      id: store.genId(10), userId: freshUser.id,
      type: freshRequest.catalogApiTopup ? 'catalog-topup' : 'topup',
      catalogApiTopup: Boolean(freshRequest.catalogApiTopup),
      amount: freshRequest.amount,
      note: `${freshRequest.catalogApiTopup ? 'เติมเงินสินค้า API' : 'เติมเงิน'}สำเร็จ (อ้างอิง ${freshRequest.refCode})`,
      createdAt: new Date().toISOString(),
    });
    freshRequest.status = 'approved';
    freshRequest.reviewedAt = new Date().toISOString();
    return true;
  });
  if (!approved) return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  return { ok: true, request, user };
}

async function rejectTopup(requestId, reviewNote) {
  const request = store.data.topupRequests.find(t => t.id === requestId);
  if (!request) return { ok: false, error: 'ไม่พบคำขอ' };
  if (request.status === 'approved' || request.status === 'rejected') {
    return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  }
  const rejected = await store.transact((data) => {
    const freshRequest = data.topupRequests.find(t => t.id === requestId);
    if (!freshRequest || freshRequest.status === 'approved' || freshRequest.status === 'rejected') return false;
    freshRequest.status = 'rejected';
    freshRequest.reviewedAt = new Date().toISOString();
    freshRequest.reviewNote = reviewNote || '';
    return true;
  });
  if (!rejected) return { ok: false, error: 'คำขอนี้ถูกตรวจสอบไปแล้ว' };
  return { ok: true };
}

async function deleteTopup(requestId) {
  const request = store.data.topupRequests.find(t => t.id === requestId);
  if (!request) return { ok: false, error: 'ไม่พบคำขอเติมเงิน' };
  if (request.status === 'approved') {
    return { ok: false, error: 'ลบรายการที่อนุมัติแล้วไม่ได้ เพราะต้องเก็บประวัติยอดเงินของลูกค้า' };
  }
  const deleted = await store.transact((data) => {
    const index = data.topupRequests.findIndex(t => t.id === requestId);
    if (index < 0 || data.topupRequests[index].status === 'approved') return false;
    data.topupRequests.splice(index, 1);
    return true;
  });
  return deleted ? { ok: true, request } : { ok: false, error: 'ลบรายการนี้ไม่ได้ กรุณาลองใหม่' };
}

module.exports = { approveTopup, rejectTopup, deleteTopup };
