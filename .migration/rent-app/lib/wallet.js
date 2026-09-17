const fs=require('fs'),path=require('path');
const store=require('./cloud-store'),paymentService=require('./payment'),truemoney=require('../services/truemoney'),mainApi=require('./mainApi');
const locks=new Set();
function list(userId){return store.data.topups.filter(t=>t.userId===userId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))}
async function create(userId,amount,method){amount=Number(amount);if(!Number.isFinite(amount)||amount<1)return{ok:false,error:'จำนวนเงินไม่ถูกต้อง'};const item={id:store.id(),userId,amount,method,refCode:'TP'+store.id(3).toUpperCase(),status:'pending',createdAt:new Date().toISOString()};await store.transact(d=>d.topups.push(item));return{ok:true,item}}
async function attach(userId,id,file){
  const item=store.data.topups.find(t=>t.id===id&&t.userId===userId);
  if(!item||!['pending','verifying'].includes(item.status))return{ok:false,error:'ไม่พบคำขอหรือรายการจบแล้ว'};
  const ext=path.extname(file.originalname||'').toLowerCase();
  if(!['.jpg','.jpeg','.png','.webp'].includes(ext))return{ok:false,error:'รองรับเฉพาะ JPG, PNG และ WEBP'};
  const name=`slip-${id}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(require('./settings').UPLOADS_DIR,name),file.buffer,{mode:0o600});
  await store.transact(d=>{const x=d.topups.find(t=>t.id===id);x.slipFile=name;x.slipPath=`/account/topup/${id}/slip-file`;x.status='verifying'});
  const check=await paymentService.verify(file.buffer,item.amount,{filename:file.originalname,contentType:file.mimetype});
  if(check.verified){
    const ref=String(check.raw?.transRef||check.raw?.trans_ref||check.raw?.rawSlip?.transRef||'').trim();
    if(!ref){check.verified=false;check.message='ไม่พบเลขอ้างอิงธุรกรรม — รอแอดมินตรวจสอบ';}
    else{
      const claim=await mainApi.claimSlip(ref,id);
      if(!claim.ok){
        check.verified=false;
        check.message=claim.status===409?'สลิปนี้เคยถูกใช้เติมเงินไปแล้ว ไม่สามารถใช้ซ้ำได้':'ยังเชื่อมต่อระบบกันสลิปซ้ำไม่ได้ กรุณาลองใหม่อีกครั้ง';
      }
    }
  }
  await store.transact(d=>{const x=d.topups.find(t=>t.id===id);x.slipCheck=check;if(check.verified){const ref=String(check.raw?.transRef||check.raw?.trans_ref||check.raw?.rawSlip?.transRef||'');if(ref)d.usedSlipRefs.push(ref);const u=d.users.find(u=>u.id===userId);u.walletBalance=Math.round((u.walletBalance+x.amount)*100)/100;x.status='approved';x.reviewedAt=new Date().toISOString();d.walletTransactions.push({id:store.id(),userId,amount:x.amount,type:'topup',note:`เติมเงิน ${x.refCode}`,createdAt:new Date().toISOString()})}else{x.status='pending'}});
  return{ok:true,item:store.data.topups.find(t=>t.id===id)};
}
async function review(id,approve,note=''){
  const current=store.data.topups.find(t=>t.id===id);
  if(!current||!['pending','verifying'].includes(current.status))return{ok:false,error:'รายการถูกดำเนินการแล้ว'};
  if(approve){
    const ref=String(current.slipCheck?.raw?.transRef||current.slipCheck?.raw?.trans_ref||current.slipCheck?.raw?.rawSlip?.transRef||'').trim();
    if(ref){const claim=await mainApi.claimSlip(ref,id);if(!claim.ok)return{ok:false,error:claim.status===409?'สลิปนี้เคยถูกใช้เติมเงินในอีกเว็บแล้ว':'ยังเชื่อมต่อระบบกันสลิปซ้ำไม่ได้ กรุณาลองใหม่'}}
  }
  return store.transact(d=>{const x=d.topups.find(t=>t.id===id);if(!x||!['pending','verifying'].includes(x.status))return{ok:false,error:'รายการถูกดำเนินการแล้ว'};x.status=approve?'approved':'rejected';x.reviewNote=note;x.reviewedAt=new Date().toISOString();if(approve){const u=d.users.find(u=>u.id===x.userId);u.walletBalance=Math.round((u.walletBalance+x.amount)*100)/100;d.walletTransactions.push({id:store.id(),userId:u.id,amount:x.amount,type:'topup',note:`แอดมินอนุมัติ ${x.refCode}`,createdAt:new Date().toISOString()})}return{ok:true,item:x}})
}
async function redeem(userId,input){const p=store.payment();if(!p.truemoneyEnabled||!/^[0-9]{10}$/.test(p.truemoneyPhone||''))return{ok:false,error:'ระบบ TrueMoney ยังไม่พร้อม'};const code=truemoney.extractVoucherCode(input);if(!code||locks.has(code)||store.data.walletTransactions.some(t=>t.voucherCode===code))return{ok:false,error:'ซองนี้ไม่ถูกต้อง ถูกใช้แล้ว หรือกำลังตรวจสอบ'};locks.add(code);try{const r=await truemoney.redeemAngpao(input,p.truemoneyPhone);if(!r.success)return{ok:false,error:r.message};const item={id:store.id(),userId,amount:r.amount,method:'truemoney_angpao',refCode:'TM'+store.id(3).toUpperCase(),status:'approved',createdAt:new Date().toISOString(),reviewedAt:new Date().toISOString(),slipCheck:{checked:true,verified:true,provider:'truemoney_angpao'}};await store.transact(d=>{if(d.walletTransactions.some(t=>t.voucherCode===code))throw new Error('ซองนี้ถูกใช้แล้ว');const u=d.users.find(u=>u.id===userId);u.walletBalance=Math.round((u.walletBalance+r.amount)*100)/100;d.topups.push(item);d.walletTransactions.push({id:store.id(),userId,amount:r.amount,type:'topup',voucherCode:code,note:`TrueMoney ${item.refCode}`,createdAt:item.createdAt})});return{ok:true,item}}finally{locks.delete(code)}}
module.exports={list,create,attach,review,redeem};
