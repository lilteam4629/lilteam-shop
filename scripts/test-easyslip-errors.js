const assert = require('node:assert/strict');
const axios = require('axios');
const easyslip = require('../src/services/easyslip');

async function main() {
  const originalPost = axios.post;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    axios.post = async () => { throw Object.assign(new Error('server failure'), { response: { status: 503, data: { code: 'upstream_busy', message: 'temporary' } } }); };
    const temporary = await easyslip.verifySlip(Buffer.from('slip'), 10, {}, ['1234567890'], 'test-key');
    assert.equal(temporary.checked, false);
    assert.equal(temporary.retryable, true);
    assert.equal(temporary.httpStatus, 503);
    assert.equal(temporary.providerCode, 'upstream_busy');
    assert.equal(temporary.raw, null);

    axios.post = async () => { throw Object.assign(new Error('unauthorized'), { response: { status: 401, data: { code: 'invalid_key' } } }); };
    const rejected = await easyslip.verifySlip(Buffer.from('slip'), 10, {}, ['1234567890'], 'test-key');
    assert.equal(rejected.retryable, false);
    assert.equal(rejected.httpStatus, 401);
    assert.equal(rejected.providerCode, 'invalid_key');

    axios.post = async () => { throw Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }); };
    const network = await easyslip.verifySlip(Buffer.from('slip'), 10, {}, ['1234567890'], 'test-key');
    assert.equal(network.retryable, true);
    assert.equal(network.httpStatus, null);
  } finally {
    axios.post = originalPost;
    console.warn = originalWarn;
  }
  process.stdout.write('EasySlip failure classification checks passed\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
