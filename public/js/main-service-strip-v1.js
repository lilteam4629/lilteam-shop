(function () {
  'use strict';
  if (window.mainServiceStripLoaded) return;
  window.mainServiceStripLoaded = true;
  const clockFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const pointerMotion = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  let strips = [], observer = null, controller = null, timer = null, frame = 0;

  function renderTime() {
    const value = clockFormat.format(new Date());
    const [hour, minute, second] = value.split(':').map(Number);
    strips.filter(strip => strip.classList.contains('is-visible')).forEach(strip => {
      const time = strip.querySelector('[data-main-service-time]');
      if (time) time.textContent = value;
      for (const [selector, angle] of [
        ['[data-service-hour]', hour % 12 * 30 + minute / 2],
        ['[data-service-minute]', minute * 6 + second / 10],
        ['[data-service-second]', second * 6],
      ]) {
        const hand = strip.querySelector(selector);
        if (hand) hand.style.transform = `rotate(${angle}deg)`;
      }
    });
  }
  function syncClock() {
    if (timer) { clearInterval(timer); timer = null; }
    strips.forEach(strip => strip.classList.toggle('is-paused', document.hidden));
    if (!document.hidden && strips.some(strip => strip.classList.contains('is-visible'))) {
      renderTime();
      timer = window.setInterval(renderTime, 1000);
    }
  }
  function initialize() {
    if (controller) controller.abort();
    if (observer) observer.disconnect();
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (timer) { clearInterval(timer); timer = null; }
    controller = new AbortController();
    strips = Array.from(document.querySelectorAll('[data-main-service-strip]'));
    if (!strips.length) return;
    strips.forEach(strip => {
      const resetPointer = () => {
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        ['--service-tilt-x', '--service-tilt-y', '--service-pointer-x', '--service-pointer-y'].forEach(key => strip.style.removeProperty(key));
      };
      strip.addEventListener('pointermove', event => {
        if (!pointerMotion.matches || event.pointerType === 'touch') return;
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = 0;
          const bounds = strip.getBoundingClientRect();
          const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
          const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
          strip.style.setProperty('--service-tilt-x', `${(0.5 - y) * 1.6}deg`);
          strip.style.setProperty('--service-tilt-y', `${(x - 0.5) * 1.2}deg`);
          strip.style.setProperty('--service-pointer-x', `${x * 100}%`);
          strip.style.setProperty('--service-pointer-y', `${y * 100}%`);
        });
      }, { passive: true, signal: controller.signal });
      strip.addEventListener('pointerleave', resetPointer, { signal: controller.signal });
    });
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => entry.target.classList.toggle('is-visible', entry.isIntersecting));
        syncClock();
      }, { threshold: 0.05 });
      strips.forEach(strip => observer.observe(strip));
    } else {
      strips.forEach(strip => strip.classList.add('is-visible'));
      syncClock();
    }
  }
  document.addEventListener('visibilitychange', syncClock);
  document.addEventListener('lilteam:page-loaded', initialize);
  window.addEventListener('pagehide', () => { if (timer) { clearInterval(timer); timer = null; } });
  window.addEventListener('pageshow', initialize);
  initialize();
})();
