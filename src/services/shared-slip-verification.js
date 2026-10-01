const providers = { slipok: require('./slipok'), slipcheck: require('./slipcheck'), rdcw: require('./rdcw-slip'), slip2go: require('./slip2go'), xepht: require('./xepht-slip') };
const { resolveSlipProvider } = require('./slip-provider');
const { slipcheckCredentials } = require('./slip-config');
const receivers = require('./receiver-profiles');
function configured(effective, payment) {
  const provider = resolveSlipProvider(effective);
  const expected = receivers.credentials('bank_transfer', receivers.view(payment, provider), payment);
  const hasReceiver = expected.expectedReceiverNumbers.length || expected.expectedReceiverNames.length;
  if (provider === 'slipok') return Boolean(effective.slipokBranchId && effective.slipokApiKey);
  if (!hasReceiver) return false;
  if (provider === 'slipcheck') { const credentials = slipcheckCredentials(effective); return Boolean(credentials.apiKey || credentials.apiKeys?.length); }
  if (provider === 'rdcw') return Boolean(effective.rdcwClientId && effective.rdcwClientSecret);
  if (provider === 'slip2go') return Boolean(effective.slip2goApiKey);
  return provider === 'xepht';
}
async function verify(buffer, amount, file, effective, payment, method = 'bank_transfer') {
  const provider = resolveSlipProvider(effective);
  const expected = receivers.credentials(method, receivers.view(payment, provider), payment);
  let options;
  if (provider === 'slipok') options = { branchId: effective.slipokBranchId, apiKey: effective.slipokApiKey, ...expected };
  if (provider === 'slipcheck') options = { ...slipcheckCredentials(effective), ...expected };
  if (provider === 'rdcw') options = { clientId: effective.rdcwClientId, clientSecret: effective.rdcwClientSecret, endpoint: effective.rdcwEndpoint, ...expected };
  if (provider === 'slip2go') options = { apiKey: effective.slip2goApiKey, endpoint: effective.slip2goEndpoint, ...expected };
  if (provider === 'xepht') options = { apiKey: effective.xephtApiKey, endpoint: effective.xephtEndpoint, ...expected };
  const result = providers[provider] ? await providers[provider].verifySlip(buffer, amount, file, options) : { checked: false, verified: false, message: 'รอผู้ดูแลตรวจสอบสลิป', raw: null };
  return { provider, result };
}
module.exports = { verify, configured };
