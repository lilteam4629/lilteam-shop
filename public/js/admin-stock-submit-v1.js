(() => {
  const form = document.querySelector('[data-stock-add-form]');
  if (!form || !window.fetch) return;
  const button = form.querySelector('button[type="submit"]');
  const error = document.querySelector('[data-stock-add-error]');
  let submitting = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    button.disabled = true;
    error.hidden = true;
    try {
      const response = await fetch(form.action, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams(new FormData(form)),
      });
      if (!response.ok) throw new Error('save failed');
      const result = await response.json();
      const destination = new URL(result.redirect, location.origin);
      if (destination.origin !== location.origin || !destination.pathname.startsWith('/admin/products')) {
        throw new Error('invalid destination');
      }
      form.reset();
      // Refresh this entry instead of adding another stock page to history.
      // Browser Back returns to the product/category page before stock entry.
      if (destination.pathname === location.pathname) location.reload();
      else location.replace(destination.href);
    } catch (_) {
      error.textContent = 'ยืนยันการบันทึกไม่สำเร็จ กรุณารีเฟรชตรวจสต็อกก่อนส่งซ้ำ';
      error.hidden = false;
      submitting = false;
      button.disabled = false;
    }
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    form.reset();
    submitting = false;
    button.disabled = false;
  });
})();
