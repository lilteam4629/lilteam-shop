// Preserve the pre-upgrade selection until an administrator explicitly changes it.
function resolveSlipProvider(payment = {}) {
  // SlipCheck is retired from the selectable providers. Existing records are
  // routed to SlipOK until an operator explicitly chooses another supported
  // provider, so old settings cannot keep sending requests to SlipCheck.
  if (payment.slipProvider === 'slipcheck') return 'slipok';
  if (['none', 'slipok', 'rdcw', 'slip2go', 'xepht'].includes(payment.slipProvider)) return payment.slipProvider;
  return 'slipok';
}

module.exports = { resolveSlipProvider };
