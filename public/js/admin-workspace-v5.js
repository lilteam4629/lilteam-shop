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
    if (!table.querySelector('tbody tr')) return;
    table.classList.add('ws-card-table');
    const toolbar = document.createElement('div');
    toolbar.className = 'ws-view-switch';
    toolbar.innerHTML = '<span>รูปแบบรายการ</span><div><button type="button" data-view="cards">▦ การ์ด</button><button type="button" data-view="table">☷ ตาราง</button></div>';
    const storageKey = `lilteam_admin_view_${location.pathname}_${table.id || 'list'}`;
    const setView = (view) => {
      const cards = view !== 'table';
      table.classList.toggle('ws-table-view', !cards);
      toolbar.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.view === (cards ? 'cards' : 'table')));
      try { localStorage.setItem(storageKey, cards ? 'cards' : 'table'); } catch (_) {}
    };
    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (button) setView(button.dataset.view);
    });
    table.parentElement?.insertBefore(toolbar, table);
    let saved = 'cards';
    try { saved = localStorage.getItem(storageKey) || 'cards'; } catch (_) {}
    setView(saved);
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
