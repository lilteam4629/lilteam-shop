(function () {
  'use strict';
  if (window.__lilteamProductGallery) return;
  window.__lilteamProductGallery = true;
  var cards = [], timer = null, observer = null;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  function sources(value) {
    try { return JSON.parse(value || '[]').filter(function (url) { return typeof url === 'string' && url.trim(); }); }
    catch (_) { return []; }
  }
  function display(image, urls, index, slide, done) {
    var ticket = (image.__galleryTicket || 0) + 1;
    image.__galleryTicket = ticket;
    var next = new Image();
    next.onload = function () {
      if (!image.isConnected || image.__galleryTicket !== ticket) return;
      if (slide && !reduced.matches && image.animate) {
        var previous = image.cloneNode();
        previous.removeAttribute('data-product-images');
        previous.removeAttribute('id');
        previous.alt = '';
        previous.setAttribute('aria-hidden', 'true');
        previous.classList.add('product-gallery-outgoing');
        var parent = image.parentElement;
        parent.classList.add('product-gallery-frame');
        parent.appendChild(previous);
        var leave = previous.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], { duration: 450, easing: 'ease-out' });
        leave.onfinish = leave.oncancel = function () { previous.remove(); };
        image.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 450, easing: 'ease-out' });
      }
      image.src = urls[index];
      if (done) done(index);
    };
    next.onerror = function () { if (done && image.__galleryTicket === ticket) done(null); };
    next.src = urls[index];
  }
  function select(gallery, index) {
    var buttons = Array.from(gallery.querySelectorAll('[data-product-thumbnail]'));
    var image = gallery.querySelector('.product-detail-primary-image, .product-detail-hero-image');
    if (!image || !buttons.length) return;
    index = (index + buttons.length) % buttons.length;
    gallery.__selectedImage = index;
    display(image, buttons.map(function (button) { return button.dataset.productImage; }), index, false, function (shown) {
      if (shown === null) return;
      buttons.forEach(function (button, i) { button.setAttribute('aria-pressed', String(i === shown)); });
      var counter = gallery.querySelector('[data-product-image-count]');
      if (counter) counter.textContent = (shown + 1) + ' / ' + buttons.length;
    });
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-product-thumbnail], [data-product-image-step]');
    if (!button) return;
    var gallery = button.closest('.product-detail-gallery');
    if (!gallery) return;
    event.preventDefault();
    var index = button.hasAttribute('data-product-thumbnail') ? Number(button.dataset.productThumbnail) : (gallery.__selectedImage || 0) + Number(button.dataset.productImageStep);
    select(gallery, index);
  });
  function cleanup() {
    if (timer) clearInterval(timer);
    timer = null;
    if (observer) observer.disconnect();
    observer = null;
    cards = [];
  }
  function start() {
    cleanup();
    document.querySelectorAll('[data-product-images]').forEach(function (image) {
      var urls = sources(image.dataset.productImages);
      if (urls.length < 2) return;
      var entry = { image: image, urls: urls, index: Math.max(0, urls.indexOf(image.getAttribute('src'))), visible: false, busy: false };
      function reserveSpace() {
        if (image.naturalWidth && getComputedStyle(image).position !== 'absolute') {
          image.style.aspectRatio = image.naturalWidth + ' / ' + image.naturalHeight;
          image.style.objectFit = 'contain';
        }
      }
      if (image.complete) reserveSpace();
      else image.addEventListener('load', reserveSpace, { once: true });
      cards.push(entry);
    });
    if (!cards.length) return;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (change) { var card = cards.find(function (entry) { return entry.image === change.target; }); if (card) card.visible = change.isIntersecting; });
      });
      cards.forEach(function (entry) { observer.observe(entry.image); });
    } else cards.forEach(function (entry) { entry.visible = true; });
    timer = setInterval(function () {
      if (document.hidden || reduced.matches) return;
      cards.forEach(function (entry) {
        var host = entry.image.closest('a, button') || entry.image.parentElement;
        if (!entry.visible || entry.busy || !entry.image.isConnected || host.matches(':hover, :focus-within')) return;
        entry.busy = true;
        var index = (entry.index + 1) % entry.urls.length;
        display(entry.image, entry.urls, index, true, function (shown) { entry.busy = false; if (shown !== null) entry.index = shown; });
      });
    }, 4500);
  }
  document.addEventListener('lilteam:page-unloading', cleanup);
  document.addEventListener('lilteam:page-loaded', start);
  window.addEventListener('pagehide', cleanup);
  window.addEventListener('pageshow', start);
  start();
})();
