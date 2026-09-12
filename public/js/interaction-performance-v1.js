(function(){
  var prefetched=new Set();
  function eligibleLink(target){
    var link=target&&target.closest&&target.closest('a[href]');
    if(!link||link.target==='_blank'||link.hasAttribute('download'))return null;
    var url;try{url=new URL(link.href,location.href)}catch(_){return null}
    if(url.origin!==location.origin||url.pathname==='/logout'||url.pathname.startsWith('/uploads/'))return null;
    return {link:link,url:url};
  }
  function prefetch(event){
    var connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    if(connection&&(connection.saveData||/2g/.test(connection.effectiveType||'')))return;
    var item=eligibleLink(event.target);
    if(!item||prefetched.has(item.url.href)||item.url.href===location.href)return;
    prefetched.add(item.url.href);
    var hint=document.createElement('link');hint.rel='prefetch';hint.href=item.url.href;hint.as='document';document.head.appendChild(hint);
  }
  document.addEventListener('pointerover',function(event){if(!event.pointerType||event.pointerType==='mouse')prefetch(event)},{passive:true});
  document.addEventListener('focusin',prefetch);
  document.addEventListener('pointerdown',function(event){var control=event.target.closest('button,a[href],[role="button"]');if(!control)return;control.classList.add('ui-pressed');setTimeout(function(){control.classList.remove('ui-pressed')},180)},{passive:true});
  document.addEventListener('submit',function(event){
    if(event.defaultPrevented)return;
    var form=event.target;
    requestAnimationFrame(function(){if(event.defaultPrevented)return;form.classList.add('ui-submitting');var button=event.submitter;if(button){button.setAttribute('aria-busy','true');button.classList.add('ui-submit-pending')}});
  });
  window.addEventListener('pageshow',function(){
    document.querySelectorAll('.ui-submitting').forEach(function(form){form.classList.remove('ui-submitting')});
    document.querySelectorAll('.ui-submit-pending').forEach(function(button){button.classList.remove('ui-submit-pending');button.removeAttribute('aria-busy')});
  });
  var mobileQuery=window.matchMedia('(max-width: 900px) and (pointer: coarse)');
  var scrollTimer=0;
  window.addEventListener('scroll',function(){
    if(!mobileQuery.matches)return;
    document.documentElement.classList.add('mobile-is-scrolling');
    clearTimeout(scrollTimer);
    scrollTimer=setTimeout(function(){document.documentElement.classList.remove('mobile-is-scrolling')},140);
  },{passive:true});
})();
