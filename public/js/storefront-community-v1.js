(function () {
  'use strict';
  if (window.storefrontCommunityLoaded) return;
  window.storefrontCommunityLoaded = true;

  let dispose = null;
  function mount() {
    if (dispose) dispose();
    const section = document.querySelector('[data-community-orders]');
    if (!section) { dispose = null; return; }

    const shell = section.querySelector('[data-community-shell]');
    const track = section.querySelector('[data-community-track]');
    const original = section.querySelector('[data-community-original]');
    const toggle = section.querySelector('[data-community-toggle]');
    if (!shell || !track || !original || !toggle) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let hovered = window.matchMedia('(hover: hover)').matches && section.matches(':hover');
    let focused = section.contains(document.activeElement);
    let paused = toggle.getAttribute('aria-pressed') === 'true';
    let interacting = false;
    let resumeTimer = 0;
    let frame = 0;
    let step = 0;

    function sync() {
      toggle.disabled = motion.matches || !original.querySelector('[data-community-order]');
      section.classList.toggle('is-scrolling', visible && !document.hidden && !hovered && !focused && !paused && !interacting && !motion.matches && step > 0);
    }

    function measure() {
      frame = 0;
      track.querySelectorAll('[data-community-clone]').forEach(node => node.remove());
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      const groupWidth = original.getBoundingClientRect().width;
      if (!groupWidth) { step = 0; sync(); return; }
      step = groupWidth + gap;
      const requiredWidth = shell.clientWidth + step + 24;
      while (track.scrollWidth < requiredWidth && track.children.length < 12) {
        const clone = original.cloneNode(true);
        clone.removeAttribute('data-community-original');
        clone.setAttribute('data-community-clone', '');
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('a, button').forEach(element => element.setAttribute('tabindex', '-1'));
        track.appendChild(clone);
      }
      track.style.setProperty('--community-order-step', step + 'px');
      track.style.setProperty('--community-order-duration', Math.max(12, step / 55).toFixed(2) + 's');
      sync();
    }
    function scheduleMeasure() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    function resumeSoon() {
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => { interacting = false; sync(); }, 1400);
    }
    function pauseForInteraction() {
      window.clearTimeout(resumeTimer);
      interacting = true;
      sync();
    }

    toggle.addEventListener('click', () => {
      paused = !paused;
      const label = paused ? 'เล่นการเลื่อนอัตโนมัติ' : 'หยุดการเลื่อนอัตโนมัติ';
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.querySelector('path').setAttribute('d', paused ? 'm9 5 10 7-10 7Z' : 'M8 5v14M16 5v14');
      sync();
    }, { signal });
    section.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') hovered = true; sync(); }, { signal });
    section.addEventListener('pointerleave', () => { hovered = false; resumeSoon(); sync(); }, { signal });
    section.addEventListener('focusin', () => { focused = true; sync(); }, { signal });
    section.addEventListener('focusout', event => { focused = section.contains(event.relatedTarget); sync(); }, { signal });
    shell.addEventListener('pointerdown', pauseForInteraction, { signal });
    shell.addEventListener('pointerup', resumeSoon, { signal });
    shell.addEventListener('pointercancel', resumeSoon, { signal });
    shell.addEventListener('scroll', () => {
      if (step && shell.scrollLeft >= step) shell.scrollLeft -= step;
      pauseForInteraction();
      resumeSoon();
    }, { passive: true, signal });
    shell.addEventListener('keydown', event => {
      if (event.target !== shell || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      pauseForInteraction();
      shell.scrollBy({ left: event.key === 'ArrowRight' ? 240 : -240, behavior: 'smooth' });
      resumeSoon();
    }, { signal });
    document.addEventListener('visibilitychange', sync, { signal });
    motion.addEventListener('change', sync);
    let observer = null;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, { threshold: 0.05 });
      observer.observe(shell);
    } else { visible = true; }
    let resizeObserver = null;
    if ('ResizeObserver' in window) { resizeObserver = new ResizeObserver(scheduleMeasure); resizeObserver.observe(shell); }
    else window.addEventListener('resize', scheduleMeasure, { signal });
    measure();
    document.fonts?.ready?.then(() => { if (!signal.aborted) scheduleMeasure(); });
    dispose = () => {
      controller.abort();
      window.clearTimeout(resumeTimer);
      if (frame) cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      motion.removeEventListener('change', sync);
      section.classList.remove('is-scrolling');
    };
  }
  document.addEventListener('lilteam:page-loaded', mount);
  window.addEventListener('pageshow', mount);
  window.addEventListener('pagehide', () => { if (dispose) dispose(); dispose = null; });
  mount();
})();
