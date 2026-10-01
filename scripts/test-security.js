'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const security = require('../src/middleware/security');
const { readJson, writeJson } = require('../src/services/atomic-json');
async function run() {
  const app = express();
  app.set('trust proxy',security.trustedProxies);
  app.use(security.headers, security.requestFirewall, security.sameOrigin);
  app.use(express.json({ limit: '1kb' }));
  app.post('/write', (req, res) => res.json({ ok: true }));
  app.post('/internal/api/check', (req,res) => security.equalSecret(req.get('X-Internal-Secret'),'fixture-secret') ? res.json({ok:true}) : res.sendStatus(403));
  app.get('/account', (req,res)=>res.send('private'));
  app.get('/ip', (req,res)=>res.json({ip:req.ip,host:req.hostname}));
  app.use(security.errorResponse);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const previousEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try {
    for (const origin of ['https://evil.example','http://sibling.localhost','null']) assert.equal((await fetch(base+'/write',{method:'POST',headers:{Origin:origin}})).status,403);
    assert.equal((await fetch(base+'/write',{method:'POST'})).status,403);
    assert.equal((await fetch(base+'/write',{method:'POST',headers:{Origin:base}})).status,200);
    assert.equal((await fetch(base+'/write',{method:'POST',headers:{Referer:base+'/form'}})).status,200);
    assert.equal((await fetch(base+'/write',{method:'POST',headers:{Origin:base,'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await fetch(base+'/internal/api/check',{method:'POST',headers:{'X-Internal-Secret':'wrong'}})).status,403);
    assert.equal((await fetch(base+'/internal/api/check',{method:'POST',headers:{'X-Internal-Secret':'fixture-secret'}})).status,200);
    assert.equal((await fetch(base+'/write',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'x'})).status,400);
    assert.equal((await fetch(base+'/write',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({x:'a'.repeat(2000)})})).status,413);
    for (const p of ['/data/cloud-data.json','/.env','/.git/config','/sessions/id.json']) assert.equal((await fetch(base+p)).status,404);
    const response = await fetch(base+'/account');
    assert.match(response.headers.get('cache-control'),/no-store/);
    assert.match(response.headers.get('content-security-policy'),/object-src 'none'/);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(response.headers.get('x-xss-protection'),'0');
    const address = await (await fetch(base+'/ip',{headers:{'X-Forwarded-For':'192.0.2.99, 203.0.113.7, 173.245.48.5, 172.18.0.1','X-Forwarded-Host':'evil.example'}})).json();
    assert.equal(address.ip,'203.0.113.7'); assert.equal(address.host,'127.0.0.1');
  } finally { process.env.NODE_ENV = previousEnv || ''; await new Promise(resolve=>server.close(resolve)); }
  let now = 1000;
  const limiter = security.createLimiter({limit:2,windowMs:1000,maxKeys:2,clock:()=>now});
  function hit(ip) { let status=200; const result={set(){return this},status(code){status=code;return this},send(){return this}};limiter({ip},result,()=>{});return status; }
  assert.equal(hit('1.1.1.1'),200); assert.equal(hit('1.1.1.1'),200);assert.equal(hit('1.1.1.1'),429);
  assert.equal(hit('2.2.2.2'),200);assert.equal(hit('3.3.3.3'),503);
  now+=1001;assert.equal(hit('3.3.3.3'),200);
  assert.equal(security.addressKey('2001:db8::1'),security.addressKey('2001:db8::ffff'));
  assert.equal(security.addressKey('::ffff:192.0.2.1'),'192.0.2.1');
  assert.equal(security.equalSecret('',''),false);
  // Render the real filter JSON boundary with a script-closing payload.
  const ejs = require('ejs');
  const templatePath = path.join(__dirname, '../src/views/partials/filter-panel.ejs');
  if (fs.existsSync(templatePath)) {
    const expression = fs.readFileSync(templatePath,'utf8').match(/<%-\s*\(JSON.stringify\(_activeIds\)\)[\s\S]*?%>/)[0];
    const rendered = ejs.render(expression,{_activeIds:['</script><script>alert(1)</script>']});
    assert.equal(rendered.includes('</script>'),false);
    assert.deepEqual(JSON.parse(rendered),['</script><script>alert(1)</script>']);
  }
  let denied=false;
  security.bindSession({tenantShop:{id:'other'},session:{userId:'admin',siteScope:'platform',destroy(cb){cb();}}},{status(code){denied=code===403;return this},send(){}},()=>assert.fail('Cross-tenant session accepted'));
  assert.equal(denied,true);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'lilteam-security-'));
  try {
    const file=path.join(directory,'data.json');
    writeJson(file,{balance:10});writeJson(file,{balance:20});
    assert.deepEqual(readJson(file+'.bak',()=>null),{balance:10});
    const rename=fs.renameSync;
    fs.renameSync=(a,b)=>{if(b===file)throw new Error('disk failure');return rename(a,b);};
    try {assert.throws(()=>writeJson(file,{balance:99}),/disk failure/);}finally{fs.renameSync=rename;}
    assert.deepEqual(readJson(file,()=>null),{balance:20});
    fs.writeFileSync(file,'{bad');assert.throws(()=>readJson(file,()=>({balance:0})),/Cannot read saved/);
    assert.throws(()=>writeJson(file,{balance:0}));
    assert.equal(fs.readFileSync(file,'utf8'),'{bad');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
  console.log('Security checks passed: origin isolation, internal auth, headers, private caching, payload limits, bounded throttling, session isolation, atomic recovery');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
