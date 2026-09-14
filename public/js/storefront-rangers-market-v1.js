(()=>{
  const root=document.querySelector('[data-rangers-market]');
  if(!root)return;
  const grid=root.querySelector('#rm-grid'),cards=[...grid.children],search=root.querySelector('#rm-search'),stock=root.querySelector('#rm-stock'),sort=root.querySelector('#rm-sort'),limit=root.querySelector('#rm-limit'),hideSold=root.querySelector('#rm-hide-sold'),count=root.querySelector('#rm-count'),filterCount=root.querySelector('#rm-filter-count'),empty=root.querySelector('#rm-empty');let selectedCodes=[];
  function render(){
    const tokens=search.value.trim().toLocaleLowerCase('th').split(/\s+/).filter(Boolean),mode=stock.value;
    const selectedFilter=selectedCodes.length
      ? c=>selectedCodes.some(code=>(c.dataset.rangerCodes||'').split(',').includes(code))
      : ()=>true;
    let visible=cards.filter(c=>selectedFilter(c)&&(!tokens.length||tokens.every(t=>c.dataset.title.includes(t)))&&(mode==='all'||c.dataset.stock===mode)&&(!hideSold?.checked||c.dataset.stock!=='sold'));
    visible.sort((a,b)=>sort.value==='low'?+a.dataset.price-+b.dataset.price:sort.value==='high'?+b.dataset.price-+a.dataset.price:sort.value==='new'?+b.dataset.index-+a.dataset.index:+a.dataset.index-+b.dataset.index);
    const max=Number(limit?.value||visible.length); cards.forEach(c=>c.hidden=true);
    visible.slice(0,max).forEach(c=>{c.hidden=false;grid.appendChild(c)});
    count.textContent=visible.length; if(filterCount)filterCount.textContent=visible.length; empty.hidden=visible.length!==0;
  }
  search.addEventListener('input',render,{passive:true}); stock.addEventListener('change',render); sort.addEventListener('change',render); limit?.addEventListener('change',render); hideSold?.addEventListener('change',render);
  root.addEventListener('ranger-selection',e=>{selectedCodes=e.detail?.codes||[];render()});
  root.querySelector('#rm-reset').addEventListener('click',()=>{search.value='';stock.value='all';sort.value='default';if(limit)limit.value='20';if(hideSold)hideSold.checked=false;render()});
  render();
})();
