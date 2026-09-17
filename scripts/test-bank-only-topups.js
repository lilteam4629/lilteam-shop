// Regression checks for removing PromptPay as a receiver and top-up channel.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
function loadStore() {
  const filename = path.join(root, 'src/data/store.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const mocks = {
    dotenv: { config() {} },
    '../services/r2': { isEnabled: () => false },
    fs: { writeFileSync() { throw new Error('Unexpected file write'); } },
  };
  const sandbox = {
    module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, console, setTimeout, clearTimeout,
    setInterval: () => ({ unref() {} }), clearInterval() {}, process: { env: {} },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
  };
  const source = fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testModel = { defaultData, migrateSchema };';
  vm.runInNewContext(source, sandbox, { filename });
  return module.exports.testModel;
}

const model = loadStore();
const oldData = model.defaultData();
oldData.settings.payment.bankAccountNumber = '1234567890';
oldData.settings.payment.promptpayId = '0812345678';
oldData.settings.payment.promptpayName = 'ชื่อเดิม';
oldData.settings.payment.promptpayQrImage = 'legacy-qr';
oldData.settings.payment.receiverProfiles = {
  slipcheck: { promptpayId: '0812345678', promptpayName: 'ชื่อเดิม', promptpayQrImage: 'legacy-qr', bankAccountNumber: '1234567890' },
  slip2go: { promptpayId: '0812345678', bankAccountNumber: '1234567890' },
};
oldData.topupRequests = [{ id: 'old-topup', method: 'promptpay', status: 'pending' }];
model.migrateSchema(oldData);

for (const field of ['promptpayId', 'promptpayName', 'promptpayNameEn', 'promptpayQrImage']) {
  assert.equal(Object.hasOwn(oldData.settings.payment, field), false, `legacy payment.${field} should be removed`);
  for (const [provider, profile] of Object.entries(oldData.settings.payment.receiverProfiles)) {
    assert.equal(Object.hasOwn(profile, field), false, `legacy ${provider}.${field} should be removed`);
  }
}
assert.equal(oldData.settings.payment.bankAccountNumber, '1234567890', 'bank receiver details must remain');
assert.equal(oldData.topupRequests[0].id, 'old-topup', 'top-up history must remain');

const receiverProfiles = require('../src/services/receiver-profiles');
const sharedPayment = { slipProvider: 'slipcheck', bankName: '', bankAccountNumber: '', bankAccountName: '', receiverProfiles: {
  slipcheck: { bankName: 'ธนาคารกสิกรไทย', bankAccountNumber: '1473368044', bankAccountName: 'Shop Owner' },
} };
assert.equal(receiverProfiles.view(sharedPayment, 'rdcw').bankAccountNumber, '1473368044', 'a new provider must reuse the existing bank account');
const profile = receiverProfiles.saveAndActivate(
  { slipProvider: 'slipcheck', promptpayId: 'legacy-phone' },
  'slipcheck',
  { promptpayId: 'legacy-phone', bankAccountNumber: '1234567890', bankAccountName: 'Shop Owner' },
);
assert.equal(Object.hasOwn(profile, 'promptpayId'), false);
assert.equal(Object.hasOwn(receiverProfiles.view({ slipProvider: 'slipcheck', receiverProfiles: { slipcheck: profile } }, 'slipcheck'), 'promptpayId'), false);

const admin = fs.readFileSync(path.join(root, 'src/views/admin/topups.ejs'), 'utf8');
const bankSettings = admin.split('id="topup-tab-content-bank"')[1].split('id="topup-tab-content-truemoney"')[0];
assert.doesNotMatch(bankSettings, /promptpayId|promptpayName|promptpayQrImage|พร้อมเพย์/);
const customerTopup = fs.readFileSync(path.join(root, 'src/views/shop/topup.ejs'), 'utf8');
assert.doesNotMatch(customerTopup, /value="promptpay"|พร้อมเพย์/);
const accountRoute = fs.readFileSync(path.join(root, 'src/routes/account.js'), 'utf8');
assert.match(accountRoute, /if \(mth !== 'bank_transfer'\)/);
assert.doesNotMatch(accountRoute, /services\/promptpay|generatePayload/);

console.log('Bank-only top-up checks passed: provider settings, legacy-data cleanup, history retention, and server-side channel restriction');
