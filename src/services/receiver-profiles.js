const PROVIDERS = ['slipcheck', 'rdcw', 'slip2go'];
const FIELDS = [
  'bankName', 'bankAccountNumber', 'bankAccountName', 'bankAccountNameEn',
  'bankAccountType', 'bankQrImage',
];

function blankProfile() {
  return {
    bankName: '', bankAccountNumber: '', bankAccountName: '', bankAccountNameEn: '',
    bankAccountType: 'NATURAL', bankQrImage: null,
  };
}

function snapshot(payment = {}) {
  const result = blankProfile();
  for (const field of FIELDS) {
    if (payment[field] !== undefined) result[field] = payment[field];
  }
  return result;
}

function profiles(payment = {}) {
  if (!payment.receiverProfiles || typeof payment.receiverProfiles !== 'object') payment.receiverProfiles = {};
  return payment.receiverProfiles;
}

function view(payment = {}, provider) {
  if (!PROVIDERS.includes(provider)) provider = PROVIDERS.includes(payment.slipProvider) ? payment.slipProvider : 'slipcheck';
  const saved = payment.receiverProfiles && payment.receiverProfiles[provider];
  if (saved) return snapshot(saved);
  if (provider === payment.slipProvider || !payment.receiverProfiles) return snapshot(payment);
  return blankProfile();
}

function saveAndActivate(payment, provider, profile) {
  if (!PROVIDERS.includes(provider)) throw new Error('Unsupported receiver profile');
  const saved = snapshot(profile);
  profiles(payment)[provider] = saved;
  for (const field of FIELDS) payment[field] = saved[field];
  payment.slipProvider = provider;
  return saved;
}

function save(payment, provider, profile) {
  if (!PROVIDERS.includes(provider)) return null;
  const saved = snapshot(profile);
  profiles(payment)[provider] = saved;
  return saved;
}

function credentials(_method = 'bank_transfer', ...paymentSources) {
  const sources = paymentSources.filter(Boolean);
  const names = sources.flatMap(source => [
    source.bankAccountName,
    source.bankAccountNameEn,
  ]).map(value => String(value || '').trim()).filter(Boolean);
  const numbers = sources.map(source => source.bankAccountNumber);
  return {
    expectedReceiverNames: [...new Set(names)],
    expectedReceiverNumbers: [...new Set(numbers.map(value => String(value || '').trim()).filter(Boolean))],
  };
}

module.exports = { PROVIDERS, FIELDS, blankProfile, snapshot, view, save, saveAndActivate, credentials };
