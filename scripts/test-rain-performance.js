const assert=require('node:assert/strict'),fs=require('node:fs'),ejs=require('ejs');
const layout=fs.readFileSync('src/views/layouts/main.ejs','utf8');
const a=layout.indexOf("  <% if (typeof settings !== 'undefined' && settings.systemModules && settings.systemModules.rain"),b=layout.indexOf('  <% } %>',a)+10;
const block=layout.slice(a,b);
for(const intensity of ['light','medium','heavy']){
 const html=ejs.render(block,{settings:{systemModules:{rain:true},rain:{enabled:true,color:'#123456',intensity}}});
 assert.equal((html.match(/class="store-rain-layer"/g)||[]).length,2);
 assert.ok(!html.includes('<script')&&!html.includes('<canvas'),'no per-frame JavaScript or canvas painting');
 const tile=html.match(/data:image\/svg\+xml,[^']+/)[0];const svg=decodeURIComponent(tile.split(',')[1]);
 assert.equal((svg.match(/<path /g)||[]).length,{light:4,medium:8,heavy:12}[intensity]);assert.ok(svg.includes('#123456'));
 assert.ok(html.includes('translate3d(0,768px,0)'));assert.ok(!/scroll|navigating|visibility:hidden|display:none/.test(html),'scroll/navigation must not hide or pause rain');
}
assert.ok(!ejs.render(block,{settings:{systemModules:{rain:false},rain:{enabled:true}}}).includes('id="store-rain"'));
assert.ok(!ejs.render(block,{settings:{systemModules:{rain:true},rain:{enabled:false}}}).includes('id="store-rain"'));
const unsafe=ejs.render(block,{settings:{systemModules:{rain:true},rain:{enabled:true,color:'\" onload=alert(1)',intensity:'bad'}}});assert.ok(!unsafe.includes('alert(1)'));
assert.ok(layout.includes("!document.getElementById('store-rain') && document.startViewTransition"));assert.ok(layout.includes("top: 0, behavior: 'instant'"));
console.log('Rain render regression passed: two continuous layers, density/color safety, feature flags, lightweight navigation');
