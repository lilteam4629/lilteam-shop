(function () {
  'use strict';

  var root = document.documentElement;
  if (!root) return;

  // Read the saved preference in <head>, before admin stylesheets can paint.
  // This keeps the canvas and native controls stable across full-page navigation.
  var mode = 'light';
  try {
    var saved = localStorage.getItem('lilteam_admin_theme');
    if (saved === 'dark' || saved === 'light') mode = saved;
  } catch (error) {
    // Private browsing and hardened browser settings can disable local storage.
  }

  root.dataset.adminTheme = mode;
  root.style.colorScheme = mode;
  root.style.backgroundColor = mode === 'dark' ? '#1e2220' : '#f6f8f8';
  root.style.color = mode === 'dark' ? '#f2f4f1' : '#14201d';
  root.classList.toggle('light', mode === 'light');
  root.classList.toggle('dark', mode === 'dark');
})();
