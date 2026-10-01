(function () {
  'use strict';
  if (window.purchaseNotificationsMounted) return;
  window.purchaseNotificationsMounted = true;
  var seen = new Set(), pending = [], showing = false, timer, hideTimer, controller;
  var notice = document.createElement('aside');
  notice.className = 'purchase-notice';
  notice.hidden = true;
  notice.setAttribute('aria-label', 'การซื้อสินค้าล่าสุด');
  var message = document.createElement('div');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  var heading = document.createElement('strong');
  var detail = document.createElement('p');
  var close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'ปิดการแจ้งเตือนการซื้อ');
  message.append(heading, detail);
  notice.append(message, close);
  document.body.appendChild(notice);
  function dismiss() {
    clearTimeout(hideTimer);
    notice.hidden = true;
    showing = false;
  }
  close.addEventListener('click', function () { pending = []; dismiss(); });
  function showNext() {
    if (showing || document.hidden || !pending.length) return;
    var cookieDialog = document.getElementById('cookie-consent');
    if (cookieDialog && cookieDialog.getClientRects().length && !cookieDialog.classList.contains('hidden')) return;
    var purchase = pending.shift();
    var age = Date.now() - Date.parse(purchase.createdAt);
    if (age > 600000 || age < 0) return;
    heading.textContent = purchase.buyer + ' ซื้อสินค้าแล้ว';
    detail.textContent = purchase.title + (purchase.quantity > 1 ? ' และสินค้าอื่น รวม ' + purchase.quantity + ' ชิ้น' : '')
      + ' · ' + (age < 60000 ? 'เมื่อสักครู่' : Math.floor(age / 60000) + ' นาทีที่แล้ว');
    showing = true;
    notice.hidden = false;
    hideTimer = setTimeout(dismiss, 6500);
  }
  async function poll() {
    if (document.hidden || controller) return;
    controller = new AbortController();
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, 8000);
    try {
      var response = await fetch('/api/recent-purchases', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      var body = await response.json();
      var purchases = Array.isArray(body.purchases) ? body.purchases : [];
      if (!purchases.length) { pending = []; dismiss(); }
      purchases.slice().reverse().forEach(function (purchase) {
        if (seen.has(purchase.id)) return;
        seen.add(purchase.id);
        pending.push(purchase);
      });
      if (seen.size > 300) seen = new Set(Array.from(seen).slice(-100));
      pending = pending.slice(-5);
      showNext();
    } catch (_) { /* Retry on the next poll without interrupting shopping. */ }
    finally { clearTimeout(timeout); controller = null; }
  }
  function stop() {
    clearInterval(timer);
    if (controller) controller.abort();
    dismiss();
  }
  function start() { clearInterval(timer); poll(); timer = setInterval(poll, 15000); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', start);
  document.addEventListener('click', function (event) {
    if (event.target.closest('#cookie-accept-all, #cookie-necessary-only, #cookie-save-settings')) setTimeout(showNext, 100);
  });
  start();
})();
