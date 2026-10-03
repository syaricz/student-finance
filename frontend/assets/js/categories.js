/* ============================================================
   categories.js - halaman Kategori (list, tambah, edit, hapus)
   Butuh: api.js, auth.js, Bootstrap bundle (modal)
   Semua teks dari server dirender dengan textContent (anti XSS).
   ============================================================ */
(function () {
  'use strict';

  const EMOJIS = ['🍔', '☕', '🚌', '🏠', '📚', '📱', '🎬', '🎮', '🛍️', '💊', '🎁', '💼', '✈️', '🐶', '💡', '📦'];
  const DEFAULT_FORM_COLOR = '#2563EB';

  const state = { categories: [], editing: null, deleting: null };
  const $ = (id) => document.getElementById(id);

  const isHex = (c) => /^#[0-9A-Fa-f]{6}$/.test(c || '');
  const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));

  /* ---------- Alert ---------- */
  function showPageAlert(type, message) {
    const box = $('pageAlert');
    box.className = 'alert alert-' + type;
    box.textContent = message;
  }
  function hidePageAlert() {
    $('pageAlert').className = 'alert d-none';
  }
  function showFormAlert(message) {
    const box = $('formAlert');
    box.className = 'alert alert-danger';
    box.textContent = message;
  }
  function hideFormAlert() {
    $('formAlert').className = 'alert d-none';
  }

  function setLoading(button, loading, label) {
    if (loading) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>' + (label || 'Memproses...');
    } else {
      button.disabled = false;
      button.textContent = button.dataset.label || button.textContent;
    }
  }

  /* ---------- Render ---------- */
  function buildItem(cat) {
    const li = document.createElement('li');
    li.className = 'category-item';

    const icon = document.createElement('span');
    icon.className = 'category-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = cat.icon || '🏷️';
    if (isHex(cat.color)) {
      icon.style.backgroundColor = cat.color + '33'; // warna kategori, transparan 20%
      icon.style.borderColor = cat.color;
    }

    const info = document.createElement('div');
    info.className = 'flex-grow-1 min-w-0';
    const name = document.createElement('div');
    name.className = 'fw-semibold category-name';
    name.textContent = cat.name;
    const meta = document.createElement('div');
    meta.className = 'small text-secondary';
    meta.textContent = cat.is_default ? 'Default' : (isHex(cat.color) ? cat.color.toUpperCase() : '');
    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'category-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-outline-primary btn-sm';
    edit.dataset.action = 'edit';
    edit.dataset.id = cat.id;
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', 'Edit kategori ' + cat.name);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-outline-danger btn-sm';
    del.dataset.action = 'delete';
    del.dataset.id = cat.id;
    del.textContent = 'Hapus';
    del.setAttribute('aria-label', 'Hapus kategori ' + cat.name);

    // Kategori default: tombol dinonaktifkan
    if (cat.is_default) {
      edit.disabled = true;
      del.disabled = true;
      edit.title = del.title = 'Kategori default tidak dapat diubah atau dihapus';
    }

    actions.appendChild(edit);
    actions.appendChild(del);
    li.appendChild(icon);
    li.appendChild(info);
    li.appendChild(actions);
    return li;
  }

  function render() {
    const custom = state.categories.filter((c) => !c.is_default);
    const defaults = state.categories.filter((c) => c.is_default);

    const customList = $('customList');
    const defaultList = $('defaultList');
    customList.replaceChildren(...custom.map(buildItem));
    defaultList.replaceChildren(...defaults.map(buildItem));

    $('customCount').textContent = custom.length;
    $('defaultCount').textContent = defaults.length;
    $('customEmpty').classList.toggle('d-none', custom.length > 0);
    $('loading').classList.add('d-none');
    $('content').classList.remove('d-none');
  }

  async function loadCategories() {
    try {
      state.categories = await Api.get('/categories');
      render();
    } catch (err) {
      $('loading').classList.add('d-none');
      showPageAlert('danger', err.message);
    }
  }

  /* ---------- Form tambah / edit ---------- */
  function clearFieldErrors(form) {
    form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
  }

  function setFieldError(form, field, message) {
    const input = form.elements[field];
    if (!input) return false;
    input.classList.add('is-invalid');
    const fb = input.closest('.mb-3, .mb-1')?.querySelector('.invalid-feedback');
    if (fb) fb.textContent = message;
    return true;
  }

  function openForm(category) {
    const form = $('categoryForm');
    state.editing = category || null;
    form.reset();
    form.classList.remove('was-validated');
    clearFieldErrors(form);
    hideFormAlert();

    $('categoryModalTitle').textContent = category ? 'Edit kategori' : 'Tambah kategori';
    form.elements.name.value = category ? category.name : '';
    form.elements.icon.value = category && category.icon ? category.icon : '';
    const color = category && isHex(category.color) ? category.color : DEFAULT_FORM_COLOR;
    form.elements.color.value = color.toLowerCase();
    $('colorHex').textContent = color.toUpperCase();

    modal('categoryModal').show();
    setTimeout(() => form.elements.name.focus(), 250);
  }

  async function submitForm(e) {
    e.preventDefault();
    const form = $('categoryForm');
    hideFormAlert();
    clearFieldErrors(form);

    const name = form.elements.name.value.trim();
    if (!name) {
      setFieldError(form, 'name', 'Nama kategori wajib diisi.');
      form.elements.name.focus();
      return;
    }
    const color = form.elements.color.value;
    if (!isHex(color)) {
      setFieldError(form, 'color', 'Warna harus berformat hex, contoh #2563EB.');
      return;
    }

    const payload = { name: name, icon: form.elements.icon.value.trim(), color: color };
    const button = $('saveBtn');
    const editing = state.editing;
    setLoading(button, true, 'Menyimpan...');
    try {
      if (editing) {
        await Api.put('/categories/' + editing.id, payload);
      } else {
        await Api.post('/categories', payload);
      }
      modal('categoryModal').hide();
      showPageAlert('success', editing ? 'Kategori diperbarui.' : 'Kategori ditambahkan.');
      await loadCategories();
    } catch (err) {
      if (err.status === 409) {
        setFieldError(form, 'name', 'Nama ini sudah dipakai. Gunakan nama lain.');
      } else if (err.status === 400 && err.errors.length) {
        let shown = false;
        err.errors.forEach((er) => { shown = setFieldError(form, er.field, er.message) || shown; });
        if (!shown) showFormAlert(err.message);
      } else {
        showFormAlert(err.message);
      }
    } finally {
      setLoading(button, false);
    }
  }

  /* ---------- Hapus ---------- */
  function openDelete(category) {
    // Validasi sisi client: kategori default tidak boleh dihapus (backend juga menolak dengan 403)
    if (category.is_default) {
      showPageAlert('warning', 'Kategori default tidak dapat dihapus.');
      return;
    }
    state.deleting = category;
    $('deleteName').textContent = category.name;
    modal('deleteModal').show();
  }

  async function confirmDelete() {
    const category = state.deleting;
    if (!category) return;
    const button = $('confirmDeleteBtn');
    setLoading(button, true, 'Menghapus...');
    try {
      await Api.del('/categories/' + category.id);
      modal('deleteModal').hide();
      showPageAlert('success', 'Kategori "' + category.name + '" dihapus.');
      await loadCategories();
    } catch (err) {
      modal('deleteModal').hide();
      showPageAlert('danger', err.message);
    } finally {
      setLoading(button, false);
      state.deleting = null;
    }
  }

  /* ---------- Init ---------- */
  function buildEmojiPicker() {
    const picker = $('emojiPicker');
    EMOJIS.forEach((emoji) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-outline-secondary';
      b.textContent = emoji;
      b.setAttribute('aria-label', 'Pilih emoji ' + emoji);
      b.addEventListener('click', () => {
        $('categoryForm').elements.icon.value = emoji;
        $('categoryForm').elements.icon.classList.remove('is-invalid');
      });
      picker.appendChild(b);
    });
  }

  function onListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const cat = state.categories.find((c) => String(c.id) === btn.dataset.id);
    if (!cat) return;
    hidePageAlert();
    if (btn.dataset.action === 'edit') {
      if (cat.is_default) return;
      openForm(cat);
    } else if (btn.dataset.action === 'delete') {
      openDelete(cat);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!$('categoryForm')) return; // bukan halaman kategori
    buildEmojiPicker();

    $('addBtn').addEventListener('click', () => { hidePageAlert(); openForm(null); });
    $('emptyAddBtn').addEventListener('click', () => { hidePageAlert(); openForm(null); });
    $('customList').addEventListener('click', onListClick);
    $('defaultList').addEventListener('click', onListClick);
    $('categoryForm').addEventListener('submit', submitForm);
    $('confirmDeleteBtn').addEventListener('click', confirmDelete);
    $('categoryForm').addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
    $('catColor').addEventListener('input', (e) => { $('colorHex').textContent = e.target.value.toUpperCase(); });

    // Jika sesi tidak valid, auth.js sudah mengalihkan ke login; jangan panggil API
    if (Api.isLoggedIn()) loadCategories();
  });
})();
