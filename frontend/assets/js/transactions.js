/* ============================================================
   transactions.js - halaman Transaksi
   Tabel + search + filter + sort + pagination, form tambah/edit
   (dengan upload bukti), hapus (soft delete).
   Butuh: api.js, auth.js, Bootstrap bundle (modal).
   Semua teks dari server dirender dengan textContent (anti XSS).
   ============================================================ */
(function () {
  'use strict';

  const LIMIT = 10;
  const MAX_FILE = 2 * 1024 * 1024; // 2MB
  const FILE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
  const COLSPAN = 6;

  const DEFAULT_FILTERS = {
    search: '', category_id: '', payment_method_id: '',
    period: 'all', start_date: '', end_date: '', sort: 'date_desc',
  };

  const state = {
    page: 1,
    filters: Object.assign({}, DEFAULT_FILTERS),
    categories: [],
    payments: [],
    rows: [],
    pagination: null,
    summary: null,
    editing: null,
    deleting: null,
    seq: 0,
  };

  const $ = (id) => document.getElementById(id);
  const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
  const isHex = (c) => /^#[0-9A-Fa-f]{6}$/.test(c || '');

  /* ---------- Format ---------- */
  const rupiah = new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  const dateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

  function iso(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  // 'YYYY-MM-DD' -> teks tanggal tanpa bergeser karena timezone
  function formatDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? dateFmt.format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : s || '';
  }

  function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  /* ---------- Alert & loading ---------- */
  function showPageAlert(type, message) {
    const box = $('pageAlert');
    box.className = 'alert alert-' + type;
    box.textContent = message;
  }
  const hidePageAlert = () => { $('pageAlert').className = 'alert d-none'; };
  function showFormAlert(message) {
    const box = $('formAlert');
    box.className = 'alert alert-danger';
    box.textContent = message;
  }
  const hideFormAlert = () => { $('formAlert').className = 'alert d-none'; };

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

  /* ---------- Periode ---------- */
  function periodRange(period) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (period) {
      case 'today': return [iso(now), iso(now)];
      case '7d': {
        const s = new Date(now);
        s.setDate(s.getDate() - 6);
        return [iso(s), iso(now)];
      }
      case 'month': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
      case 'last_month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
      case 'custom': return [state.filters.start_date, state.filters.end_date];
      default: return ['', ''];
    }
  }

  function buildQuery() {
    const f = state.filters;
    const [start, end] = periodRange(f.period);
    const p = new URLSearchParams();
    p.set('page', state.page);
    p.set('limit', LIMIT);
    p.set('sort', f.sort);
    if (f.search.trim()) p.set('search', f.search.trim());
    if (f.category_id) p.set('category_id', f.category_id);
    if (f.payment_method_id) p.set('payment_method_id', f.payment_method_id);
    if (start) p.set('start_date', start);
    if (end) p.set('end_date', end);
    return p.toString();
  }

  const hasActiveFilters = () => {
    const f = state.filters;
    return Boolean(f.search.trim() || f.category_id || f.payment_method_id || f.period !== 'all');
  };

  /* ---------- Render tabel ---------- */
  function categoryLabel(tx) {
    return (tx.category.icon ? tx.category.icon + ' ' : '') + tx.category.name;
  }

  function buildRow(tx) {
    const tr = h('tr');

    tr.appendChild(h('td', 'tx-date', formatDate(tx.transaction_date)));

    const desc = h('td', 'tx-desc');
    const line = h('div', 'fw-semibold', tx.description);
    if (tx.attachment_count > 0) {
      const att = h('button', 'btn-link-inline', '📎');
      att.type = 'button';
      att.dataset.action = 'attachment';
      att.dataset.id = tx.id;
      att.setAttribute('aria-label', 'Lihat bukti transaksi ' + tx.description);
      att.title = 'Lihat bukti';
      line.appendChild(document.createTextNode(' '));
      line.appendChild(att);
    }
    desc.appendChild(line);
    // Layar kecil: kategori & metode dipindah ke bawah deskripsi
    const sub = h('div', 'small text-secondary d-md-none',
      categoryLabel(tx) + (tx.payment_method ? ' · ' + tx.payment_method.name : ''));
    desc.appendChild(sub);
    tr.appendChild(desc);

    const cat = h('td', 'd-none d-md-table-cell');
    const chip = h('span', 'cat-chip');
    const dot = h('span', 'cat-dot');
    if (isHex(tx.category.color)) dot.style.backgroundColor = tx.category.color;
    chip.appendChild(dot);
    chip.appendChild(h('span', '', categoryLabel(tx)));
    cat.appendChild(chip);
    tr.appendChild(cat);

    tr.appendChild(h('td', 'd-none d-lg-table-cell', tx.payment_method ? tx.payment_method.name : '-'));
    tr.appendChild(h('td', 'tx-amount', rupiah.format(tx.amount)));

    const act = h('td', 'tx-actions');
    const edit = h('button', 'btn btn-outline-primary btn-sm', 'Edit');
    edit.type = 'button';
    edit.dataset.action = 'edit';
    edit.dataset.id = tx.id;
    edit.setAttribute('aria-label', 'Edit transaksi ' + tx.description);
    const del = h('button', 'btn btn-outline-danger btn-sm', 'Hapus');
    del.type = 'button';
    del.dataset.action = 'delete';
    del.dataset.id = tx.id;
    del.setAttribute('aria-label', 'Hapus transaksi ' + tx.description);
    act.appendChild(edit);
    act.appendChild(del);
    tr.appendChild(act);
    return tr;
  }

  function renderPagination() {
    const ul = $('pagination');
    ul.replaceChildren();
    const p = state.pagination;
    if (!p || p.total_pages <= 1) return;

    const item = (label, page, opts) => {
      const o = opts || {};
      const li = h('li', 'page-item' + (o.active ? ' active' : '') + (o.disabled ? ' disabled' : ''));
      const b = h('button', 'page-link', label);
      b.type = 'button';
      if (page) b.dataset.page = page;
      if (o.disabled) b.disabled = true;
      if (o.active) b.setAttribute('aria-current', 'page');
      if (o.aria) b.setAttribute('aria-label', o.aria);
      li.appendChild(b);
      return li;
    };

    ul.appendChild(item('‹', p.page - 1, { disabled: p.page <= 1, aria: 'Halaman sebelumnya' }));

    // Halaman pertama, sekitar halaman aktif, dan terakhir; sisanya "…"
    const pages = new Set([1, p.total_pages, p.page - 1, p.page, p.page + 1]);
    const list = [...pages].filter((n) => n >= 1 && n <= p.total_pages).sort((a, b) => a - b);
    let prev = 0;
    list.forEach((n) => {
      if (n - prev > 1) ul.appendChild(item('…', null, { disabled: true }));
      ul.appendChild(item(String(n), n, { active: n === p.page, aria: 'Halaman ' + n }));
      prev = n;
    });

    ul.appendChild(item('›', p.page + 1, { disabled: p.page >= p.total_pages, aria: 'Halaman berikutnya' }));
  }

  function render() {
    const p = state.pagination;
    const empty = state.rows.length === 0;

    $('tableCard').classList.toggle('d-none', empty);
    $('emptyState').classList.toggle('d-none', !empty);

    if (empty) {
      if (hasActiveFilters()) {
        $('emptyText').textContent = 'Tidak ada transaksi yang cocok dengan pencarian atau filter Anda.';
        $('emptyAction').textContent = 'Reset filter';
        $('emptyAction').dataset.action = 'reset';
      } else {
        $('emptyText').textContent = 'Belum ada transaksi. Catat pengeluaran pertama Anda.';
        $('emptyAction').textContent = 'Tambah transaksi pertama';
        $('emptyAction').dataset.action = 'add';
      }
      $('resultInfo').textContent = 'Tidak ada transaksi';
      $('resultTotal').textContent = '';
    } else {
      const from = (p.page - 1) * p.limit + 1;
      const to = from + state.rows.length - 1;
      $('resultInfo').textContent = 'Menampilkan ' + from + '–' + to + ' dari ' + p.total + ' transaksi';
      $('resultTotal').textContent = (hasActiveFilters() ? 'Total sesuai filter: ' : 'Total: ') +
        rupiah.format(state.summary.total_amount);
      $('txBody').replaceChildren(...state.rows.map(buildRow));
    }
    renderPagination();
  }

  function renderLoading() {
    const tr = h('tr');
    const td = h('td', 'text-center text-secondary py-4', 'Memuat transaksi...');
    td.colSpan = COLSPAN;
    tr.appendChild(td);
    $('txBody').replaceChildren(tr);
    $('tableCard').classList.remove('d-none');
    $('emptyState').classList.add('d-none');
  }

  async function load() {
    const seq = ++state.seq; // abaikan respons lama jika ada request yang lebih baru
    renderLoading();
    $('resultInfo').textContent = 'Memuat transaksi...';
    $('resultTotal').textContent = '';
    try {
      const res = await Api.get('/transactions?' + buildQuery());
      if (seq !== state.seq) return;

      // Halaman sekarang kosong padahal masih ada data (mis. setelah hapus item terakhir)
      if (res.data.length === 0 && res.pagination.total > 0 && state.page > 1) {
        state.page = res.pagination.total_pages;
        return load();
      }
      state.rows = res.data;
      state.pagination = res.pagination;
      state.summary = res.summary;
      render();
    } catch (err) {
      if (seq !== state.seq) return;
      state.rows = [];
      $('txBody').replaceChildren();
      $('tableCard').classList.add('d-none');
      $('resultInfo').textContent = '';
      renderPagination();
      showPageAlert('danger', err.message);
    }
  }

  /* ---------- Dropdown ---------- */
  function fillOptions(select, items, placeholder, keepPlaceholder) {
    const first = select.options[0];
    select.replaceChildren();
    if (keepPlaceholder) select.appendChild(first);
    else select.appendChild(new Option(placeholder, ''));
    items.forEach((it) => select.appendChild(it));
  }

  function categoryOptions(groups) {
    const nodes = [];
    groups.forEach(function (g) {
      if (!g.items.length) return;
      const og = document.createElement('optgroup');
      og.label = g.label;
      g.items.forEach((c) => og.appendChild(new Option((c.icon ? c.icon + ' ' : '') + c.name, c.id)));
      nodes.push(og);
    });
    return nodes;
  }

  function populateSelects() {
    const mine = state.categories.filter((c) => !c.is_default);
    const defaults = state.categories.filter((c) => c.is_default);
    const groups = [{ label: 'Kategori saya', items: mine }, { label: 'Kategori default', items: defaults }];

    fillOptions($('fCategory'), categoryOptions(groups), 'Semua kategori', false);
    fillOptions($('txCategory'), categoryOptions(groups), '', true);

    const pay = () => state.payments.map((m) => new Option(m.name, m.id));
    fillOptions($('fPayment'), pay(), 'Semua metode', false);
    fillOptions($('txPayment'), pay(), '', true);
  }

  async function loadLookups() {
    try {
      const [cats, pays] = await Promise.all([Api.get('/categories'), Api.get('/payment-methods')]);
      state.categories = cats;
      state.payments = pays;
      populateSelects();
    } catch (err) {
      showPageAlert('danger', 'Gagal memuat daftar kategori/metode: ' + err.message);
    }
  }

  /* ---------- Filter ---------- */
  function applyFilters() {
    state.page = 1;
    const f = state.filters;
    $('customDates').classList.toggle('d-none', f.period !== 'custom');

    // Validasi rentang tanggal sisi client
    const bad = f.period === 'custom' && f.start_date && f.end_date && f.end_date < f.start_date;
    $('fEnd').classList.toggle('is-invalid', Boolean(bad));
    if (bad) return;
    load();
  }

  function resetFilters() {
    state.filters = Object.assign({}, DEFAULT_FILTERS);
    $('fSearch').value = '';
    $('fCategory').value = '';
    $('fPayment').value = '';
    $('fPeriod').value = 'all';
    $('fSort').value = 'date_desc';
    $('fStart').value = '';
    $('fEnd').value = '';
    applyFilters();
  }

  function bindFilters() {
    let timer;
    $('fSearch').addEventListener('input', (e) => {
      state.filters.search = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(applyFilters, 350); // tunggu user selesai mengetik
    });
    const bindSelect = (id, key) => $(id).addEventListener('change', (e) => {
      state.filters[key] = e.target.value;
      applyFilters();
    });
    bindSelect('fCategory', 'category_id');
    bindSelect('fPayment', 'payment_method_id');
    bindSelect('fPeriod', 'period');
    bindSelect('fSort', 'sort');
    bindSelect('fStart', 'start_date');
    bindSelect('fEnd', 'end_date');
    $('resetBtn').addEventListener('click', resetFilters);
  }

  /* ---------- Form tambah / edit ---------- */
  function clearFieldErrors(form) {
    form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
  }

  function setFieldError(form, field, message) {
    const input = form.elements[field];
    if (!input) return false;
    input.classList.add('is-invalid');
    const box = input.closest('.mb-0');
    const fb = box && box.querySelector('.invalid-feedback');
    if (fb) fb.textContent = message;
    return true;
  }

  // Validasi file di client (server tetap memvalidasi ulang, termasuk isi file)
  function validateFile() {
    const input = $('txFile');
    const file = input.files[0];
    let msg = '';
    if (file) {
      if (!FILE_TYPES.includes(file.type)) msg = 'Format file harus JPG, PNG, atau PDF.';
      else if (file.size > MAX_FILE) msg = 'Ukuran file maksimal 2MB.';
    }
    input.setCustomValidity(msg);
    if (msg) $('txFileError').textContent = msg;
    return !msg;
  }

  async function openForm(id) {
    const form = $('txForm');
    let tx = null;
    hidePageAlert();

    if (id) {
      try {
        tx = await Api.get('/transactions/' + id);
      } catch (err) {
        showPageAlert('danger', err.message);
        load();
        return;
      }
    }

    state.editing = tx;
    form.reset();
    form.classList.remove('was-validated');
    clearFieldErrors(form);
    hideFormAlert();
    $('txFile').setCustomValidity('');

    $('txModalTitle').textContent = tx ? 'Edit transaksi' : 'Tambah transaksi';
    form.elements.transaction_date.value = tx ? tx.transaction_date : iso(new Date()); // default hari ini
    form.elements.amount.value = tx ? tx.amount : '';
    form.elements.category_id.value = tx ? String(tx.category.id) : '';
    form.elements.description.value = tx ? tx.description : '';
    form.elements.payment_method_id.value = tx && tx.payment_method ? String(tx.payment_method.id) : '';
    form.elements.notes.value = tx && tx.notes ? tx.notes : '';

    const hasAtt = Boolean(tx && tx.attachments && tx.attachments.length);
    $('currentAttachment').classList.toggle('d-none', !hasAtt);
    $('removeAttachment').checked = false;

    modal('txModal').show();
  }

  async function submitForm(e) {
    e.preventDefault();
    const form = $('txForm');
    hideFormAlert();
    clearFieldErrors(form);

    form.elements.description.value = form.elements.description.value.trim();
    validateFile();
    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      const first = form.querySelector(':invalid');
      if (first) first.focus();
      return;
    }
    form.classList.remove('was-validated');

    const file = form.elements.attachment.files[0];
    const fd = new FormData();
    fd.append('transaction_date', form.elements.transaction_date.value);
    fd.append('amount', form.elements.amount.value);
    fd.append('category_id', form.elements.category_id.value);
    fd.append('payment_method_id', form.elements.payment_method_id.value);
    fd.append('description', form.elements.description.value);
    fd.append('notes', form.elements.notes.value.trim());
    if (file) fd.append('attachment', file);
    const editing = state.editing;
    if (editing && !file && $('removeAttachment').checked) fd.append('remove_attachment', '1');

    const button = $('saveBtn');
    setLoading(button, true, 'Menyimpan...');
    try {
      if (editing) await Api.put('/transactions/' + editing.id, fd);
      else await Api.post('/transactions', fd);

      modal('txModal').hide();
      showPageAlert('success', editing ? 'Transaksi diperbarui.' : 'Transaksi ditambahkan.');
      if (!editing) state.page = 1; // transaksi baru muncul di halaman pertama
      await load();
    } catch (err) {
      if (err.status === 400 && err.errors.length) {
        let shown = false;
        err.errors.forEach((er) => { shown = setFieldError(form, er.field, er.message) || shown; });
        if (!shown) showFormAlert(err.message);
      } else if (err.status === 404) {
        showFormAlert('Transaksi tidak ditemukan. Mungkin sudah dihapus.');
        load();
      } else {
        showFormAlert(err.message);
      }
    } finally {
      setLoading(button, false);
    }
  }

  /* ---------- Bukti transaksi ---------- */
  // Bukti hanya bisa diambil dengan token, jadi diunduh lewat fetch lalu dibuka sebagai blob
  async function viewAttachment(txId, attachmentId) {
    // Tab dibuka sekarang (di dalam event klik) agar tidak diblokir pop-up blocker
    const win = window.open('about:blank', '_blank');
    if (!win) {
      showPageAlert('warning', 'Pop-up diblokir browser. Izinkan pop-up untuk membuka bukti.');
      return;
    }
    try {
      let attId = attachmentId;
      if (!attId) {
        const tx = await Api.get('/transactions/' + txId);
        attId = tx.attachments[0] && tx.attachments[0].id;
        if (!attId) throw new Error('Bukti tidak ditemukan');
      }
      const blob = await Api.blob('/transactions/' + txId + '/attachments/' + attId);
      const url = URL.createObjectURL(blob);
      win.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (err) {
      win.close();
      showPageAlert('danger', err.message);
    }
  }

  /* ---------- Hapus ---------- */
  function openDelete(tx) {
    state.deleting = tx;
    $('deleteDesc').textContent = tx.description;
    $('deleteAmount').textContent = rupiah.format(tx.amount);
    modal('deleteModal').show();
  }

  async function confirmDelete() {
    const tx = state.deleting;
    if (!tx) return;
    const button = $('confirmDeleteBtn');
    setLoading(button, true, 'Menghapus...');
    try {
      await Api.del('/transactions/' + tx.id);
      modal('deleteModal').hide();
      showPageAlert('success', 'Transaksi "' + tx.description + '" dihapus.');
      await load();
    } catch (err) {
      modal('deleteModal').hide();
      showPageAlert('danger', err.message);
      load();
    } finally {
      setLoading(button, false);
      state.deleting = null;
    }
  }

  /* ---------- Event ---------- */
  function onTableClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const id = Number(btn.dataset.id);
    const tx = state.rows.find((r) => r.id === id);
    if (btn.dataset.action === 'edit') openForm(id);
    else if (btn.dataset.action === 'delete' && tx) { hidePageAlert(); openDelete(tx); }
    else if (btn.dataset.action === 'attachment') viewAttachment(id);
  }

  function onPageClick(e) {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    hidePageAlert();
    load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!$('txForm')) return; // bukan halaman transaksi

    bindFilters();
    $('addBtn').addEventListener('click', () => openForm(null));
    $('emptyAction').addEventListener('click', (e) => {
      if (e.currentTarget.dataset.action === 'reset') resetFilters();
      else openForm(null);
    });
    $('txBody').addEventListener('click', onTableClick);
    $('pagination').addEventListener('click', onPageClick);
    $('txForm').addEventListener('submit', submitForm);
    $('txForm').addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
    $('txFile').addEventListener('change', (e) => {
      e.target.classList.toggle('is-invalid', !validateFile());
    });
    $('viewCurrentBtn').addEventListener('click', () => {
      if (state.editing) viewAttachment(state.editing.id, state.editing.attachments[0].id);
    });
    $('confirmDeleteBtn').addEventListener('click', confirmDelete);

    // Jika sesi tidak valid, auth.js sudah mengalihkan ke login; jangan panggil API
    if (!Api.isLoggedIn()) return;
    loadLookups().then(load);
  });
})();
