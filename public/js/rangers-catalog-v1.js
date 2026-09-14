(()=>{
  const root=document.querySelector('[data-public-ranger-catalog]');
  if(!root)return;
  const grid=root.querySelector('[data-rv-grid]'),input=root.querySelector('input'),count=root.querySelector('[data-rv-count]'),more=root.querySelector('[data-rv-more]');
  let view='all',page=1,pages=1,timer,busy=false;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function choose(name){const search=document.querySelector('#rm-search');if(!search)return;search.value=name;search.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#rm-finder')?.scrollIntoView({behavior:'smooth',block:'start'});}
  async function load(reset=false){
    if(busy)return;
    if(reset){page=1;pages=1;grid.innerHTML=''}
    if(page>pages)return;
    busy=true;if(more){more.hidden=true;more.disabled=true}
    const query=new URLSearchParams({view,page:String(page),limit:'60',q:input.value});
    try{const response=await fetch('/api/rangers-catalog?'+query);if(!response.ok)throw Error('catalog');const data=await response.json();pages=data.pages;grid.insertAdjacentHTML('beforeend',data.items.map(r=>`<article role="button" tabindex="0" data-ranger-name="${esc(r.name)}" title="เลือก ${esc(r.name)}"><img src="${esc(r.imageUrl)}" alt="${esc(r.name)}" loading="lazy"><b>${r.grade}★</b><span>${esc(r.name)}</span><small>${esc(r.form)}</small></article>`).join(''));count.textContent=`${data.total.toLocaleString()} ตัวละคร`;}
    catch{count.textContent='โหลดคลังไม่สำเร็จ'}
    busy=false;
  }
  function loadNextWhenNeeded(){if(grid.scrollLeft+grid.clientWidth>=grid.scrollWidth-240&&page<pages&&!busy){page++;load();}}
  grid.addEventListener('scroll',loadNextWhenNeeded,{passive:true});
  grid.addEventListener('click',e=>{const card=e.target.closest('[data-ranger-name]');if(card)choose(card.dataset.rangerName)});
  grid.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const card=e.target.closest('[data-ranger-name]');if(card){e.preventDefault();choose(card.dataset.rangerName)}}});
  root.querySelectorAll('[data-rv-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.rvView;root.querySelectorAll('[data-rv-view]').forEach(x=>x.classList.toggle('is-active',x===button));load(true)}));
  input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),250)});
  more?.addEventListener('click',()=>{if(page<pages){page++;load()}});
  load(true);
})();
