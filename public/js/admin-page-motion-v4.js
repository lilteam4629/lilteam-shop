(function(){
  function init(){
    var page=document.querySelector('body.admin-site main.admin-page-surface');
    if(!page)return;
    page.addEventListener('animationend',function(){page.classList.remove('admin-page-entering')},{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
