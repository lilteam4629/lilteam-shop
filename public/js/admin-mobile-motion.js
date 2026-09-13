(function(){
  var observer=null;
  function init(){
    var nodes=Array.from(document.querySelectorAll('main > section,main > article,main > div,.admin-content > section,.admin-content > article,.admin-content > div')).filter(function(node){
      return !node.closest('[role="dialog"]')&&!node.classList.contains('hidden')&&!(node.classList.contains('fixed')&&node.classList.contains('inset-0'));
    });
    /* A whole admin page must never depend on IntersectionObserver to become
       visible on phones. Dynamic browser chrome and short mobile viewports can
       otherwise leave Products, Top-ups or Minigame at opacity:0. */
    if(window.matchMedia('(max-width: 800px)').matches){
      nodes.forEach(function(node){node.classList.add('scroll-reveal-visible')});
      return;
    }
    nodes.forEach(function(node,index){node.classList.add('scroll-reveal');node.style.setProperty('--reveal-delay',Math.min(index%4,3)*35+'ms')});
    document.documentElement.classList.add('scroll-motion-ready');
    if(!('IntersectionObserver'in window)){nodes.forEach(function(node){node.classList.add('scroll-reveal-visible')});return;}
    observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('scroll-reveal-visible');observer.unobserve(entry.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.06});
    /* Give the browser one real painted frame in the hidden position before
       observing. On fast pages the observer previously revealed nodes in the
       same frame, so Products and a few small admin pages appeared static. */
    requestAnimationFrame(function(){requestAnimationFrame(function(){nodes.forEach(function(node){observer.observe(node)})})});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
