(function () {
  'use strict';

  var teardown = null;

  function mount() {
    if (teardown) teardown();
    teardown = null;

    var section = document.querySelector('[data-latest-orders]');
    if (!section) return;

    var shell = section.querySelector('.latest-orders-shell');
    var track = section.querySelector('.latest-orders-track');
    var original = track && track.querySelector('.latest-orders-group');
    if (!shell || !track || !original) return;

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var visible = false;
    var userPaused = false;
    var resizeFrame = 0;

    function measure() {
      resizeFrame = 0;
      var styles = getComputedStyle(track);
      var gap = parseFloat(styles.columnGap || styles.gap) || 0;
      var groupWidth = original.getBoundingClientRect().width;
      if (!groupWidth) return;

      var step = groupWidth + gap;
      // One or two recent orders still fill a wide screen without exposing a
      // blank area at the instant the seamless loop returns to its start.
      while (track.scrollWidth - step < shell.clientWidth + 24 && track.children.length < 16) {
        var copy = original.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        copy.querySelectorAll('a, button, input, select, textarea').forEach(function (element) {
          element.setAttribute('tabindex', '-1');
        });
        track.appendChild(copy);
      }

      track.style.setProperty('--latest-orders-step', step + 'px');
      track.style.setProperty('--latest-orders-offset', -step + 'px');
      track.style.setProperty('--latest-orders-duration', Math.max(10, step / 55).toFixed(2) + 's');
    }

    function scheduleMeasure() {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(measure);
    }

    function update() {
      var reduced = reducedMotion.matches;
      var motionAllowed = !reduced;
      shell.classList.toggle('is-visible', visible && !document.hidden && motionAllowed);
      shell.classList.toggle('is-user-paused', userPaused || !motionAllowed);
    }

    function pauseForInteraction() {
      if (reducedMotion.matches || userPaused) return;
      userPaused = true;
      update();
    }

    function onMotionChange() {
      update();
    }

    function onShellKeydown(event) {
      if (event.target !== shell || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      pauseForInteraction();
      shell.scrollBy({ left: event.key === 'ArrowRight' ? 220 : -220, behavior: 'smooth' });
    }

    var observer = null;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        update();
      }, { rootMargin: '100px 0px', threshold: 0.01 });
      observer.observe(shell);
    } else {
      visible = true;
    }

    var resizeObserver = null;
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(shell);
    } else {
      window.addEventListener('resize', scheduleMeasure, { passive: true });
    }

    shell.addEventListener('pointerdown', pauseForInteraction, { passive: true });
    shell.addEventListener('wheel', pauseForInteraction, { passive: true });
    shell.addEventListener('keydown', onShellKeydown);
    document.addEventListener('visibilitychange', update);
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionChange);
    else reducedMotion.addListener(onMotionChange);

    scheduleMeasure();
    update();

    teardown = function () {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      if (observer) observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', scheduleMeasure);
      shell.removeEventListener('pointerdown', pauseForInteraction);
      shell.removeEventListener('wheel', pauseForInteraction);
      shell.removeEventListener('keydown', onShellKeydown);
      document.removeEventListener('visibilitychange', update);
      if (reducedMotion.removeEventListener) reducedMotion.removeEventListener('change', onMotionChange);
      else reducedMotion.removeListener(onMotionChange);
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  document.addEventListener('lilteam:page-loaded', mount);
  document.addEventListener('lilteam:page-unloading', function () {
    if (teardown) teardown();
    teardown = null;
  });
})();
