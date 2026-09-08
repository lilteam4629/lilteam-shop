(function(){
  const pages=[
    ['ภาพรวมร้านค้า','/admin','▦'],['รายการสินค้า','/admin/products','□'],['ตั้งเวลาเปิดขาย','/admin/scheduled-products','◷'],
    ['คลังตัวกรอง','/admin/filter-tags','◇'],['หมวดหมู่หน้าแรก','/admin/home-sections','▱'],['คำสั่งซื้อ','/admin/orders','☷'],
    ['เติมเงินและตรวจสลิป','/admin/topups','◫'],['คูปองส่วนลด','/admin/coupons','⌁'],['จัดการสมาชิก','/admin/users','♙'],
    ['มินิเกม','/admin/minigame','◎'],['รูปและป้ายประกาศ','/admin/appearance','▧'],['ตั้งค่าร้าน','/admin/settings','⚙']
  ];
  const root=document.createElement('div');root.className='admin-command';root.innerHTML='<button class="admin-command-trigger" type="button" aria-label="ค้นหาเมนู">⌕<span>ค้นหาเมนู</span><kbd>Ctrl K</kbd></button><div class="admin-command-modal" aria-hidden="true"><button class="admin-command-backdrop" type="button"></button><section><div class="admin-command-input"><span>⌕</span><input placeholder="พิมพ์ชื่อเมนูหรือสิ่งที่ต้องการจัดการ..." autocomplete="off"><kbd>ESC</kbd></div><div class="admin-command-results"></div><p>กด ↑ ↓ เพื่อเลือก และ Enter เพื่อเปิด</p></section></div>';document.body.append(root);
  const modal=root.querySelector('.admin-command-modal'),input=root.querySelector('input'),results=root.querySelector('.admin-command-results');let shown=[],index=0;
  function render(){const q=input.value.trim().toLowerCase();shown=pages.filter(p=>p[0].toLowerCase().includes(q));index=Math.min(index,Math.max(0,shown.length-1));results.innerHTML=shown.map((p,i)=>'<a href="'+p[1]+'" class="'+(i===index?'is-current':'')+'"><i>'+p[2]+'</i><span>'+p[0]+'</span><b>→</b></a>').join('')||'<div class="admin-command-empty">ไม่พบเมนูที่ค้นหา</div>'}
  function open(value){modal.classList.toggle('is-open',value);modal.setAttribute('aria-hidden',value?'false':'true');if(value){input.value='';index=0;render();setTimeout(()=>input.focus(),30)}}
  root.querySelector('.admin-command-trigger').onclick=()=>open(true);root.querySelector('.admin-command-backdrop').onclick=()=>open(false);input.oninput=render;input.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();index=Math.min(index+1,shown.length-1);render()}if(e.key==='ArrowUp'){e.preventDefault();index=Math.max(index-1,0);render()}if(e.key==='Enter'&&shown[index])location.href=shown[index][1]};document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();open(true)}else if(e.key==='Escape')open(false)});render();

  document.querySelectorAll('main table').forEach((table,tableIndex)=>{
    const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    const rows=[...table.querySelectorAll('tbody tr')].filter(row=>!row.classList.contains('table-empty-search-row'));
    rows.forEach(row=>[...row.children].forEach((cell,i)=>cell.dataset.label=headers[i]||''));
    if(!rows.length||table.closest('.admin-smart-table'))return;
    const shell=document.createElement('div');shell.className='admin-smart-table';table.parentNode.insertBefore(shell,table);shell.appendChild(table);
    const tools=document.createElement('div');tools.className='admin-table-tools';tools.innerHTML='<label><span>⌕</span><input placeholder="ค้นหาในรายการนี้..."></label><div><span class="admin-table-count">'+rows.length+' รายการ</span><button type="button" class="admin-density-toggle">มุมมองกระชับ</button></div>';shell.insertBefore(tools,table);
    const search=tools.querySelector('input'),count=tools.querySelector('.admin-table-count');search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();let visible=0;rows.forEach(row=>{const match=row.textContent.toLowerCase().includes(q);row.hidden=!match;if(match)visible++});count.textContent=visible+' รายการ'});
    tools.querySelector('.admin-density-toggle').onclick=e=>{shell.classList.toggle('is-compact');e.currentTarget.textContent=shell.classList.contains('is-compact')?'มุมมองปกติ':'มุมมองกระชับ'};
    table.dataset.smartTable=tableIndex;
  });
  document.querySelectorAll('main img').forEach(img=>{if(!img.loading)img.loading='lazy';img.decoding='async'});
})();
