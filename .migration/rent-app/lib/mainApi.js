// Thin wrapper around the main app's internal API. This is the ONLY way
// this app ever touches real data — no MongoDB connection lives here at
// all. Every call attaches the shared secret; the main app rejects
// anything without it (see src/routes/internal-api.js on the main app).
const axios = require('axios');

const BASE_URL = (process.env.MAIN_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SECRET = process.env.INTERNAL_API_SECRET || '';

const client = axios.create({
  baseURL: `${BASE_URL}/internal/api`,
  timeout: 20000,
  headers: { 'X-Internal-Secret': SECRET },
  validateStatus: () => true, // we handle non-2xx ourselves, never throw
});

async function request(config) {
  try {
    const res = await client.request(config);
    return { status: res.status, ok: res.status >= 200 && res.status < 300, body: res.data };
  } catch (err) {
    // Network failure / main app unreachable — never let this crash a
    // request to the rent-app itself.
    return { status: 0, ok: false, body: { error: 'ไม่สามารถเชื่อมต่อระบบหลักได้ กรุณาลองใหม่อีกครั้ง' } };
  }
}

module.exports = {
  platformAdmin: (username) => request({ method: 'post', url: '/auth/platform-admin', data: { username } }),
  legacyEligibility: (userId) => request({ method: 'get', url: '/legacy-cloud-eligibility', params: { userId } }),
  legacyTruemoneyConfig: () => request({ method: 'get', url: '/legacy-truemoney-config' }),
  legacyPaymentConfig: () => request({ method: 'get', url: '/legacy-payment-config' }),
  rentalOverview: () => request({ method: 'get', url: '/admin/rentals' }),
  deleteShop: (id, confirmName) => request({ method: 'post', url: '/admin/rentals/' + encodeURIComponent(id) + '/delete', data: { confirmName } }),
  discordSettings: (data) => request({ method: 'post', url: '/admin/discord/settings', data }),
  discordPanel: () => request({ method: 'post', url: '/admin/discord/post-ticket-panel' }),
  paymentInfo: () => request({ method: 'get', url: '/payment-info' }),
  claimSlip: (transRef, requestId) => request({ method: 'post', url: '/slips/claim', data: { transRef, requestId, source: 'shop-cloud' } }),
  redeemTruemoney: (userId, voucherLink) => request({ method: 'post', url: '/wallet/truemoney', data: { userId, voucherLink } }),
  topupDetail: (id, userId) => request({ method: 'get', url: `/wallet/topups/${encodeURIComponent(id)}`, params: { userId } }),
  attachTopupSlip: (id, formData) => request({ method: 'post', url: `/wallet/topups/${encodeURIComponent(id)}/slip`, data: formData, headers: formData.getHeaders() }),
  topupSlipStream: (id, userId) => client.request({ method: 'get', url: `/wallet/topups/${encodeURIComponent(id)}/slip`, params: { userId }, responseType: 'stream' }),
  sales: (userId) => request({ method: 'get', url: '/sales', params: { userId } }),
  sale: (id, userId) => request({ method: 'get', url: '/sales/' + encodeURIComponent(id), params: { userId } }),
  syncSale: (id, userId, railwayToken) => request({ method: 'post', url: '/sales/' + encodeURIComponent(id) + '/sync', data: { userId, railwayToken } }),
  login: (username, password) => request({ method: 'post', url: '/auth/login', data: { username, password } }),
  register: (username, email, password, recaptchaResponse) =>
    request({ method: 'post', url: '/auth/register', data: { username, email, password, recaptchaResponse } }),
  me: (userId) => request({ method: 'get', url: '/me', params: { userId } }),
  config: () => request({ method: 'get', url: '/config' }),
  plans: () => request({ method: 'get', url: '/plans' }),
  createShop: (payload) => request({ method: 'post', url: '/shops', data: payload }),
  myShops: (cloudUserId) => request({ method: 'get', url: '/shops', params: { cloudUserId } }),
  renewShop: (shopId, payload) => request({ method: 'post', url: `/shops/${shopId}/renew`, data: payload }),
  walletTopups: (userId) => request({ method: 'get', url: '/wallet/topups', params: { userId } }),
  // Multipart form — data must be a FormData instance (see routes using this).
  topup: (formData) => request({
    method: 'post', url: '/wallet/topup', data: formData,
    headers: formData.getHeaders ? formData.getHeaders() : undefined,
  }),

  // ---------- Admin (rent-app's own /admin, gated by ADMIN_USERNAME/PASSWORD) ----------
  adminListPlans: () => request({ method: 'get', url: '/admin/license-plans' }),
  adminCreatePlan: (payload) => request({ method: 'post', url: '/admin/license-plans', data: payload }),
  adminEditPlan: (id, payload) => request({ method: 'post', url: `/admin/license-plans/${id}`, data: payload }),
  adminTogglePlan: (id) => request({ method: 'post', url: `/admin/license-plans/${id}/toggle` }),
  adminDeletePlan: (id) => request({ method: 'post', url: `/admin/license-plans/${id}/delete` }),
  adminListTopups: (params) => request({ method: 'get', url: '/admin/topups', params }),
  adminApproveTopup: (id) => request({ method: 'post', url: `/admin/topups/${id}/approve` }),
  adminRejectTopup: (id, reviewNote) => request({ method: 'post', url: `/admin/topups/${id}/reject`, data: { reviewNote } }),
  adminListUsers: (params) => request({ method: 'get', url: '/admin/users', params }),
  // Streams raw bytes — bypasses the request()/axios-json helper above since
  // the admin page needs to pipe this straight through as an image response.
  adminSlipStream: (id) => client.request({ method: 'get', url: `/admin/topups/${id}/slip`, responseType: 'stream' }),
};
