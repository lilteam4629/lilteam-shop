(function () {
  'use strict';
  if (window.__memberSubmissionFeedback) return;
  window.__memberSubmissionFeedback = true;
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form.closest('.promo-member-page')) return;
    if (form.dataset.memberBusy) { event.preventDefault(); return; }
    form.dataset.memberBusy = 'true';
    var button = event.submitter || form.querySelector('button[type="submit"], button:not([type])');
    if (button) { button.setAttribute('aria-busy', 'true'); button.dataset.memberOldLabel = button.textContent; button.textContent = 'กำลังดำเนินการ'; }
  });
  window.addEventListener('pageshow', function () {
    document.querySelectorAll('[data-member-busy]').forEach(function (form) { delete form.dataset.memberBusy; });
    document.querySelectorAll('[data-member-old-label]').forEach(function (button) { button.textContent = button.dataset.memberOldLabel; delete button.dataset.memberOldLabel; button.removeAttribute('aria-busy'); });
  });
})();
