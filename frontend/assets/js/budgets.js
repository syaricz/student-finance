/* ============================================================
   budgets.js - halaman Anggaran
   Tampilan per bulan: total + progress bar, realisasi vs alokasi per kategori,
   form atur/edit (total + alokasi per kategori), hapus.
   Butuh: api.js, auth.js, utils.js (Fmt), Bootstrap bundle (modal).
   Semua teks dari server dirender dengan textContent (anti XSS).
   ============================================================ */
(function () {
  'use strict';

  const MIN_YEAR = 2000;
  const MAX_YEAR = 2100;
  const MONEY_RE = /^\d+(\.\d{1,2})?$/; // sama dengan aturan backend: maksimal 2 desimal

  const STATUS = {
    aman: { label: 'Aman', bar: 'bar-aman', color: '#108981' },
    waspada: { label: 'Waspada', bar: 'bar-waspada', color: '#F59E0B' },
    hampir_habis: { label: 'Hampir habis', bar: 'bar-hampir', color: '#F97316' },
    melebihi: { label: 'Melebihi anggaran', bar: 'bar-over', color: '#EF4444' },
  };

  const $ = (id) => document.getElementById(id);
  const h = Fmt.h;
  const money = (n) => Fmt.rupiah.format(n);
  const pct = (n) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%';
  const cents = (v) => Math.round(Number(v) * 100);
  const isHex = (c) => /^#[0-9A-Fa-f]{6}$/.test(c || '');
  const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
  const monthName = (m, y) => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));

  const state = { month: 0, year: 0, budget: null, categories: null, seq: 0 };

  /* ---------- Alert ---------- */
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

  /* ---------- Bulan ---------- */
  function initPeriod() {
    const now = new Date();
    state.month = now.getMonth() + 1;
    state.year = now.getFullYear();

    // Dukung tautan ?month=&year= (mis. dari halaman lain)
    const q = new URLSearchParams(location.search);
    const m = Number(q.get('month'));
    const y = Number(q.get('year'));
    if (Number.isInteger(m) && m >= 1 && m <= 12 && Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR) {
      state.month = m;
      state.year = y;
    }
  }

  function shiftMonth(delta) {
    let m = state.month + delta;
    let y = state.year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    if (y < MIN_YEAR || y > MAX_YEAR) return;
    state.month = m;
    state.year = y;
    hidePageAlert();
    load();
  }

  function updateMonthNav() {
    $('monthLabel').textContent = monthName(state.month, state.year);
    $('prevMonth').disabled = state.year === MIN_YEAR && state.month === 1;
    $('nextMonth').disabled = state.year === MAX_YEAR && state.month === 12;
    const now = new Date();
    $('thisMonth').classList.toggle('d-none', state.month === now.getMonth() + 1 && state.year === now.getFullYear());
  }

  /* ---------- Render ---------- */
  function statusEl(el, key) {
    el.replaceChildren();
    const st = STATUS[key];
    if (!st) return;
    const dot = h('span', 'dot');
    dot.style.backgroundColor = st.color;
    el.appendChild(dot);
    el.appendChild(document.createTextNode(st.label));
  }

  function setBar(bar, percentage, statusKey) {
    const fill = bar.querySelector('.progress-bar');
    const width = Math.max(0, Math.min(100, percentage || 0));
    fill.style.width = width + '%';
    fill.className = 'progress-bar ' + ((STATUS[statusKey] && STATUS[statusKey].bar) || 'bar-aman');
    bar.setAttribute('aria-valuenow', String(Math.round(width)));
  }

  function buildCategoryRow(c) {
    const li = h('li', 'sf-budget-row');

    const head = h('div', 'sf-budget-head');
    head.appendChild(h('span', 'sf-budget-name', (c.icon ? c.icon + ' ' : '') + c.name));
    const right = h('span', 'sf-budget-pct', pct(c.percentage) + ' ');
    const st = h('span', 'small fw-normal text-secondary');
    statusEl(st, c.status);
    right.appendChild(st);
    head.appendChild(right);
    li.appendChild(head);

    const bar = h('div', 'progress sf-progress-sm');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Penggunaan anggaran ' + c.name);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.appendChild(h('div', 'progress-bar'));
    li.appendChild(bar);
    setBar(bar, c.percentage, c.status);

    const rest = c.remaining < 0 ? 'Lebih ' + money(-c.remaining) : 'Sisa ' + money(c.remaining);
    li.appendChild(h('div', 'sf-budget-meta',
      'Realisasi ' + money(c.used) + ' · Alokasi ' + money(c.allocated) + ' · ' + rest));
    return li;
  }

  function renderBudget(b) {
    $('sumTotal').textContent = money(b.total_amount);
    setBar($('sumBar'), b.percentage, b.status);
    $('sumPercent').textContent = pct(b.percentage);
    statusEl($('sumStatus'), b.status);

    const rest = b.remaining < 0
      ? 'Melebihi anggaran sebesar ' + money(-b.remaining)
      : 'Sisa ' + money(b.remaining);
    $('sumUsed').textContent = 'Terpakai ' + money(b.total_used) + ' · ' + rest;

    const notes = [];
    if (b.unallocated > 0) notes.push(money(b.unallocated) + ' belum dialokasikan ke kategori.');
    if (b.unbudgeted_used > 0) notes.push(money(b.unbudgeted_used) + ' dibelanjakan di kategori yang tidak punya alokasi.');
    $('sumNotes').replaceChildren(...notes.map((t) => h('li', '', t)));
    $('sumNotes').classList.toggle('d-none', notes.length === 0);

    // Urut dari penggunaan tertinggi agar yang perlu perhatian ada di atas
    const cats = b.categories.slice().sort((a, c) => (c.percentage || 0) - (a.percentage || 0));
    $('catList').replaceChildren(...cats.map(buildCategoryRow));
    $('catList').classList.toggle('d-none', cats.length === 0);
    $('catEmpty').classList.toggle('d-none', cats.length > 0);
  }

  function render() {
    updateMonthNav();
    $('loading').classList.add('d-none');
    const has = Boolean(state.budget);
    $('emptyState').classList.toggle('d-none', has);
    $('budgetView').classList.toggle('d-none', !has);
    if (has) renderBudget(state.budget);
    else $('emptyTitle').textContent = 'Anggaran ' + monthName(state.month, state.year) + ' belum diatur';
  }

  async function load() {
    const seq = ++state.seq; // abaikan respons lama bila user berpindah bulan dengan cepat
    updateMonthNav();
    $('loading').classList.remove('d-none');
    $('emptyState').classList.add('d-none');
    $('budgetView').classList.add('d-none');
    try {
      const budget = await Api.get('/budgets?month=' + state.month + '&year=' + state.year);
      if (seq !== state.seq) return;
      state.budget = budget; // null bila belum ada anggaran
      render();
    } catch (err) {
      if (seq !== state.seq) return;
      $('loading').classList.add('d-none');
      showPageAlert('danger', err.message);
    }
  }

  /* ---------- Form ---------- */
  async function ensureCategories() {
    if (state.categories) return state.categories;
    state.categories = await Api.get('/categories');
    return state.categories;
  }

  const allocInput = (categoryId) => $('alloc-' + categoryId);

  function buildAllocRow(c) {
    const row = h('div', 'sf-alloc-row');
    const label = h('label', 'sf-alloc-name', (c.icon ? c.icon + ' ' : '') + c.name);
    label.htmlFor = 'alloc-' + c.id;

    const group = h('div', 'input-group has-validation');
    group.appendChild(h('span', 'input-group-text', 'Rp'));
    const input = h('input', 'form-control');
    input.type = 'number';
    input.id = 'alloc-' + c.id;
    input.min = '0';
    input.step = 'any';
    input.inputMode = 'decimal';
    input.placeholder = '0';
    input.dataset.categoryId = c.id;
    group.appendChild(input);
    group.appendChild(h('div', 'invalid-feedback', 'Isi angka 0 atau lebih.'));

    row.appendChild(label);
    row.appendChild(group);
    return row;
  }

  function allocInputs() {
    return [...$('allocList').querySelectorAll('input[data-category-id]')];
  }

  // Ringkasan langsung: berapa yang sudah dialokasikan vs total
  function updateSummary() {
    const total = $('budTotal').value.trim();
    const sum = allocInputs().reduce((s, i) => s + (Number(i.value) > 0 ? cents(i.value) : 0), 0);
    const line = $('allocLine');
    $('allocError').classList.add('d-none');

    if (total === '' || !(Number(total) > 0)) {
      line.className = 'is-ok';
      line.textContent = 'Dialokasikan ' + money(sum / 100);
      return;
    }
    const left = cents(total) - sum;
    if (left < 0) {
      line.className = 'is-over';
      line.textContent = 'Dialokasikan ' + money(sum / 100) + ' · melebihi total anggaran ' + money(-left / 100);
    } else {
      line.className = 'is-ok';
      line.textContent = 'Dialokasikan ' + money(sum / 100) + ' dari ' + money(Number(total)) + ' · belum dialokasikan ' + money(left / 100);
    }
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    $('allocError').classList.add('d-none');
  }

  function setFieldError(input, message) {
    input.classList.add('is-invalid');
    const fb = input.closest('.input-group').querySelector('.invalid-feedback');
    if (fb && message) fb.textContent = message;
  }

  async function openForm() {
    hidePageAlert();
    let categories;
    try {
      categories = await ensureCategories();
    } catch (err) {
      showPageAlert('danger', 'Gagal memuat kategori: ' + err.message);
      return;
    }

    const form = $('budgetForm');
    form.reset();
    form.classList.remove('was-validated');
    clearFieldErrors(form);
    hideFormAlert();

    const editing = Boolean(state.budget);
    $('budgetModalTitle').textContent = (editing ? 'Edit anggaran ' : 'Atur anggaran ') + monthName(state.month, state.year);
    $('allocList').replaceChildren(...categories.map(buildAllocRow));

    if (editing) {
      $('budTotal').value = state.budget.total_amount;
      state.budget.categories.forEach((c) => {
        const input = allocInput(c.category_id);
        if (input) input.value = c.allocated;
      });
    }
    updateSummary();
    modal('budgetModal').show();
    setTimeout(() => $('budTotal').focus(), 250);
  }

  async function submitForm(e) {
    e.preventDefault();
    const form = $('budgetForm');
    hideFormAlert();
    clearFieldErrors(form);

    // 1. Total anggaran
    const totalStr = $('budTotal').value.trim();
    if (!totalStr || !(Number(totalStr) > 0)) {
      setFieldError($('budTotal'), 'Total anggaran harus lebih dari 0.');
      $('budTotal').focus();
      return;
    }
    if (!MONEY_RE.test(totalStr)) {
      setFieldError($('budTotal'), 'Total anggaran maksimal 2 angka desimal.');
      $('budTotal').focus();
      return;
    }

    // 2. Alokasi: kosong atau 0 = tidak dialokasikan; negatif / format salah = error
    const categories = [];
    let firstBad = null;
    allocInputs().forEach((input) => {
      const v = input.value.trim();
      if (v === '' || Number(v) === 0) return;
      if (!(Number(v) > 0)) { setFieldError(input, 'Alokasi tidak boleh negatif.'); firstBad = firstBad || input; return; }
      if (!MONEY_RE.test(v)) { setFieldError(input, 'Alokasi maksimal 2 angka desimal.'); firstBad = firstBad || input; return; }
      categories.push({ category_id: Number(input.dataset.categoryId), allocated_amount: v });
    });
    if (firstBad) { firstBad.focus(); return; }

    // 3. Total alokasi tidak boleh melebihi total anggaran (aturan bisnis #12)
    const sum = categories.reduce((s, c) => s + cents(c.allocated_amount), 0);
    if (sum > cents(totalStr)) {
      const err = $('allocError');
      err.textContent = 'Total alokasi ' + money(sum / 100) + ' melebihi total anggaran ' + money(Number(totalStr)) + '. Kurangi alokasi atau naikkan total.';
      err.classList.remove('d-none');
      return;
    }

    const editing = state.budget;
    const payload = { total_amount: totalStr, categories: categories };
    if (!editing) { payload.month = state.month; payload.year = state.year; }

    const button = $('saveBtn');
    setLoading(button, true, 'Menyimpan...');
    try {
      state.budget = editing
        ? await Api.put('/budgets/' + editing.id, payload)
        : await Api.post('/budgets', payload);
      modal('budgetModal').hide();
      showPageAlert('success', editing ? 'Anggaran diperbarui.' : 'Anggaran disimpan.');
      render();
    } catch (err) {
      handleSaveError(err, categories);
    } finally {
      setLoading(button, false);
    }
  }

  // Petakan error dari server ke field di form
  function handleSaveError(err, sentCategories) {
    if (err.status === 409) {
      showFormAlert(err.message);
      // Anggaran bulan ini ternyata sudah ada (dibuat dari tab lain): muat ulang agar tampil
      load();
      return;
    }
    if (err.status === 400 && err.errors.length) {
      let shown = false;
      err.errors.forEach((er) => {
        if (er.field === 'total_amount') {
          setFieldError($('budTotal'), er.message);
          shown = true;
          return;
        }
        if (er.field === 'categories') {
          const box = $('allocError');
          box.textContent = er.message;
          box.classList.remove('d-none');
          shown = true;
          return;
        }
        const m = /^categories\[(\d+)\]\./.exec(er.field);
        const sent = m && sentCategories[Number(m[1])];
        const input = sent && allocInput(sent.category_id);
        if (input) {
          setFieldError(input, er.message);
          shown = true;
        }
      });
      if (!shown) showFormAlert(err.message);
      return;
    }
    if (err.status === 404) {
      showFormAlert('Anggaran tidak ditemukan. Mungkin sudah dihapus.');
      load();
      return;
    }
    showFormAlert(err.message);
  }

  /* ---------- Hapus ---------- */
  function openDelete() {
    hidePageAlert();
    $('deleteLabel').textContent = monthName(state.month, state.year);
    modal('deleteModal').show();
  }

  async function confirmDelete() {
    const budget = state.budget;
    if (!budget) return;
    const button = $('confirmDeleteBtn');
    setLoading(button, true, 'Menghapus...');
    try {
      await Api.del('/budgets/' + budget.id);
      modal('deleteModal').hide();
      state.budget = null;
      showPageAlert('success', 'Anggaran ' + monthName(state.month, state.year) + ' dihapus.');
      render();
    } catch (err) {
      modal('deleteModal').hide();
      showPageAlert('danger', err.message);
      load();
    } finally {
      setLoading(button, false);
    }
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (!$('budgetForm')) return;
    initPeriod();

    $('prevMonth').addEventListener('click', () => shiftMonth(-1));
    $('nextMonth').addEventListener('click', () => shiftMonth(1));
    $('thisMonth').addEventListener('click', () => { initPeriodToday(); hidePageAlert(); load(); });
    $('createBtn').addEventListener('click', openForm);
    $('editBtn').addEventListener('click', openForm);
    $('deleteBtn').addEventListener('click', openDelete);
    $('confirmDeleteBtn').addEventListener('click', confirmDelete);
    $('budgetForm').addEventListener('submit', submitForm);
    $('budgetForm').addEventListener('input', (e) => {
      e.target.classList.remove('is-invalid');
      updateSummary();
    });

    if (!Api.isLoggedIn()) return; // auth.js sudah mengalihkan ke login
    load();
  });

  function initPeriodToday() {
    const now = new Date();
    state.month = now.getMonth() + 1;
    state.year = now.getFullYear();
  }
})();
