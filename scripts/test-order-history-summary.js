const assert=require('node:assert/strict');const {summarizeOrders}=require('../src/services/order-history-summary');
const data={products:[{id:'p',title:'Current title',images:['/new.webp']}],stockItems:[{id:'s',username:'private-login',password:'private-password'}]};
const [ordinary,draw,pending]=summarizeOrders([
 {id:'1',status:'completed',items:[{productId:'p',title:'Purchased title',productImage:'/old.webp',stockItemId:'s'},{productId:'p',title:'Purchased title',productImage:'/old.webp'}]},
 {id:'2',status:'completed',items:[{productId:'p',randomBoxDraw:{isWin:true,prizeItems:[{productTitle:'Prize A'},{productTitle:'Prize A'},{productTitle:'Prize B'}]}},{productId:'p',randomBoxDraw:{isWin:false}}]},
 {id:'3',status:'completed',salesChannel:'catalog-api',items:[{productId:'p',fulfillmentMode:'contact'}]}
],data);
assert.equal(ordinary.purchased[0].title,'Purchased title');assert.equal(ordinary.purchased[0].image,'/old.webp');assert.equal(ordinary.receivedCount,2);assert.equal(draw.receivedCount,3);assert.equal(draw.received[0].count,2);assert.equal(draw.misses,1);assert.equal(pending.receivedCount,0);assert.equal(pending.awaiting,1);assert(!JSON.stringify([ordinary,draw,pending]).includes('private-'));assert.deepEqual(summarizeOrders([{items:[]}],{} )[0].purchased,[]);console.log('Order history grouping, snapshot, delivery and privacy checks passed');
