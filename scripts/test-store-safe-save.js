'use strict';
const assert = require('node:assert/strict');
const {saveSnapshot} = require('../src/services/store-safe-save');
const {publicAddress,safeUrl,safeLookup} = require('../src/services/outbound-security');
async function run() {
  let document = {_id:'main',_revision:3,balance:100};
  const collection = {async replaceOne(filter,value) {
    if (filter._revision !== document._revision) return {modifiedCount:0};
    document=structuredClone(value); return {modifiedCount:1};
  }};
  assert.equal(await saveSnapshot(collection,'main',{_revision:3,balance:110}),4);
  await assert.rejects(saveSnapshot(collection,'main',{_revision:3,balance:0}),{code:'STORE_WRITE_CONFLICT'});
  assert.equal(document.balance,110);
  await assert.rejects(saveSnapshot({async replaceOne(){const e=new Error('duplicate');e.code=11000;throw e;}},'main',{balance:0}),{code:'STORE_WRITE_CONFLICT'});
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','224.0.0.1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);
  for(const url of ['http://example.com','https://localhost','https://foo.local','https://127.0.0.1','https://[::1]','https://user:pass@example.com','https://example.com:8443'])assert.equal(safeUrl(url),false,url);
  assert.equal(safeUrl('https://example.com/webhook'),true);
  const dns=require('node:dns'),original=dns.lookup;
  try {
    dns.lookup=(host,options,cb)=>cb(null,[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]);
    await assert.rejects(new Promise((resolve,reject)=>safeLookup('rebinding.test',{},(e,a)=>e?reject(e):resolve(a))),{code:'ERR_PRIVATE_ADDRESS'});
    dns.lookup=(host,options,cb)=>cb(null,[{address:'8.8.8.8',family:4}]);
    assert.equal(await new Promise((resolve,reject)=>safeLookup('public.test',{},(e,a)=>e?reject(e):resolve(a))),'8.8.8.8');
  } finally {dns.lookup=original;}
  console.log('Mongo stale-write prevention and webhook network isolation passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
