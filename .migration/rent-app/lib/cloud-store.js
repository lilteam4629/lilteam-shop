const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const settings = require('./settings');
const FILE = path.join(settings.DATA_DIR, 'cloud-data.json');
const defaults = () => ({ users: [], walletTransactions: [], topups: [], usedSlipRefs: [], payment: {
  slipProvider: 'easyslip', easyslipApiKey: '', slipokBranchId: '', slipokApiKey: '', slipcheckApiKey: '', slipcheckEndpoint: '', rdcwClientId: '', rdcwClientSecret: '', rdcwEndpoint: '', slip2goApiKey: '', slip2goEndpoint: '',
  promptpayId: '', promptpayName: '', promptpayQrImage: '', bankName: '', bankAccountNumber: '', bankAccountName: '', bankQrImage: '',
  truemoneyEnabled: false, truemoneyPhone: ''
} });
function load() { try { return { ...defaults(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return defaults(); } }
let data = load(), chain = Promise.resolve();
function save() { const temp=FILE+'.tmp'; fs.writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600}); fs.renameSync(temp,FILE); }
function transact(fn) { const run=async()=>{const out=await fn(data);save();return out}; const task=chain.then(run,run);chain=task.catch(()=>{});return task; }
function id(bytes=8){return crypto.randomBytes(bytes).toString('hex')}
function user(id){return data.users.find(u=>u.id===id&&u.status!=='banned')||null}
function publicUser(u){return u&&{id:u.id,username:u.username,email:u.email,walletBalance:Number(u.walletBalance)||0,status:u.status,createdAt:u.createdAt,migratedFromMain:Boolean(u.migratedFromMain)}}
function payment(){data.payment={...defaults().payment,...data.payment};return data.payment}
module.exports={get data(){return data},transact,id,user,publicUser,payment,save,FILE};
