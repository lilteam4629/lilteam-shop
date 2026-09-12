(function(){
  var observer=null,scheduled=false;
  var selector='main > section,main > article,.store-content-section,.store-product-gallery,.latest-orders-section,.premium-product-card,.admin-content > section,.admin-content > article,.admin-content > div';
  function reveal(){
    scheduled=false;
    var reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(observer)observer.disconnect();
    var nodes=Array.from(document.querySelectorAll(selector)).filter(function(node){return !node.closest('#page-loading-overlay,[role="dialog"]')});
    nodes.forEach(function(node,index){
      if(!node.dataset.scrollMotion){
        node.dataset.scrollMotion='1';node.classList.add('scroll-reveal');
        var delay=node.classList.contains('premium-product-card')?Math.min(index%5,4)*45:Math.min(index%6,5)*24;
        node.style.setProperty('--reveal-delay',delay+'ms');
      }
      if(document.readyState==='complete'&&node.classList.contains('premium-product-card')&&node.getBoundingClientRect().top>window.innerHeight*1.05)node.classList.remove('scroll-reveal-visible');
      if(reduced||node.getBoundingClientRect().top<window.innerHeight*.96)node.classList.add('scroll-reveal-visible');
    });
    document.documentElement.classList.add('scroll-motion-ready');
    if(reduced||!('IntersectionObserver'in window)){nodes.forEach(function(n){n.classList.add('scroll-reveal-visible')});return;}
    observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('scroll-reveal-visible');observer.unobserve(entry.target)}})},{rootMargin:'0px 0px -5% 0px',threshold:.04});
    nodes.forEach(function(node){if(!node.classList.contains('scroll-reveal-visible'))observer.observe(node)});
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(reveal)}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reveal,{once:true});else reveal();
  window.addEventListener('load',schedule,{once:true});
  document.addEventListener('lilteam:page-loaded',schedule);
})();
