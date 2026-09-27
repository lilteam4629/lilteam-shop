(function () {
  'use strict';

  var root = document.documentElement;
  var toggle = document.querySelector('[data-admin-theme-toggle]');
  if (!root || !toggle) return;

  function applyTheme(theme, persist) {
    var normalized = theme === 'dark' ? 'dark' : 'light';
    root.dataset.adminTheme = normalized;
    root.style.colorScheme = normalized;
    toggle.setAttribute('aria-pressed', String(normalized === 'dark'));

    var action = normalized === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด';
    toggle.setAttribute('aria-label', 'เปลี่ยนเป็น' + action);
    toggle.title = 'เปลี่ยนเป็น' + action;

    if (persist) {
      try { localStorage.setItem('lilteam_admin_theme', normalized); } catch (_) {}
    }
  }

  applyTheme(root.dataset.adminTheme, false);
  toggle.addEventListener('click', function () {
    applyTheme(root.dataset.adminTheme === 'dark' ? 'light' : 'dark', true);
  });
})();
