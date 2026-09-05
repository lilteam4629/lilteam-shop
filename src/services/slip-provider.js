// Preserve the pre-upgrade selection until an administrator explicitly changes it.
function resolveSlipProvider(payment = {}, easySlipConfigured = false) {
  if (['none', 'slipok', 'easyslip'].includes(payment.slipProvider)) return payment.slipProvider;
  if (easySlipConfigured && payment.easyslipAccounts && Object.keys(payment.easyslipAccounts).length) return 'easyslip';
  return 'slipok';
}

module.exports = { resolveSlipProvider };
