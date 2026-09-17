// Preserve the pre-upgrade selection until an administrator explicitly changes it.
function resolveSlipProvider(payment = {}) {
  if (['none', 'slipok', 'slipcheck', 'rdcw', 'slip2go', 'xepht'].includes(payment.slipProvider)) return payment.slipProvider;
  return 'slipok';
}

module.exports = { resolveSlipProvider };
