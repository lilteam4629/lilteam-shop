const assert=require('node:assert/strict'),fs=require('node:fs'),ejs=require('ejs');
const layout=fs.readFileSync('src/views/layouts/main.ejs','utf8');
const a=layout.indexOf("  <% if (typeof settings !== 'undefined' && settings.systemModules && settings.systemModules.rain"),b=layout.indexOf('  <% } %>',a)+10;
const block=layout.slice(a,b);
for(const intensity of ['light','medium','heavy']){
 const html=ejs.render(block,{settings:{systemModules:{rain:true},rain:{enabled:true,color:'#123456',intensity}}});
 assert.equal((html.match(/class="store-rain-layer"/g)||[]).length,2);
 assert.ok(!html.includes('<script')&&!html.includes('<canvas'),'no per-frame JavaScript or canvas painting');
 const tiles=html.match(/data:image\/svg\+xml,[^']+/g);assert.equal(tiles.length,2);const svg=decodeURIComponent(tiles[1].split(',')[1]);
 assert.equal((svg.match(/<path /g)||[]).length,{light:4,medium:8,heavy:12}[intensity]);assert.ok(svg.includes('#123456'));
 assert.ok(html.includes('translate3d(0,768px,0)'));assert.ok(!/scroll|navigating|visibility:hidden|display:none/.test(html),'scroll/navigation must not hide or pause rain');
}
assert.ok(!ejs.render(block,{settings:{systemModules:{rain:false},rain:{enabled:true}}}).includes('id="store-rain"'));
assert.ok(!ejs.render(block,{settings:{systemModules:{rain:true},rain:{enabled:false}}}).includes('id="store-rain"'));
const unsafe=ejs.render(block,{settings:{systemModules:{rain:true},rain:{enabled:true,color:'\" onload=alert(1)',intensity:'bad'}}});assert.ok(!unsafe.includes('alert(1)'));
for(const color of ['#000000','#ffffff']){const html=ejs.render(block,{settings:{systemModules:{rain:true},rain:{enabled:true,color,intensity:'medium'}}});const tiles=html.match(/data:image\/svg\+xml,[^']+/g).map(t=>decodeURIComponent(t.split(',')[1]));const colors=tiles.map(t=>t.match(/stroke="(#[0-9a-f]+)"/)[1]);assert.notEqual(colors[0],'#000000','dark mode rain must not be black on black');assert.notEqual(colors[1],'#ffffff','light mode rain must not be white on white');assert.ok(html.includes('html.light #store-rain'));assert.ok(!html.includes('animation:none'),'explicit rain continues under reduced motion at a slower speed');}
assert.ok(layout.includes("!document.getElementById('store-rain') && document.startViewTransition"));assert.ok(layout.includes("top: 0, behavior: 'instant'"));
console.log('Rain render regression passed: two continuous layers, density/color safety, feature flags, lightweight navigation');
