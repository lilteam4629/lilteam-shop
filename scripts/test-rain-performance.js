const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const layout=fs.readFileSync('src/views/layouts/main.ejs','utf8');
const begin=layout.indexOf("      const canvas=document.getElementById('store-rain')"),end=layout.indexOf('    })();',begin);
const code=layout.slice(begin,end).replace(/<%-[^\n]*%>/g,JSON.stringify('medium'));
for(const mobile of [false,true]){
 let time=0,clears=0,next=0,observer,navigating=false;
 const timers=new Map(),frames=new Map(),listeners={};
 const ctx={setTransform(){},clearRect(){clears++},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
 const canvas={style:{},getContext:()=>ctx};
 const doc={hidden:false,getElementById:()=>canvas,documentElement:{classList:{contains:()=>navigating}},addEventListener:(n,f)=>listeners[n]=f};
 vm.runInNewContext('(function(){'+code+'})();',{document:doc,matchMedia:q=>({matches:q.includes('900px')&&mobile}),innerWidth:mobile?390:1440,innerHeight:900,devicePixelRatio:3,performance:{now:()=>time},requestAnimationFrame:f=>{const id=++next;frames.set(id,f);return id},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(f,delay)=>{const id=++next;timers.set(id,{f,at:time+delay});return id},clearTimeout:id=>timers.delete(id),addEventListener:(n,f)=>listeners[n]=f,MutationObserver:class{constructor(f){observer=f}observe(){}},Math});
 function advance(ms){for(let target=time+ms;time<target;){time=Math.min(target,time+10);for(const [id,t] of [...timers])if(t.at<=time){timers.delete(id);t.f()}for(const [id,f]of [...frames]){frames.delete(id);f(time)}}}
 advance(1000);assert.ok(clears>10&&clears<=31,'bounded paint rate');
 listeners.scroll();const before=clears;assert.equal(frames.size,0);assert.equal(canvas.style.visibility,'hidden');advance(150);listeners.scroll();advance(150);assert.equal(clears,before,'no painting throughout scroll');advance(300);assert.ok(clears>before);
 navigating=true;observer();const nav=clears;advance(1000);assert.equal(clears,nav);assert.equal(frames.size,0);assert.equal(timers.size,0,'no animation scheduling during navigation');
 navigating=false;observer();observer();advance(200);assert.ok(clears>nav);assert.ok(timers.size+frames.size<=1,'single animation loop');
 doc.hidden=true;listeners.visibilitychange();const hidden=clears;advance(500);assert.equal(clears,hidden);
 listeners.scroll();advance(500);assert.equal(clears,hidden,'scroll debounce cannot restart hidden page');doc.hidden=false;listeners.visibilitychange();advance(200);assert.ok(clears>hidden);
 listeners.pagehide();const away=clears;advance(500);assert.equal(clears,away);listeners.pageshow();advance(200);assert.ok(clears>away,'back navigation resumes');
 assert.ok(canvas.width<= (mobile?390:1440),'bounded canvas resolution');
}
console.log('Desktop/mobile rain: bounded frames, scroll/navigation cancellation, visibility and back navigation passed');
