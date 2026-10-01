(function () {
  'use strict';
  if (window.storefrontCommunityLoaded) return;
  window.storefrontCommunityLoaded = true;
  let dispose = null;
  function mount() {
    if (dispose) dispose();
    const section = document.querySelector('[data-community-orders]');
    if (!section) { dispose = null; return; }
    const cards = Array.from(section.querySelectorAll('[data-community-order]'));
    const prev = section.querySelector('[data-community-prev]');
    const next = section.querySelector('[data-community-next]');
    const label = section.querySelector('[data-community-page]');
    const toggle = section.querySelector('[data-community-toggle]');
    const controller = new AbortController();
    const signal = controller.signal;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let page = 0, visible = false, hovered = window.matchMedia('(hover: hover)').matches && section.matches(':hover'), focused = section.contains(document.activeElement), paused = toggle.getAttribute('aria-pressed') === 'true', timer = null;
    const wide = window.matchMedia('(min-width: 1100px)');
    const mobile = window.matchMedia('(max-width: 639px)');
    const size = () => mobile.matches ? 1 : wide.matches ? 3 : 2;
    let lastSize = size();
    const pages = () => Math.ceil(cards.length / size());
    function syncTimer() {
      clearInterval(timer); timer = null;
      if (visible && !document.hidden && !hovered && !focused && !paused && !motion.matches && pages() > 1) timer = setInterval(() => show(page + 1, true), 7000);
    }
    function show(index, animate) {
      page = (index + pages()) % pages();
      const start = page * size();
      cards.forEach((card, i) => {
        card.getAnimations().forEach(animation => animation.cancel());
        const position = (i - start + cards.length) % cards.length;
        card.hidden = position >= size();
        card.style.order = position;
        if (!card.hidden && animate && !motion.matches && card.animate) card.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
      });
      label.textContent = (page + 1) + ' / ' + pages();
      prev.disabled = next.disabled = pages() < 2;
      toggle.disabled = pages() < 2 || motion.matches;
    }
    function manual(delta) { show(page + delta, true); syncTimer(); }
    prev.addEventListener('click', () => manual(-1), { signal });
    next.addEventListener('click', () => manual(1), { signal });
    toggle.addEventListener('click', () => {
      paused = !paused;
      toggle.setAttribute('aria-label', paused ? 'เล่นการสลับอัตโนมัติ' : 'หยุดการสลับอัตโนมัติ');
      toggle.title = toggle.getAttribute('aria-label');
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.querySelector('path').setAttribute('d', paused ? 'm9 5 10 7-10 7Z' : 'M8 5v14M16 5v14');
      syncTimer();
    }, { signal });
    section.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') hovered = true; syncTimer(); }, { signal });
    section.addEventListener('pointerleave', () => { hovered = false; syncTimer(); }, { signal });
    section.addEventListener('focusin', () => { focused = true; syncTimer(); }, { signal });
    section.addEventListener('focusout', event => { focused = section.contains(event.relatedTarget); syncTimer(); }, { signal });
    document.addEventListener('visibilitychange', syncTimer, { signal });
    const motionChange = () => { show(page, false); syncTimer(); };
    motion.addEventListener('change', motionChange);
    const resize = () => {
      const focusedIndex = cards.indexOf(document.activeElement);
      const first = focusedIndex >= 0 ? focusedIndex : page * lastSize;
      lastSize = size();
      show(Math.floor(first / lastSize), false);
      syncTimer();
    };
    wide.addEventListener('change', resize);
    mobile.addEventListener('change', resize);
    let observer = null;
    if ('IntersectionObserver' in window) { observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; syncTimer(); }); observer.observe(section); }
    else { visible = true; }
    show(0, false); syncTimer();
    dispose = () => { clearInterval(timer); controller.abort(); if (observer) observer.disconnect(); motion.removeEventListener('change', motionChange); wide.removeEventListener('change', resize); mobile.removeEventListener('change', resize); cards.forEach(card => card.getAnimations().forEach(animation => animation.cancel())); };
  }
  document.addEventListener('lilteam:page-loaded', mount);
  window.addEventListener('pageshow', mount);
  window.addEventListener('pagehide', () => { if (dispose) dispose(); dispose = null; });
  mount();
})();
