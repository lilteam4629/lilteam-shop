(function () {
  'use strict';
  if (window.__lilteamProductGallery) return;
  window.__lilteamProductGallery = true;
  var cards = [], timer = null, observer = null, sizingFrame = 0, sizingImages = new Set();
  // Read every image frame before writing styles to avoid repeated forced layouts.
  function reserveSpace(image) {
    if (!image.isConnected) return;
    sizingImages.add(image);
    if (sizingFrame) return;
    sizingFrame = requestAnimationFrame(function () {
      // Let the newly swapped page paint before measuring intrinsic image frames.
      sizingFrame = requestAnimationFrame(function () {
      sizingFrame = 0;
      var measurements = [];
      sizingImages.forEach(function (item) {
        if (!item.isConnected) return;
        var parentStyle = getComputedStyle(item.parentElement);
        var imageStyle = getComputedStyle(item);
        if (imageStyle.position === "absolute" || parentStyle.aspectRatio !== "auto") return;
        var box = item.getBoundingClientRect();
        if (box.width && box.height) measurements.push({ image: item, ratio: box.width + " / " + box.height });
      });
      sizingImages.clear();
      measurements.forEach(function (item) {
        item.image.style.setProperty("aspect-ratio", item.ratio, "important");
        item.image.style.setProperty("height", "auto", "important");
        item.image.style.setProperty("object-fit", "contain", "important");
      });
      });
    });
  }
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  function sources(value) {
    try { return JSON.parse(value || '[]').filter(function (url) { return typeof url === 'string' && url.trim(); }); }
    catch (_) { return []; }
  }
  function display(image, urls, index, slide, done) {
    var ticket = (image.__galleryTicket || 0) + 1;
    image.__galleryTicket = ticket;
    var next = new Image();
    var settled = false;
    var timeout = setTimeout(function () { finish(null); next.onload = next.onerror = null; next.src = ''; }, 12000);
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (done) done(result);
    }
    next.onload = function () {
      if (settled) return;
      if (!image.isConnected || image.__galleryTicket !== ticket) { finish(null); return; }
      // Animate only the existing image: extra image children can alter theme grid sizing.
      if (image.__galleryAnimation) image.__galleryAnimation.cancel();
      image.src = urls[index];
      if (!reduced.matches && image.animate) {
        image.__galleryAnimation = image.animate([
          { opacity: 0.25, transform: 'scale(0.985)' },
          { opacity: 1, transform: 'scale(1)' }
        ], { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
      finish(index);
    };
    next.onerror = function () { finish(null); };
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
    if (sizingFrame) cancelAnimationFrame(sizingFrame);
    sizingFrame = 0;
    sizingImages.clear();
    if (timer) clearInterval(timer);
    timer = null;
    if (observer) observer.disconnect();
    observer = null;
    cards.forEach(function (entry) {
      entry.image.__galleryTicket = (entry.image.__galleryTicket || 0) + 1;
      if (entry.image.__galleryAnimation) entry.image.__galleryAnimation.cancel();
    });
    cards = [];
  }
  function start() {
    cleanup();
    document.querySelectorAll('[data-product-images]').forEach(function (image) {
      var urls = sources(image.dataset.productImages);
      if (urls.length < 2) return;
      var entry = { image: image, urls: urls, index: Math.max(0, urls.indexOf(image.getAttribute('src'))), visible: false, busy: false };
      if (image.complete) reserveSpace(image);
      else image.addEventListener('load', function () { reserveSpace(image); }, { once: true });
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
      if (document.hidden || reduced.matches || document.documentElement.classList.contains('page-is-scrolling')) return;
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
