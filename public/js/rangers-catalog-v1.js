(()=>{
  const root=document.querySelector('[data-public-ranger-catalog]');
  if(!root)return;
  const grid=root.querySelector('[data-rv-grid]'),input=root.querySelector('input'),count=root.querySelector('[data-rv-count]'),more=root.querySelector('[data-rv-more]'),clear=root.querySelector('#rm-clear-selection');
  let view='all',page=1,pages=1,timer,busy=false;const selected=new Map(),pendingCodes=new Set((new URLSearchParams(location.search).get('rangers')||'').split(',').map(code=>code.trim()).filter(Boolean));
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function syncSelection(){if(clear)clear.hidden=!selected.size;const market=document.querySelector('[data-rangers-market]');if(market){market.dataset.rangerSelection=[...selected.keys()].join('|');market.dispatchEvent(new CustomEvent('ranger-selection',{detail:{codes:[...selected.keys()],names:[...selected.values()]}}))}const count=document.querySelector('#rm-selected-count'),names=document.querySelector('#rm-selection-names'),summary=document.querySelector('#rm-selection-summary');if(count)count.textContent=selected.size;if(names)names.textContent=[...selected.values()].join(' · ');if(summary)summary.hidden=!selected.size}
  function choose(name,code,card){if(selected.has(code)){selected.delete(code)}else{selected.set(code,name)};card?.classList.toggle('is-selected',selected.has(code));card?.setAttribute('aria-pressed',selected.has(code)?'true':'false');syncSelection();if(selected.size)document.querySelector('#rm-finder')?.scrollIntoView({behavior:'smooth',block:'start'});}
  async function load(reset=false){
    if(busy)return;
    if(reset){page=1;pages=1;grid.innerHTML=''}
    if(page>pages)return;
    busy=true;if(more){more.hidden=true;more.disabled=true}
    const query=new URLSearchParams({view,page:String(page),limit:'60',q:input.value});
    try{const response=await fetch('/api/rangers-catalog?'+query);if(!response.ok)throw Error('catalog');const data=await response.json();pages=data.pages;append(data.items);count.textContent=`${data.total.toLocaleString()} ตัวละคร`;}
    catch{count.textContent='โหลดคลังไม่สำเร็จ'}
    busy=false;
  }
  function append(items){grid.insertAdjacentHTML('beforeend',items.map(r=>`<article role="button" tabindex="0" aria-pressed="false" data-ranger-code="${esc(r.code)}" data-ranger-name="${esc(r.name)}" title="เลือก ${esc(r.name)}"><img src="${esc(r.imageUrl)}" alt="${esc(r.name)}" loading="lazy"><b>${r.grade}★</b><span>${esc(r.name)}</span><small>${esc(r.form||r.gearType||'')}</small></article>`).join(''));items.forEach(r=>{if(pendingCodes.has(r.code)){selected.set(r.code,r.name);pendingCodes.delete(r.code);const card=grid.querySelector(`[data-ranger-code="${CSS.escape(r.code)}"]`);card?.classList.add('is-selected');card?.setAttribute('aria-pressed','true')}});syncSelection()}
  async function loadPending(){if(!pendingCodes.size)return;const codes=[...pendingCodes];try{const response=await fetch('/api/rangers-catalog?view=all&limit=100&codes='+encodeURIComponent(codes[0]));if(response.ok){const data=await response.json();append(data.items)}}catch{} }
  function loadNextWhenNeeded(){const nearEnd=grid.scrollHeight>grid.clientHeight?grid.scrollTop+grid.clientHeight>=grid.scrollHeight-240:grid.scrollLeft+grid.clientWidth>=grid.scrollWidth-240;if(nearEnd&&page<pages&&!busy){page++;load();}}
  grid.addEventListener('scroll',loadNextWhenNeeded,{passive:true});
  grid.addEventListener('click',e=>{const card=e.target.closest('[data-ranger-name]');if(card)choose(card.dataset.rangerName,card.dataset.rangerCode,card)});
  grid.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const card=e.target.closest('[data-ranger-name]');if(card){e.preventDefault();choose(card.dataset.rangerName,card.dataset.rangerCode,card)}}});
  root.querySelectorAll('[data-rv-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.rvView;selected.clear();syncSelection();grid.querySelectorAll('.is-selected').forEach(x=>{x.classList.remove('is-selected');x.setAttribute('aria-pressed','false')});root.querySelectorAll('[data-rv-view]').forEach(x=>x.classList.toggle('is-active',x===button));load(true)}));
  clear?.addEventListener('click',()=>{selected.clear();grid.querySelectorAll('.is-selected').forEach(x=>{x.classList.remove('is-selected');x.setAttribute('aria-pressed','false')});syncSelection()});
  input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),250)});
  more?.addEventListener('click',()=>{if(page<pages){page++;load()}});
  load(true).then(loadPending);
})();
