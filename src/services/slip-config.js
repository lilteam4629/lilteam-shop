const CREDENTIAL_FIELDS = [
  'easyslipApiKey', 'slipcheckApiKey', 'slipcheckApiKeys', 'slipcheckEndpoint', 'slipcheckIndependentQuota',
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

function slipcheckCredentials(effective = {}) {
  const useSharedPool = !effective.tenantOwnedSlipApi;
  return {
    apiKey: effective.slipcheckApiKey,
    apiKeys: useSharedPool ? effective.slipcheckApiKeys : undefined,
    independentQuota: Boolean(useSharedPool && effective.slipcheckIndependentQuota),
    endpoint: effective.slipcheckEndpoint,
  };
}

module.exports = { effectiveSlipConfig, isSharedMode, slipcheckCredentials };
