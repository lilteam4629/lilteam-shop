(() => {
  document.querySelectorAll('.admin-workspace-view table').forEach((table) => {
    const labels = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
    if (!labels.length) return;
    table.classList.add('ws-mobile-table');
    table.querySelectorAll('tbody tr').forEach((row) => {
      [...row.children].forEach((cell, index) => {
        if (!cell.hasAttribute('colspan')) cell.dataset.wsLabel = labels[index] || 'ข้อมูล';
      });
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.activeElement?.matches('input[type="search"], [data-table-search]')) {
      document.activeElement.blur();
      return;
    }
    if ((event.key === '/' || (event.ctrlKey && event.key.toLowerCase() === 'k')) &&
        !document.activeElement?.matches('input, textarea, select, [contenteditable]')) {
      const search = document.querySelector('.admin-workspace-view input[type="search"], .admin-workspace-view [data-table-search], .admin-workspace-view input[name="q"]');
      if (search) {
        event.preventDefault();
        search.focus();
        search.select?.();
      }
    }
  });
})();
