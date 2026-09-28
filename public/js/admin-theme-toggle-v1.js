(function () {
  'use strict';

  // Retained as a safe cache-compatible asset while admin theme switching is paused.
  var root = document.documentElement;
  if (!root) return;
  root.dataset.adminTheme = 'light';
  root.style.colorScheme = 'light';
})();
