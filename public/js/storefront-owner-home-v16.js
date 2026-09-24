(function () {
  'use strict';

  var scenes = Array.from(document.querySelectorAll('#site-page-shell.storefront-owner-home-v7 [data-owner-scene]'));
  if (!scenes.length) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var removers = [];
  var inView = new WeakMap();

  function updateSceneVisibility() {
    scenes.forEach(function (scene) {
      var active = Boolean(inView.get(scene)) && !document.hidden;
      scene.dataset.sceneActive = String(active);
      if (!active) {
        var display = scene.querySelector('[data-scene-display]');
        if (display) {
          display.style.setProperty('--scene-x', '0deg');
          display.style.setProperty('--scene-y', '0deg');
        }
      }
    });
  }

  var visibilityObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { inView.set(entry.target, entry.isIntersecting); });
      updateSceneVisibility();
    }, { rootMargin: '80px 0px', threshold: 0.01 })
    : null;

  scenes.forEach(function (scene) {
    inView.set(scene, !visibilityObserver);
    if (visibilityObserver) visibilityObserver.observe(scene);
    scene.dataset.sceneActive = String(!visibilityObserver && !document.hidden);
    var display = scene.querySelector('[data-scene-display]');
    var toggle = scene.querySelector('[data-scene-motion-toggle]');
    var frame = 0;
    var point = { x: 0, y: 0 };

    function setMotion(paused) {
      scene.dataset.sceneMotion = paused ? 'paused' : 'playing';
      if (toggle) {
        toggle.setAttribute('aria-pressed', String(paused));
        toggle.setAttribute('aria-label', paused ? 'เล่นภาพเคลื่อนไหวของฉาก' : 'หยุดภาพเคลื่อนไหวของฉาก');
        var icon = toggle.querySelector('span:first-child');
        var label = toggle.querySelector('span:last-child');
        if (icon) icon.textContent = paused ? '▶' : 'Ⅱ';
        if (label) label.textContent = paused ? 'เล่นฉาก' : 'หยุดฉาก';
      }
      if (paused) resetTilt();
    }

    function resetTilt() {
      if (!display) return;
      display.style.setProperty('--scene-x', '0deg');
      display.style.setProperty('--scene-y', '0deg');
    }

    function applyPointer() {
      frame = 0;
      if (!display || reducedMotion.matches || !finePointer.matches || scene.dataset.sceneMotion === 'paused') return;
      display.style.setProperty('--scene-x', (2 + point.y * 3.5).toFixed(2) + 'deg');
      display.style.setProperty('--scene-y', (point.x * 5).toFixed(2) + 'deg');
    }

    function onPointerMove(event) {
      if (!display || reducedMotion.matches || !finePointer.matches || scene.dataset.sceneMotion === 'paused') return;
      var rect = scene.getBoundingClientRect();
      point.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
      point.y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
      if (!frame) frame = window.requestAnimationFrame(applyPointer);
    }

    function onPointerLeave() {
      point.x = 0;
      point.y = 0;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      resetTilt();
    }

    function onMotionPreferenceChange() {
      scene.dataset.motionPreference = reducedMotion.matches ? 'reduced' : 'full';
      if (reducedMotion.matches) onPointerLeave();
    }

    if (toggle) {
      var onToggle = function () { setMotion(scene.dataset.sceneMotion !== 'paused'); };
      toggle.addEventListener('click', onToggle);
      removers.push(function () { toggle.removeEventListener('click', onToggle); });
    }

    if (display) {
      scene.addEventListener('pointermove', onPointerMove, { passive: true });
      scene.addEventListener('pointerleave', onPointerLeave, { passive: true });
      removers.push(function () {
        scene.removeEventListener('pointermove', onPointerMove);
        scene.removeEventListener('pointerleave', onPointerLeave);
        if (frame) window.cancelAnimationFrame(frame);
      });
    }

    onMotionPreferenceChange();
    reducedMotion.addEventListener('change', onMotionPreferenceChange);
    removers.push(function () { reducedMotion.removeEventListener('change', onMotionPreferenceChange); });
  });

  function onVisibilityChange() { updateSceneVisibility(); }
  document.addEventListener('visibilitychange', onVisibilityChange);
  removers.push(function () { document.removeEventListener('visibilitychange', onVisibilityChange); });
  if (visibilityObserver) removers.push(function () { visibilityObserver.disconnect(); });

  window.addEventListener('pagehide', function (event) {
    if (!event.persisted) removers.forEach(function (remove) { remove(); });
  }, { once: true });
})();
