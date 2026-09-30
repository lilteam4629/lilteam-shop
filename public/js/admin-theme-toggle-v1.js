(function () {
  'use strict';

  var root = document.documentElement;
  if (!root) return;

  function updateButtons(mode) {
    var nextLabel = mode === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด';
    var nextDescription = mode === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
    document.querySelectorAll('[data-admin-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
      button.setAttribute('aria-label', nextDescription);
      button.setAttribute('title', nextDescription);
      var label = button.querySelector('[data-admin-theme-label]');
      if (label) label.textContent = nextLabel;
    });
  }

  function setMode(mode, persist) {
    mode = mode === 'dark' ? 'dark' : 'light';
    root.classList.add('admin-theme-switching');
    root.dataset.adminTheme = mode;
    root.style.colorScheme = mode;
    root.style.backgroundColor = mode === 'dark' ? '#0b0f14' : '#f6f8f8';
    root.style.color = mode === 'dark' ? '#f4f7fa' : '#14201d';
    root.classList.toggle('light', mode === 'light');
    root.classList.toggle('dark', mode === 'dark');
    if (persist) {
      try {
        localStorage.setItem('lilteam_admin_theme', mode);
      } catch (error) {
        // Keep the switch usable for this page even when persistence is blocked.
      }
    }
    updateButtons(mode);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.remove('admin-theme-switching');
      });
    });
  }

  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest('[data-admin-theme-toggle]');
    if (!button) return;
    setMode(root.dataset.adminTheme === 'dark' ? 'light' : 'dark', true);
  });

  updateButtons(root.dataset.adminTheme === 'dark' ? 'dark' : 'light');
})();
