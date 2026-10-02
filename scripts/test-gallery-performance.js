const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let tick,scrolling=false;const timers=new Map(),requests=[];let id=0;
const image={dataset:{productImages:'["a.png","b.png"]'},isConnected:true,complete:false,getAttribute:()=> 'a.png',addEventListener(){},closest:()=>({matches:()=>false})};
function Image(){requests.push(this);}
vm.runInNewContext(fs.readFileSync('public/js/product-gallery-v1.js','utf8'),{window:{matchMedia:()=>({matches:false}),addEventListener(){}},document:{hidden:false,documentElement:{classList:{contains:()=>scrolling}},querySelectorAll:()=>[image],addEventListener(){}},Image,setInterval:fn=>{tick=fn;return 1},clearInterval(){},setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:id=>timers.delete(id),JSON,Array,Number});
tick();assert.equal(requests.length,1);tick();assert.equal(requests.length,1,'in-flight image must not duplicate requests');
[...timers.values()][0]();tick();assert.equal(requests.length,2,'stalled image must release busy state and allow retry');
scrolling=true;tick();assert.equal(requests.length,2,'gallery must yield during scroll');
console.log('Gallery timeout recovery, bounded concurrent image loading and scroll yield passed');
