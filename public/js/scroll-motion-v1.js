(function(){
  var observer=null,scheduled=false,revealFrame=0,pendingReveals=new Set();
  var storefrontSelector=['.banner-hero-shell','.modern-fan-heading','.store-announcements','.latest-orders-section','.store-filter-section','.store-content-section','.premium-product-card','.catalog-card','.admin-content > section','.admin-content > article'];
  var adminSelector=['body.admin-site main > section','body.admin-site main > article','body.admin-site main > div'];
  function setup(){
    scheduled=false;
    if(observer)observer.disconnect();
    var nodes=Array.from(document.querySelectorAll(storefrontSelector.concat(adminSelector).join(','))).filter(function(node){return !node.closest('#page-loading-overlay,[role="dialog"]')});
    nodes.forEach(function(node,index){
      if(node.dataset.scrollMotion)return;
      node.dataset.scrollMotion='1';node.classList.add('scroll-reveal');
      if(node.closest('body.admin-site'))node.classList.add('scroll-reveal-admin');
      if(node.classList.contains('premium-product-card')||node.classList.contains('catalog-card'))node.classList.add('scroll-reveal-card');
      if(node.classList.contains('banner-hero-shell'))node.classList.add('scroll-reveal-banner');
      var delay=node.classList.contains('scroll-reveal-admin')?Math.min(index%4,3)*35:(node.classList.contains('scroll-reveal-card')?Math.min(index%5,4)*28:0);
      node.style.setProperty('--reveal-delay',delay+'ms');
    });
    document.documentElement.classList.add('scroll-motion-ready');
    if(!('IntersectionObserver'in window)){nodes.forEach(function(node){node.classList.add('scroll-reveal-visible')});return;}
    observer=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){if(entry.isIntersecting)pendingReveals.add(entry.target)});
      if(!pendingReveals.size||revealFrame)return;
      revealFrame=requestAnimationFrame(function(){pendingReveals.forEach(function(node){
        node.classList.add('scroll-reveal-visible');observer.unobserve(node);
        if(node.classList.contains('scroll-reveal-card'))node.addEventListener('animationend',function(){node.classList.add('scroll-reveal-complete')},{once:true});
      });pendingReveals.clear();revealFrame=0});
    },{rootMargin:'0px 0px -7% 0px',threshold:.02});
    requestAnimationFrame(function(){nodes.forEach(function(node){if(!node.classList.contains('scroll-reveal-visible'))observer.observe(node)})});
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(setup)}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
  document.addEventListener('lilteam:page-loaded',schedule);
})();
