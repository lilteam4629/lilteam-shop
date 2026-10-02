// The credit ledger records successful top-ups only. Purchases, rewards,
// refunds and manual admin adjustments must not inflate lifetime deposits.
function memberTopupTotals(data, scope = 'store') {
  const centsByUser = new Map();
  for (const transaction of data.walletTransactions || []) {
    const amount = Number(transaction.amount);
    const catalog = transaction.type === 'catalog-topup' || transaction.catalogApiTopup === true;
    const topup = transaction.type === 'topup' || transaction.type === 'catalog-topup';
    if (!topup || !Number.isFinite(amount) || amount <= 0 || catalog !== (scope === 'catalog')) continue;
    const userId = String(transaction.userId);
    centsByUser.set(userId, (centsByUser.get(userId) || 0) + Math.round(amount * 100));
  }
  return new Map([...centsByUser].map(([userId, cents]) => [userId, cents / 100]));
}

module.exports = { memberTopupTotals };
