(function () {
  'use strict';
  if (window.matchMedia('(max-width: 800px)').matches) return;
  var page = document.querySelector('main.admin-page-surface');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var animation;
  function stop() {
    if (animation) animation.cancel();
    animation = null;
  }
  function enter() {
    stop();
    if (!page || !page.animate || reduced.matches || document.hidden) return;
    var mobile = window.matchMedia('(max-width: 800px)').matches;
    animation = page.animate([
      { transform: 'translateY(' + (mobile ? 8 : 12) + 'px) scale(.989)', offset: 0, easing: 'cubic-bezier(.18,.75,.25,1)' },
      { transform: 'translateY(-1px) scale(1.002)', offset: .65, easing: 'cubic-bezier(.35,0,.25,1)' },
      { transform: 'none', offset: 1 }
    ], { duration: mobile ? 380 : 480, fill: 'none' });
    animation.onfinish = function () { animation = null; };
  }
  // Run once per navigation, never on scroll or on individual form controls.
  enter();
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', function (event) { if (event.persisted) stop(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
  // Release the transformed containing block before users open a fixed dialog,
  // focus a field or scroll a long page during the entrance.
  document.addEventListener('pointerdown', stop, { capture: true, passive: true });
  document.addEventListener('keydown', stop, { capture: true });
  window.addEventListener('scroll', stop, { passive: true });
  function preferenceChanged() { if (reduced.matches) stop(); }
  if (reduced.addEventListener) reduced.addEventListener('change', preferenceChanged);
  else if (reduced.addListener) reduced.addListener(preferenceChanged);
})();
