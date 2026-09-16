const assert = require('node:assert/strict');
const axios = require('axios');
const { extractReceiverEvidence, receiverMatches } = require('../src/services/receiver-match');
const receiverProfiles = require('../src/services/receiver-profiles');

const standardPayload = {
  sender: { account: { value: 'xxx-x-x1111-x' } },
  receiver: {
    displayName: 'นาย สมชาย ใจดี',
    account: { type: 'BANKAC', value: 'xxx-x-x5678-x' },
    proxy: { type: 'MSISDN', value: '08xxxx5678' },
  },
};

const evidence = extractReceiverEvidence(standardPayload);
assert.equal(evidence.numbers.includes('xxx-x-x5678-x'), true, 'receiver.account.value must be extracted');
assert.equal(evidence.numbers.includes('08xxxx5678'), true, 'receiver.proxy.value must be extracted');
assert.equal(evidence.numbers.includes('xxx-x-x1111-x'), false, 'sender identifiers must never be accepted');
assert.equal(receiverMatches({
  actualNames: evidence.names,
  actualNumbers: evidence.numbers,
  expectedNames: ['สมชาย ใจดี'],
  expectedNumbers: ['0812345678'],
}).matched, true, 'masked receiver evidence should match the configured recipient');

assert.equal(receiverMatches({
  actualNames: ['SOMCHAI JAIDEE'],
  actualNumbers: ['xxx-x-x5678-x'],
  expectedNames: ['สมชาย ใจดี', 'SOMCHAI JAIDEE'],
  expectedNumbers: ['0812345678'],
}).matched, true, 'English receiver aliases must be usable when the provider returns English');

// Regression guard: the account shown on the storefront must remain a
// verification candidate when a provider-specific receiver snapshot exists.
const candidates = receiverProfiles.credentials('bank',
  { bankAccountName: 'บัญชีเก่า', bankAccountNumber: '000-0-00000-0' },
  { bankAccountName: 'นาย อุรพงค์ สงทิม', bankAccountNumber: '123-4-56804-4' });
assert.equal(receiverMatches({
  actualNames: ['นาย อุรพงค์ สงทิม'],
  actualNumbers: ['XXX-X-XX804-4'],
  expectedNames: candidates.expectedReceiverNames,
  expectedNumbers: candidates.expectedReceiverNumbers,
}).matched, true, 'the account currently shown on the storefront must remain a verification candidate');

assert.equal(receiverMatches({
  actualNames: [],
  actualNumbers: ['XXX-X-XX804-4'],
  expectedNames: ['นาย อุรพงค์ สงทิม'],
  expectedNumbers: ['123-4-56804-4'],
  allowMaskedNumber: true,
}).matched, true, 'provider-confirmed masked receiver suffix must match the displayed destination account');
assert.equal(receiverMatches({
  actualNames: [],
  actualNumbers: ['XXX-X-XX999-9'],
  expectedNames: ['นาย อุรพงค์ สงทิม'],
  expectedNumbers: ['123-4-56804-4'],
  allowMaskedNumber: true,
}).matched, false, 'a different masked receiver suffix must be rejected');

async function verifyProviderIntegration() {
  const originalPost = axios.post;
  axios.post = async () => ({ data: {
    success: true,
    data: { ...standardPayload, amount: 100, ref_no: 'fixture-slipcheck-ref', transferred_at: new Date().toISOString() },
  } });
  try {
    delete require.cache[require.resolve('../src/services/slipcheck')];
    const slipcheck = require('../src/services/slipcheck');
    const result = await slipcheck.verifySlip(Buffer.from('fixture'), 100, {}, {
      apiKey: 'fixture-key',
      expectedReceiverNames: ['สมชาย ใจดี', 'SOMCHAI JAIDEE'],
      expectedReceiverNumbers: ['0812345678'],
    });
    assert.equal(result.verified, true, 'SlipCheck standard receiver.account.value response must verify');
  } finally {
    axios.post = originalPost;
    delete require.cache[require.resolve('../src/services/slipcheck')];
  }
}

async function verifySlipCheckKeyOrder() {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const usedKeys = [];
  let firstKeySuccesses = 0;
  axios.post = async (url, form, options) => {
    const key = options.headers['x-api-key'];
    usedKeys.push(key);
    if (key === 'key-one' && firstKeySuccesses >= 2) return { data: { success: false, code: 429, message: 'quota exceeded' } };
    if (key === 'key-one') firstKeySuccesses++;
    return { data: { success: true, data: { ...standardPayload, amount: 100, ref_no: `fixture-${usedKeys.length}`, transferred_at: new Date().toISOString() } } };
  };
  axios.get = async (url, options) => ({ data: { success: true, quota: options.headers['x-api-key'] === 'key-one'
    ? { used: firstKeySuccesses >= 2 ? 500 : firstKeySuccesses, limit: 500 }
    : { used: 0, limit: 500 } } });
  try {
    delete require.cache[require.resolve('../src/services/slipcheck')];
    const slipcheck = require('../src/services/slipcheck');
    const credentials = { apiKey: 'key-one', apiKeys: ['key-one', 'key-two'], independentQuota: true, expectedReceiverNames: ['สมชาย ใจดี'], expectedReceiverNumbers: ['0812345678'] };
    assert.equal((await slipcheck.verifySlip(Buffer.from('fixture'), 100, {}, credentials)).verified, true);
    assert.equal((await slipcheck.verifySlip(Buffer.from('fixture'), 100, {}, credentials)).verified, true);
    assert.equal((await slipcheck.verifySlip(Buffer.from('fixture'), 100, {}, credentials)).quotaExhausted, true);
    assert.equal((await slipcheck.verifySlip(Buffer.from('fixture'), 100, {}, credentials)).quotaExhausted, true);
    assert.deepEqual(usedKeys, ['key-one', 'key-one', 'key-one', 'key-one'], 'temporary safe mode must keep verification on the primary key');
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
    delete require.cache[require.resolve('../src/services/slipcheck')];
  }
}

async function verifySlipCheckAdvancesOnQuotaResponse() {
  const originalPost = axios.post;
  const usedKeys = [];
  axios.post = async (url, form, options) => {
    usedKeys.push(options.headers['x-api-key']);
    if (options.headers['x-api-key'] === 'key-one') {
      const error = new Error('Quota exceeded');
      error.response = { status: 429, data: { code: 'quota_exceeded', message: 'quota exceeded' } };
      throw error;
    }
    return { data: { success: true, data: { ...standardPayload, amount: 100, ref_no: 'rate-limit-retry', transferred_at: new Date().toISOString() } } };
  };
  try {
    delete require.cache[require.resolve('../src/services/slipcheck')];
    const slipcheck = require('../src/services/slipcheck');
    const result = await slipcheck.verifySlip(Buffer.from('fixture'), 100, {}, { apiKey: 'key-one', apiKeys: ['key-one', 'key-two'], independentQuota: true, expectedReceiverNames: ['สมชาย ใจดี'], expectedReceiverNumbers: ['0812345678'] });
    assert.equal(result.quotaExhausted, true, 'primary key quota exhaustion must be surfaced without switching keys');
    assert.deepEqual(usedKeys, ['key-one'], 'temporary safe mode must not switch to a secondary key');
  } finally {
    axios.post = originalPost;
    delete require.cache[require.resolve('../src/services/slipcheck')];
  }
}

async function verifySlipCheckKeepsProcessingFailureOnCurrentKey() {
  const originalPost = axios.post;
  const usedKeys = [];
  axios.post = async (url, payload, options) => {
    usedKeys.push(options.headers['x-api-key']);
    return { data: { success: false, code: 'verify_failed', message: 'เกิดการตรวจสลิปไม่ผ่าน' } };
  };
  try {
    delete require.cache[require.resolve('../src/services/slipcheck')];
    const slipcheck = require('../src/services/slipcheck');
    const result = await slipcheck.verifySlip(Buffer.from('fixture'), 100, {}, {
      apiKey: 'key-one', apiKeys: ['key-one', 'key-two'], independentQuota: true,
      expectedReceiverNames: ['สมชาย ใจดี'], expectedReceiverNumbers: ['0812345678'],
    });
    assert.equal(result.providerCode, 'verify_failed');
    assert.deepEqual(usedKeys, ['key-one'], 'a processing failure must keep the working key order unchanged');
  } finally {
    axios.post = originalPost;
    delete require.cache[require.resolve('../src/services/slipcheck')];
  }
}

function verifyTenantSharedSlipCheckPool() {
  const { effectiveSlipConfig, slipcheckCredentials } = require('../src/services/slip-config');
  const platform = { slipProvider: 'slipcheck', slipcheckApiKey: 'key-one', slipcheckApiKeys: ['key-one', 'key-two'], slipcheckIndependentQuota: true };
  const shared = slipcheckCredentials(effectiveSlipConfig({ slipApiMode: 'shared' }, platform, true));
  assert.deepEqual(shared.apiKeys, ['key-one', 'key-two'], 'a rented shop in shared mode must inherit the full main-site pool');
  assert.equal(shared.independentQuota, true);
  const own = slipcheckCredentials(effectiveSlipConfig({ slipApiMode: 'own', slipcheckApiKey: 'tenant-key', slipcheckApiKeys: ['must-not-leak'] }, platform, true));
  assert.equal(own.apiKey, 'tenant-key');
  assert.equal(own.apiKeys, undefined, 'a rented shop using its own API must stay on its own single key');
}

verifyProviderIntegration()
  .then(verifySlipCheckKeyOrder)
  .then(verifySlipCheckAdvancesOnQuotaResponse)
  .then(verifySlipCheckKeepsProcessingFailureOnCurrentKey)
  .then(verifyTenantSharedSlipCheckPool)
  .then(() => console.log('Receiver matching checks passed: provider response, account/proxy values, sender isolation, Thai/English names'))
  .catch(error => { console.error(error); process.exitCode = 1; });
