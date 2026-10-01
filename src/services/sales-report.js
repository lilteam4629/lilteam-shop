const formatter = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', year:'numeric',month:'2-digit',day:'2-digit' });
function buildSalesReport(orders, now = new Date()) {
  const today = formatter.format(now);
  const anchor = new Date(today + 'T12:00:00+07:00');
  function bucket(key,label) { return {key,label,amount:0,orderCount:0,products:[]}; }
  const daily = Array.from({length:7},(_,i)=>{const date=new Date(anchor.getTime()-(6-i)*86400000);return bucket(formatter.format(date),date.toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',weekday:'short',day:'numeric',month:'short'}));});
  const monthly = Array.from({length:12},(_,i)=>{const date=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-1-(11-i),1,5));return bucket(formatter.format(date).slice(0,7),date.toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',month:'short',year:'2-digit'}));});
  const dayMap=new Map(daily.map(b=>[b.key,b])),monthMap=new Map(monthly.map(b=>[b.key,b]));
  for(const order of orders || []) {
    if(order.status==='cancelled'||order.salesChannel==='catalog-api-fulfillment')continue;
    const date=new Date(order.createdAt);if(!Number.isFinite(date.getTime())||date>now)continue;
    const key=formatter.format(date),amount=Math.max(0,Math.round((Number(order.total)||0)*100));
    const items=order.items||[],weights=items.map(item=>Math.max(0,Number(item.price)||0)),weightTotal=weights.reduce((a,b)=>a+b,0);
    for(const b of [dayMap.get(key),monthMap.get(key.slice(0,7))].filter(Boolean)) {
      b.amount+=amount;b.orderCount++;let allocated=0;
      items.forEach((item,i)=>{const net=i===items.length-1?amount-allocated:Math.round(amount*(weightTotal?weights[i]/weightTotal:1/items.length));allocated+=net;const id=String(item.productId||item.title||'unknown');let product=b.products.find(p=>p.id===id);if(!product){product={id,title:item.title||'สินค้าไม่ระบุชื่อ',units:0,amount:0};b.products.push(product);}product.units+=Math.max(1,Number(item.quantity)||1);product.amount+=net;});
      if(!items.length){let p=b.products.find(p=>p.id==='unlisted');if(!p){p={id:'unlisted',title:'รายการเดิมที่ไม่มีข้อมูลสินค้า',units:0,amount:0};b.products.push(p);}p.amount+=amount;}
    }
  }
  for(const b of [...daily,...monthly]){b.amount/=100;b.products.forEach(p=>p.amount/=100);b.products.sort((a,b)=>b.amount-a.amount);}
  return {daily,monthly};
}
module.exports={buildSalesReport};
