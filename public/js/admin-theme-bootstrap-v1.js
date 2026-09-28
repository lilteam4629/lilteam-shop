(function () {
  'use strict';

  // Admin dark mode is paused. Start every admin page in light mode before CSS paints.
  var root = document.documentElement;
  root.dataset.adminTheme = 'light';
  root.style.colorScheme = 'light';
})();
