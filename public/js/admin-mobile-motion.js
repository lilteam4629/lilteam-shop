(function(){
  var observer=null;
  function init(){
    var desktop=window.matchMedia('(min-width:801px)').matches;
    var nodes=Array.from(document.querySelectorAll('main > section,main > article,main > div,.admin-content > section,.admin-content > article,.admin-content > div')).filter(function(node){return !node.closest('[role="dialog"]')});
    nodes.forEach(function(node,index){
      node.classList.add('scroll-reveal');
      node.style.setProperty('--reveal-delay',Math.min(index%4,3)*35+'ms');
      /* The whole desktop page already has an entrance spring. Revealing the
         visible children at the same time doubled the scale and looked like a
         flash. Only panels below the first viewport animate while scrolling. */
      if(desktop&&node.getBoundingClientRect().top<window.innerHeight*.94){
        node.classList.add('scroll-reveal-visible','scroll-reveal-complete');
      }
    });
    document.documentElement.classList.add('scroll-motion-ready');
    if(!('IntersectionObserver'in window)){nodes.forEach(function(node){node.classList.add('scroll-reveal-visible')});return;}
    observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){
      entry.target.classList.add('scroll-reveal-visible');observer.unobserve(entry.target);
      entry.target.addEventListener('transitionend',function done(event){if(event.target!==entry.target||event.propertyName!=='transform')return;entry.target.classList.add('scroll-reveal-complete');entry.target.removeEventListener('transitionend',done)},{passive:true});
    }})},{rootMargin:'0px 0px -7% 0px',threshold:.04});
    requestAnimationFrame(function(){nodes.forEach(function(node){if(!node.classList.contains('scroll-reveal-complete'))observer.observe(node)})});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
