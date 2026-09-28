(function () {
  'use strict';

  var theme = 'light';
  try {
    var savedTheme = localStorage.getItem('lilteam_admin_theme');
    if (savedTheme === 'dark' || savedTheme === 'light') theme = savedTheme;
  } catch (_) {}

  var root = document.documentElement;
  root.dataset.adminTheme = theme;
  root.style.colorScheme = theme;
})();
