const http = require('http');
const assert = require('node:assert/strict');

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function url(server) { return `http://127.0.0.1:${server.address().port}`; }

(async () => {
  let calls = 0;
  const unavailable = await listen((req, res) => {
    calls += 1;
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: { code: 'SERVICE_UNAVAILABLE', message: 'test outage' }, data: null }));
  });
  process.env.TRUEMONEY_API_BASE_URL = url(unavailable);
  const truemoney = require('../src/services/truemoney');
  const uncertain = await truemoney.redeemAngpao('https://gift.truemoney.com/campaign/?v=safety-test', '0801234567');
  assert.equal(uncertain.success, false);
  assert.equal(uncertain.code, 'PROVIDER_UNCERTAIN');
  assert.equal(uncertain.recoverable, true);
  assert.equal(calls, 1, 'a provider response must never trigger a second redemption attempt');

  const healthy = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, status: 200, message: 'รับเงินสำเร็จ', data: { amount: '10.00', name: 'Tester' } }));
  });
  process.env.TRUEMONEY_API_BASE_URL = url(healthy);
  const result = await truemoney.redeemAngpao('https://gift.truemoney.com/campaign/?v=safety-test', '0801234567');
  assert.equal(result.success, true);
  assert.equal(result.amount, 10);
  assert.equal(result.providerBase, url(healthy));
  unavailable.close();
  healthy.close();
  console.log('TrueMoney provider safety checks passed: no unsafe cross-provider retry');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
