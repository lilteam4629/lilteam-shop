(function () {
  'use strict';

  var theme = 'light';
  try {
    var savedTheme = localStorage.getItem('lilteam_admin_theme');
    if (savedTheme === 'dark' || savedTheme === 'light') theme = savedTheme;
  } catch (_) {}

  var root = document.documentElement;
  if (theme === 'dark') root.classList.add('admin-theme-booting');
  root.dataset.adminTheme = theme;
  root.style.colorScheme = theme;

  // Keep the first frame behind the dark canvas until the shared surface scan
  // has finished, even if the deferred scanner fails to load for some reason.
  if (theme === 'dark') {
    window.setTimeout(function () {
      root.classList.remove('admin-theme-booting');
    }, 1800);
  }
})();
