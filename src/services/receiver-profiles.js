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

module.exports = { PROVIDERS, FIELDS, blankProfile, snapshot, view, save, saveAndActivate };
