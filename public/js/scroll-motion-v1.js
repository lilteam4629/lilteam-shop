(function(){
  var observer=null,scheduled=false;
  var selector=['.banner-hero-shell','.modern-fan-heading','.store-announcements','.latest-orders-section','.store-filter-section','.store-content-section','.premium-product-card','.admin-content > section','.admin-content > article','.admin-content > div'].join(',');
  function setup(){
    scheduled=false;
    if(observer)observer.disconnect();
    var nodes=Array.from(document.querySelectorAll(selector)).filter(function(node){return !node.closest('#page-loading-overlay,[role="dialog"]')});
    nodes.forEach(function(node,index){
      if(node.dataset.scrollMotion)return;
      node.dataset.scrollMotion='1';node.classList.add('scroll-reveal');
      if(node.classList.contains('premium-product-card'))node.classList.add('scroll-reveal-card');
      if(node.classList.contains('banner-hero-shell'))node.classList.add('scroll-reveal-banner');
      var delay=node.classList.contains('premium-product-card')?Math.min(index%5,4)*42:0;
      node.style.setProperty('--reveal-delay',delay+'ms');
    });
    document.documentElement.classList.add('scroll-motion-ready');
    if(!('IntersectionObserver'in window)){nodes.forEach(function(node){node.classList.add('scroll-reveal-visible')});return;}
    observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('scroll-reveal-visible');observer.unobserve(entry.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.06});
    requestAnimationFrame(function(){nodes.forEach(function(node){if(!node.classList.contains('scroll-reveal-visible'))observer.observe(node)})});
    setTimeout(function(){nodes.forEach(function(node){if(!node.classList.contains('scroll-reveal-visible'))node.classList.add('scroll-reveal-visible')})},900);
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(setup)}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
  document.addEventListener('lilteam:page-loaded',schedule);
})();
