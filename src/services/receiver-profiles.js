const PROVIDERS = ['easyslip', 'slipcheck', 'rdcw', 'slip2go'];
const FIELDS = [
  'promptpayId', 'promptpayName', 'promptpayBankCode', 'promptpayQrImage',
  'promptpayNameEn', 'bankName', 'bankAccountNumber', 'bankAccountName', 'bankAccountNameEn',
  'bankAccountType', 'bankExtraVerify', 'bankQrImage',
  'easyslipAccounts', 'easyslipStatus',
];

function blankProfile() {
  return {
    promptpayId: '', promptpayName: '', promptpayNameEn: '', promptpayBankCode: '', promptpayQrImage: null,
    bankName: '', bankAccountNumber: '', bankAccountName: '', bankAccountNameEn: '',
    bankAccountType: 'NATURAL', bankExtraVerify: '', bankQrImage: null,
    easyslipAccounts: {}, easyslipStatus: '',
  };
}

function snapshot(payment = {}) {
  const result = blankProfile();
  for (const field of FIELDS) {
    if (payment[field] !== undefined) result[field] = payment[field];
  }
  result.easyslipAccounts = { ...(result.easyslipAccounts || {}) };
  return result;
}

function profiles(payment = {}) {
  if (!payment.receiverProfiles || typeof payment.receiverProfiles !== 'object') payment.receiverProfiles = {};
  return payment.receiverProfiles;
}

function view(payment = {}, provider) {
  if (!PROVIDERS.includes(provider)) provider = PROVIDERS.includes(payment.slipProvider) ? payment.slipProvider : 'easyslip';
  const saved = payment.receiverProfiles && payment.receiverProfiles[provider];
  if (saved) return { ...blankProfile(), ...saved, easyslipAccounts: { ...(saved.easyslipAccounts || {}) } };
  if (provider === payment.slipProvider || !payment.receiverProfiles) return snapshot(payment);
  return blankProfile();
}

function saveAndActivate(payment, provider, profile) {
  if (!PROVIDERS.includes(provider)) throw new Error('Unsupported receiver profile');
  const saved = { ...blankProfile(), ...profile, easyslipAccounts: { ...(profile.easyslipAccounts || {}) } };
  profiles(payment)[provider] = saved;
  for (const field of FIELDS) payment[field] = saved[field];
  payment.slipProvider = provider;
  return saved;
}

function save(payment, provider, profile) {
  if (!PROVIDERS.includes(provider)) return null;
  const saved = { ...blankProfile(), ...profile, easyslipAccounts: { ...(profile.easyslipAccounts || {}) } };
  profiles(payment)[provider] = saved;
  return saved;
}

function credentials(method = 'promptpay', ...paymentSources) {
  const sources = paymentSources.filter(Boolean);
  const names = sources.flatMap(source => [
    method === 'promptpay' ? source.promptpayName : source.bankAccountName,
    method === 'promptpay' ? source.promptpayNameEn : source.bankAccountNameEn,
    method === 'promptpay' ? source.bankAccountName : source.promptpayName,
    method === 'promptpay' ? source.bankAccountNameEn : source.promptpayNameEn,
  ]).map(value => String(value || '').trim()).filter(Boolean);
  const numbers = sources.flatMap(source => method === 'promptpay'
    ? [source.promptpayId, source.bankAccountNumber]
    : [source.bankAccountNumber]);
  return {
    expectedReceiverNames: [...new Set(names)],
    expectedReceiverNumbers: [...new Set(numbers.map(value => String(value || '').trim()).filter(Boolean))],
  };
}

function easyslipExpectedNumbers(payment = {}, method = 'bank_transfer', ...fallbackPayments) {
  const accounts = payment.easyslipAccounts && typeof payment.easyslipAccounts === 'object'
    ? Object.entries(payment.easyslipAccounts) : [];
  const registered = accounts
    .filter(([key]) => method === 'promptpay'
      ? (key.endsWith(':promptpay') || key.endsWith(':account') || !key.includes(':'))
      : (key.endsWith(':account') || !key.includes(':')))
    .map(([, account]) => account && account.bankNumber)
    .filter(Boolean);
  // Use the shop's configured destination as the expected value if its
  // EasySlip registration snapshot is missing/stale. EasySlip still must
  // return a matched account and that account must match this exact number
  // before any wallet credit can be applied.
  const sources = [payment, ...fallbackPayments].filter(Boolean);
  const configured = sources.flatMap(source => method === 'promptpay'
    ? [source.promptpayId, source.bankAccountNumber]
    : [source.bankAccountNumber]);
  return [...new Set([...registered, ...configured].map(value => String(value || '').trim()).filter(Boolean))];
}

module.exports = { PROVIDERS, FIELDS, blankProfile, snapshot, view, save, saveAndActivate, credentials, easyslipExpectedNumbers };
