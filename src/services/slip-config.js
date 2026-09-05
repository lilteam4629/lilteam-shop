const CREDENTIAL_FIELDS = [
  'easyslipApiKey', 'slipcheckApiKey', 'slipcheckEndpoint',
  'rdcwClientId', 'rdcwClientSecret', 'rdcwEndpoint',
  'slip2goApiKey', 'slip2goEndpoint', 'slipokBranchId', 'slipokApiKey',
];

function isSharedMode(payment = {}, isTenant = false) {
  return Boolean(isTenant && (payment.slipApiMode || 'shared') === 'shared');
}

function effectiveSlipConfig(payment = {}, platformPayment = {}, isTenant = false) {
  if (!isSharedMode(payment, isTenant)) return { ...payment, tenantOwnedSlipApi: Boolean(isTenant) };
  const effective = { ...payment, slipProvider: platformPayment.slipProvider || 'easyslip', tenantOwnedSlipApi: false };
  for (const field of CREDENTIAL_FIELDS) effective[field] = platformPayment[field];
  return effective;
}

module.exports = { effectiveSlipConfig, isSharedMode };
