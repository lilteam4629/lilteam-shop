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

verifyProviderIntegration()
  .then(() => console.log('Receiver matching checks passed: provider response, account/proxy values, sender isolation, Thai/English names'))
  .catch(error => { console.error(error); process.exitCode = 1; });
