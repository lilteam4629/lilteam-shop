(function () {
  'use strict';
  var root = document.documentElement;
  var panel = document.getElementById('walletWait');
  var timer, controller, stopped = false;
  function render(result) {
    var waiting = result.status === 'processing';
    panel.dataset.status = result.status;
    panel.setAttribute('aria-busy', String(waiting));
    root.classList.toggle('wallet-processing', waiting);
    panel.querySelector('.wallet-wait-icon').textContent = waiting ? '◷' : result.status === 'approved' ? '✓' : '!';
    panel.querySelector('h1').textContent = waiting ? 'กำลังเติมเงินให้คุณ' : result.status === 'approved' ? 'เติมเงินสำเร็จ' : 'เติมเงินไม่สำเร็จ';
    panel.querySelector('.wallet-wait-message').textContent = waiting ? 'ระบบกำลังรับซองและบันทึกยอดเงิน กรุณารอสักครู่ ไม่ต้องส่งลิงก์ซ้ำ' : result.status === 'approved' ? 'เพิ่มยอดเงินเข้ากระเป๋าของคุณเรียบร้อยแล้ว' : result.message || 'ไม่สามารถรับเงินจากซองนี้ได้ กรุณาตรวจสอบลิงก์';
    var amount = panel.querySelector('.wallet-wait-amount');
    amount.hidden = result.status !== 'approved';
    amount.textContent = '฿' + Number(result.amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
    panel.querySelector('.wallet-wait-actions').hidden = waiting;
    return waiting;
  }
  async function poll() {
    if (stopped) return;
    var waiting = true;
    controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 12000);
    try {
      var response = await fetch('/account/topup/truemoney/status/' + encodeURIComponent(panel.dataset.claimId) + '?format=json', { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('status unavailable');
      var result = await response.json();
      if (!stopped) waiting = render(result);
    } catch (_) {
      if (!stopped) panel.querySelector('.wallet-wait-message').textContent = 'กำลังเชื่อมต่อเพื่อตรวจยอดอีกครั้ง รายการยังถูกติดตามต่อ ไม่ต้องส่งลิงก์ซ้ำ';
    } finally { clearTimeout(timeout); }
    if (waiting && !stopped) timer = setTimeout(poll, 2500);
  }
  function cleanup() { stopped = true; clearTimeout(timer); if (controller) controller.abort(); root.classList.remove('wallet-processing'); }
  if (panel) {
    if (render(JSON.parse(document.getElementById('walletInitialStatus').textContent))) poll();
    window.addEventListener('pagehide', cleanup);
    window.addEventListener('pageshow', function (event) { if (event.persisted) { stopped = false; if (panel.dataset.status === 'processing') poll(); } });
    document.addEventListener('lilteam:page-unloading', cleanup, { once: true });
  }
  if (window.__walletSubmitOverlay) return;
  window.__walletSubmitOverlay = true;
  document.addEventListener('click', function (event) { if (root.classList.contains('wallet-processing')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  document.addEventListener('keydown', function (event) { if (root.classList.contains('wallet-processing') && ['Tab', 'Escape'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  window.addEventListener('pageshow', function () { var old = document.getElementById('walletSubmitWait'); if (old) old.remove(); if (!document.getElementById('walletWait')) root.classList.remove('wallet-processing'); });
  document.addEventListener('submit', function (event) {
    if (!event.target.matches('form[action="/account/topup/truemoney"]')) return;
    root.classList.add('wallet-processing');
    var overlay = document.createElement('div');
    overlay.id = 'walletSubmitWait'; overlay.className = 'wallet-wait'; overlay.dataset.status = 'processing'; overlay.setAttribute('role', 'status');
    overlay.innerHTML = '<div class="wallet-wait-card"><div class="wallet-wait-icon" aria-hidden="true">◷</div><h1>กำลังเติมเงินให้คุณ</h1><p>ระบบกำลังรับซองและตรวจสอบยอดเงิน กรุณารอสักครู่</p></div>';
    document.body.appendChild(overlay);
  });
})();
