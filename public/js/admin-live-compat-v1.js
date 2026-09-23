(function () {
  async function optimizeImage(file) {
    if (!file || !/^image\/(?:jpe?g|png|webp)$/i.test(file.type) || file.size < 450000 || !window.createImageBitmap) return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1920 / bitmap.width, 1920 / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d', { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.84));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp', lastModified: file.lastModified });
    } catch (_) {
      return file;
    } finally {
      bitmap?.close?.();
    }
  }

  async function uploadFile(file) {
    file = await optimizeImage(file);
    const response = await fetch('/admin/media/direct-upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });
    const signed = await response.json();
    if (!response.ok || !signed.ok) throw new Error(signed.error || 'สร้างลิงก์ฝากรูปไม่สำเร็จ');
    const uploaded = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!uploaded.ok) throw new Error('ส่งรูปไป Cloudflare R2 ไม่สำเร็จ (' + uploaded.status + ')');
    return signed.publicUrl;
  }

  window.lilteamDirectUploadFiles = async function (files, onProgress) {
    const output = new Array(files.length);
    let next = 0;
    let done = 0;
    async function worker() {
      while (next < files.length) {
        const index = next++;
        output[index] = await uploadFile(files[index]);
        done++;
        onProgress?.(done, files.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
    return output;
  };

  document.addEventListener('submit', async function (event) {
    if (event.defaultPrevented) return;
    const form = event.target;
    if ((form.getAttribute('action') || '').includes('/products/bulk-import')) return;
    const inputs = Array.from(form.elements || []).filter(input => input.type === 'file'
      && input.name !== 'slip' && input.files && input.files.length);
    if (!inputs.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = form.querySelector('button[type="submit"],input[type="submit"]');
    if (button) { button.disabled = true; button.dataset.oldText = button.textContent; button.textContent = 'กำลังฝากรูป...'; }
    try {
      for (const input of inputs) {
        const files = Array.from(input.files);
        const urls = await window.lilteamDirectUploadFiles(files, (done, total) => {
          if (button) button.textContent = 'กำลังฝากรูป ' + done + '/' + total;
        });
        const urlField = document.createElement('input');
        urlField.type = 'hidden'; urlField.name = input.name + 'R2Urls'; urlField.value = JSON.stringify(urls); form.appendChild(urlField);
        const nameField = document.createElement('input');
        nameField.type = 'hidden'; nameField.name = input.name + 'R2Names'; nameField.value = JSON.stringify(files.map(file => file.name)); form.appendChild(nameField);
        input.required = false; input.value = '';
      }
      if (button) button.disabled = false;
      form.requestSubmit(button || undefined);
    } catch (_) {
      if (button) { button.disabled = false; button.textContent = 'กำลังอัปโหลดแบบสำรอง...'; }
      HTMLFormElement.prototype.submit.call(form);
    }
  }, true);

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-table-search]').forEach(input => {
      const table = document.querySelector(input.getAttribute('data-table-search'));
      if (!table) return;
      input.addEventListener('input', function () {
        const term = this.value.toLowerCase().trim();
        const rows = table.querySelectorAll('tbody tr');
        let visibleCount = 0;
        rows.forEach(row => {
          const matches = row.textContent.toLowerCase().includes(term);
          row.style.display = matches ? '' : 'none';
          if (matches) visibleCount++;
        });
        const emptyRow = table.querySelector('.table-empty-search-row');
        if (emptyRow) emptyRow.style.display = visibleCount === 0 && term ? '' : 'none';
      });
    });
  });
})();
