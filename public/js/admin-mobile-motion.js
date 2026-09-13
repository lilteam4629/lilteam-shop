(function(){
  var observer=null;
  function init(){
    var nodes=Array.from(document.querySelectorAll('main > section,main > article,main > div,.admin-content > section,.admin-content > article,.admin-content > div')).filter(function(node){return !node.closest('[role="dialog"]')});
    nodes.forEach(function(node,index){node.classList.add('scroll-reveal');node.style.setProperty('--reveal-delay',Math.min(index%4,3)*35+'ms')});
    document.documentElement.classList.add('scroll-motion-ready');
    if(!('IntersectionObserver'in window)){nodes.forEach(function(node){node.classList.add('scroll-reveal-visible')});return;}
    observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('scroll-reveal-visible');observer.unobserve(entry.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.06});
    requestAnimationFrame(function(){nodes.forEach(function(node){observer.observe(node)})});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
