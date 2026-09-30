const assert = require('node:assert/strict');
const axios = require('axios');
const { receiverMatches } = require('../src/services/receiver-match');
const profiles = require('../src/services/receiver-profiles');

async function main() {
  const originalPost = axios.post;
  try {
    for (const id of ['0812345678', '1234567890123']) {
      const destination = { bankName: 'พร้อมเพย์', bankAccountNumber: id, bankAccountName: 'สมชาย ใจดี' };
      for (const provider of profiles.PROVIDERS) {
        const payment = { ...destination, receiverProfiles: { [provider]: { bankAccountNumber: '0000000000' } } };
        assert.equal(profiles.view(payment, provider).bankAccountNumber, id, 'provider changes must keep the displayed PromptPay destination');
      }
      const options = { ...profiles.credentials('promptpay', destination), apiKey: 'fixture', clientId: 'fixture', clientSecret: 'fixture' };
      for (const [name, service] of [
        ['rdcw', require('../src/services/rdcw-slip')],
        ['slip2go', require('../src/services/slip2go')],
        ['xepht', require('../src/services/xepht-slip')],
        ['slipcheck', require('../src/services/slipcheck')],
      ]) {
        for (const [actualId, actualName, amount, shouldPass] of [
          [id, 'สมชาย ใจดี', 100, true],
          [id, '', 100, true],
          ['9999999999999', 'ผู้รับอื่น', 100, false],
          [id, 'สมชาย ใจดี', 99, false],
        ]) {
          const result = { amount, transRef: 'fixture-ref', ref_no: 'fixture-ref', transferred_at: new Date().toISOString(), receiver: { name: actualName, proxy: { type: id.length === 10 ? 'MSISDN' : 'NATID', value: actualId } } };
          axios.post = async () => ({ status: 200, data: name === 'xepht'
            ? { code: 'VERIFIED', data: result }
            : { success: true, data: result } });
          const response = await service.verifySlip(Buffer.from('fixture'), 100, {}, options);
          assert.equal(response.verified, shouldPass, name + ': PromptPay receiver and amount must match');
        }
      }
    }
    for (const actual of ['0812345678', '+66812345678', '0066812345678']) {
      assert.equal(receiverMatches({ actualNumbers: [actual], expectedNumbers: ['0812345678'] }).matched, true);
    }
    assert.equal(receiverMatches({ actualNumbers: ['0066812349999'], expectedNumbers: ['0812345678'] }).matched, false);
    console.log('PromptPay receivers passed for all adapters: mobile/ID proxies, provider switching, wrong recipient, wrong amount, and international mobile formats');
  } finally { axios.post = originalPost; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
