const API_TRANSACTION_TYPES = new Set(['catalog-topup', 'catalog-purchase', 'catalog-adjust']);

function hasCatalogActivity(transaction) {
  return Boolean(transaction?.catalogApiTopup) || API_TRANSACTION_TYPES.has(String(transaction?.type || ''));
}

function collectScopeMembers({ data, shopId, shopName, shopSlug = '', topupRequests = [] }) {
  const activityUserIds = new Set();
  const apiTransactionCounts = new Map();

  for (const transaction of data.walletTransactions || []) {
    if (hasCatalogActivity(transaction) && transaction.userId != null) {
      const userId = String(transaction.userId);
      activityUserIds.add(userId);
      apiTransactionCounts.set(userId, (apiTransactionCounts.get(userId) || 0) + 1);
    }
  }

  for (const request of topupRequests) {
    if (!request?.catalogApiTopup) continue;
    activityUserIds.add(String(request.tenantUserId || request.userId || ''));
  }

  return (data.users || [])
    .filter(user => (user.role || 'customer') === 'customer')
    .filter(user => activityUserIds.has(String(user.id)) || Number(user.catalogWalletBalance) > 0)
    .map(user => ({
      id: String(user.id),
      tenantShopId: shopId,
      shopName,
      shopSlug,
      username: String(user.username || 'สมาชิก'),
      email: String(user.email || ''),
      role: user.role || 'customer',
      status: user.status || 'active',
      createdAt: user.createdAt || null,
      catalogWalletBalance: Number(user.catalogWalletBalance) || 0,
      apiTransactionCount: apiTransactionCounts.get(String(user.id)) || 0,
    }));
}

async function collectCatalogApiMembers({ platformData, loadTenantDb, batchSize = 8 }) {
  if (!platformData || typeof loadTenantDb !== 'function') return [];

  const members = collectScopeMembers({
    data: platformData,
    shopId: 'main',
    shopName: String(platformData.settings?.shopName || 'ร้านหลัก'),
    shopSlug: '',
    topupRequests: (platformData.topupRequests || []).filter(request =>
      request?.catalogApiTopup && !request.tenantShopId),
  });

  const shops = platformData.shops || [];
  const safeBatchSize = Math.max(1, Math.min(16, Number(batchSize) || 8));
  for (let index = 0; index < shops.length; index += safeBatchSize) {
    const batch = shops.slice(index, index + safeBatchSize);
    const rows = await Promise.all(batch.map(async shop => {
      const data = await loadTenantDb(shop.id);
      if (!data) return [];
      const requests = (platformData.topupRequests || []).filter(request =>
        request?.catalogApiTopup && String(request.tenantShopId || '') === String(shop.id));
      return collectScopeMembers({
        data,
        shopId: String(shop.id),
        shopName: String(shop.name || shop.slug || shop.id),
        shopSlug: String(shop.slug || ''),
        topupRequests: requests,
      });
    }));
    members.push(...rows.flat());
  }

  return members;
}

module.exports = { collectCatalogApiMembers, hasCatalogActivity };
