/* ============================================================
   reports.js - halaman Laporan
   Jenis laporan: Harian, Mingguan, Bulanan, Tahunan, Per Kategori, Rekap Total.
   Data dari: GET /reports/summary, /reports/transactions, dan /reports/category (jenis Per Kategori).
   Pengelompokan harian/mingguan/bulanan/tahunan dihitung dari rincian transaksi pada rentang yang dipilih,
   sehingga totalnya selalu sama dengan ringkasan. Butuh: api.js, auth.js, utils.js (Fmt).
   Semua teks dari server dirender dengan textContent (anti XSS).
   ============================================================ */
(function () {
  'use strict';

  const PAGE_SIZE = 20;
  const MIN_DATE = '2000-01-01';
  const MAX_DATE = '2100-12-31';

  const $ = (id) => document.getElementById(id);
  const h = Fmt.h;
  const money = (n) => Fmt.rupiah.format(n);
  const pct = (n) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%';
  const isHex = (c) => /^#[0-9A-Fa-f]{6}$/.test(c || '');
  const catLabel = (c) => (c.icon ? c.icon + ' ' : '') + c.name;

  /* ---------- Tanggal (teks 'YYYY-MM-DD'; dihitung pukul 12 siang agar aman dari pergeseran zona waktu) ---------- */
  function parse(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
  }
  const validDate = (s) => { const d = parse(s); return Boolean(d) && Fmt.iso(d) === s; };
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return Fmt.iso(d); }
  function mondayOf(s) { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return Fmt.iso(d); } // minggu mulai Senin

  const dayFmt = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const monthFmt = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });

  /* ---------- Jenis laporan & rentang bawaan ---------- */
  function thisMonth() {
    const n = new Date();
    return [Fmt.iso(new Date(n.getFullYear(), n.getMonth(), 1)), Fmt.iso(new Date(n.getFullYear(), n.getMonth() + 1, 0))];
  }
  const TYPES = {
    harian: { label: 'Harian', unit: 'hari', group: true, preset: thisMonth, desc: 'Pengeluaran dirinci per hari.', range: 'bulan ini' },
    mingguan: {
      label: 'Mingguan', unit: 'minggu', group: true,
      preset: () => { const mon = mondayOf(Fmt.iso(new Date())); return [addDays(mon, -21), addDays(mon, 6)]; },
      desc: 'Pengeluaran dirinci per minggu (Senin sampai Minggu).', range: '4 minggu terakhir',
    },
    bulanan: {
      label: 'Bulanan', unit: 'bulan', group: true,
      preset: () => { const y = new Date().getFullYear(); return [y + '-01-01', y + '-12-31']; },
      desc: 'Pengeluaran dirinci per bulan.', range: 'tahun ini',
    },
    tahunan: {
      label: 'Tahunan', unit: 'tahun', group: true,
      preset: () => { const y = new Date().getFullYear(); return [(y - 2) + '-01-01', y + '-12-31']; },
      desc: 'Pengeluaran dirinci per tahun.', range: '3 tahun terakhir',
    },
    kategori: { label: 'Per Kategori', unit: 'kategori', group: false, preset: thisMonth, desc: 'Rekap pengeluaran per kategori.', range: 'bulan ini' },
    total: {
      label: 'Rekap Total', unit: '', group: false, preset: thisMonth,
      desc: 'Ringkasan total tanpa pengelompokan, ditambah detail transaksi.', range: 'bulan ini',
    },
  };

  // Petunjuk di bawah form. `kept` = tanggal yang sudah dipilih user dipertahankan saat jenis berganti.
  const hintFor = (type, kept) => TYPES[type].desc + (kept
    ? ' Tanggal yang Anda pilih dipertahankan.'
    : ' Rentang bawaan: ' + TYPES[type].range + '. Anda tetap bisa mengubah tanggal sesuai kebutuhan.');

  const S = { type: 'bulanan', categories: [], report: null, page: 1, seq: 0 };

  /* ---------- Alert & loading ---------- */
  function showAlert(type, message) {
    const box = $('pageAlert');
    box.className = 'alert alert-' + type;
    box.textContent = message;
  }
  const hideAlert = () => { $('pageAlert').className = 'alert d-none'; };

  function setLoading(on) {
    const btn = $('previewBtn');
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Memuat...';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || 'Preview';
    }
    $('loading').classList.toggle('d-none', !on);
  }

  /* ---------- Form ---------- */
  function applyPreset(type) {
    const [start, end] = TYPES[type].preset();
    $('rStart').value = start;
    $('rEnd').value = end;
    $('typeHint').textContent = hintFor(type, false);
  }

  // Ganti jenis laporan: rentang bawaan baru hanya diterapkan bila tanggal belum diubah user
  // (masih sama dengan rentang bawaan jenis sebelumnya). Tanggal pilihan user dipertahankan.
  function onTypeChange() {
    const next = $('rType').value;
    const [ps, pe] = TYPES[S.type].preset();
    const untouched = $('rStart').value === ps && $('rEnd').value === pe;
    S.type = next;
    if (untouched) applyPreset(next);
    else $('typeHint').textContent = hintFor(next, true);
  }

  function fieldError(input, errorEl, message) {
    input.classList.add('is-invalid');
    errorEl.textContent = message;
  }

  function validateForm() {
    const start = $('rStart').value;
    const end = $('rEnd').value;
    $('rStart').classList.remove('is-invalid');
    $('rEnd').classList.remove('is-invalid');
    let ok = true;

    if (!validDate(start)) { fieldError($('rStart'), $('rStartError'), 'Isi tanggal mulai yang valid.'); ok = false; }
    else if (start < MIN_DATE || start > MAX_DATE) { fieldError($('rStart'), $('rStartError'), 'Tahun harus antara 2000 dan 2100.'); ok = false; }

    if (!validDate(end)) { fieldError($('rEnd'), $('rEndError'), 'Isi tanggal akhir yang valid.'); ok = false; }
    else if (end < MIN_DATE || end > MAX_DATE) { fieldError($('rEnd'), $('rEndError'), 'Tahun harus antara 2000 dan 2100.'); ok = false; }
    else if (ok && end < start) { fieldError($('rEnd'), $('rEndError'), 'Tanggal akhir tidak boleh sebelum tanggal mulai.'); ok = false; }

    return ok;
  }

  function populateCategories() {
    const sel = $('rCategory');
    const mine = S.categories.filter((c) => !c.is_default);
    const defaults = S.categories.filter((c) => c.is_default);
    sel.replaceChildren(new Option('Semua kategori', ''));
    [['Kategori saya', mine], ['Kategori default', defaults]].forEach(([label, items]) => {
      if (!items.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      items.forEach((c) => og.appendChild(new Option(catLabel(c), c.id)));
      sel.appendChild(og);
    });
  }

  /* ---------- Pengelompokan (dari rincian transaksi) ---------- */
  function groupOf(type, date, rangeStart, rangeEnd) {
    if (type === 'harian') return { key: date, label: dayFmt.format(parse(date)) };
    if (type === 'mingguan') {
      const mon = mondayOf(date);
      const sun = addDays(mon, 6);
      const from = mon < rangeStart ? rangeStart : mon; // minggu di tepi rentang dipotong sesuai rentang
      const to = sun > rangeEnd ? rangeEnd : sun;
      return { key: mon, label: Fmt.formatDate(from) + ' – ' + Fmt.formatDate(to) };
    }
    if (type === 'bulanan') return { key: date.slice(0, 7), label: monthFmt.format(parse(date.slice(0, 7) + '-01')) };
    return { key: date.slice(0, 4), label: date.slice(0, 4) };
  }

  function buildGroups(rows, type, start, end) {
    const map = new Map();
    rows.forEach((r) => {
      const g = groupOf(type, r.transaction_date, start, end);
      const e = map.get(g.key) || { key: g.key, label: g.label, count: 0, cents: 0 };
      e.count += 1;
      e.cents += Math.round(r.amount * 100); // dijumlah dalam sen agar tepat
      map.set(g.key, e);
    });
    const list = [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
    const grand = list.reduce((s, e) => s + e.cents, 0);
    return list.map((e) => ({
      label: e.label, count: e.count, total: e.cents / 100,
      pct: grand > 0 ? Math.round((e.cents / grand) * 1000) / 10 : 0,
    }));
  }

  /* ---------- Render ---------- */
  function shareCell(percentage, color) {
    const td = h('td', 'rp-share-col d-none d-sm-table-cell');
    const wrap = h('div', 'rp-share');
    const bar = h('div', 'progress sf-progress-sm rp-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Porsi ' + pct(percentage));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(percentage)));
    const fill = h('div', 'progress-bar');
    fill.style.width = Math.min(100, percentage) + '%';
    fill.style.background = isHex(color) ? color : '#2563EB';
    bar.appendChild(fill);
    wrap.appendChild(bar);
    wrap.appendChild(h('span', 'rp-pct', pct(percentage)));
    td.appendChild(wrap);
    return td;
  }

  function renderBreakdownTable(rows, totals) {
    $('breakdownBody').replaceChildren(...rows.map((r) => {
      const tr = h('tr');
      const name = h('td', 'rp-name');
      const label = h('span', 'rp-label');
      if (r.color) {
        const chip = h('span', 'cat-chip');
        const dot = h('span', 'cat-dot');
        dot.style.backgroundColor = isHex(r.color) ? r.color : '#6B7280';
        chip.appendChild(dot);
        chip.appendChild(h('span', '', r.label));
        label.appendChild(chip);
      } else {
        label.textContent = r.label;
      }
      name.appendChild(label);
      // Layar sempit: jumlah transaksi dan porsi pindah ke bawah nama (kolomnya disembunyikan)
      name.appendChild(h('div', 'small text-secondary d-sm-none', r.count + ' transaksi · ' + pct(r.pct)));
      tr.appendChild(name);
      tr.appendChild(h('td', 'text-end tx-count d-none d-sm-table-cell', String(r.count)));
      tr.appendChild(h('td', 'tx-amount', money(r.total)));
      tr.appendChild(shareCell(r.pct, r.color));
      return tr;
    }));

    const foot = h('tr');
    const fname = h('td', '');
    fname.appendChild(h('span', 'rp-label', 'Total'));
    fname.appendChild(h('div', 'small text-secondary fw-normal d-sm-none', totals.count + ' transaksi'));
    foot.appendChild(fname);
    foot.appendChild(h('td', 'text-end tx-count d-none d-sm-table-cell', String(totals.count)));
    foot.appendChild(h('td', 'tx-amount', money(totals.total)));
    foot.appendChild(h('td', 'rp-share-col d-none d-sm-table-cell', totals.count ? '100%' : ''));
    $('breakdownFoot').replaceChildren(foot);
  }

  function renderSummary(r) {
    const s = r.summary;
    $('sumTotal').textContent = money(s.total_expense);
    $('sumTotalSub').textContent = r.categoryName ? 'Kategori: ' + r.categoryName : 'Semua kategori';

    $('sumAvg').textContent = money(s.average_per_day);
    $('sumAvgSub').textContent = s.days_elapsed === 0
      ? 'Rentang ini belum dimulai'
      : s.days_elapsed < s.days_in_range
        ? 'Dari ' + s.days_elapsed + ' hari berjalan (rentang ' + s.days_in_range + ' hari)'
        : 'Dibagi ' + s.days_in_range + ' hari';

    if (s.top_category) {
      $('sumTop').textContent = catLabel(s.top_category);
      $('sumTopSub').textContent = money(s.top_category.amount) + ' · ' + pct(s.top_category.percentage) + ' dari total';
    } else {
      $('sumTop').textContent = '–';
      $('sumTopSub').textContent = 'Belum ada pengeluaran';
    }

    $('sumCount').textContent = String(s.transaction_count);
    const days = new Set(r.detail.data.map((x) => x.transaction_date)).size;
    $('sumCountSub').textContent = r.detail.truncated
      ? 'Rincian dipotong'
      : s.transaction_count ? 'Pada ' + days + ' hari berbeda' : '';
  }

  function renderBreakdown(r) {
    const t = TYPES[r.type];
    const card = $('breakdownCard');
    const empty = r.summary.transaction_count === 0;

    if (empty || r.type === 'total') { card.classList.add('d-none'); return; }

    if (r.type === 'kategori') {
      $('breakdownTitle').textContent = 'Rincian per kategori';
      $('breakdownCaption').textContent = 'Pengeluaran per kategori';
      $('bdColName').textContent = 'Kategori';
      $('breakdownNote').textContent = 'Diurutkan dari pengeluaran terbesar.';
      renderBreakdownTable(
        r.category.items.map((i) => ({ label: catLabel(i), color: i.color, count: i.transaction_count, total: i.total, pct: i.percentage })),
        { count: r.category.transaction_count, total: r.category.total_expense }
      );
      card.classList.remove('d-none');
      return;
    }

    // Harian / Mingguan / Bulanan / Tahunan: dihitung dari rincian; tidak akurat bila rincian terpotong
    if (r.detail.truncated) { card.classList.add('d-none'); return; }
    const groups = buildGroups(r.detail.data, r.type, r.start, r.end);
    $('breakdownTitle').textContent = 'Rincian per ' + t.unit;
    $('breakdownCaption').textContent = 'Pengeluaran per ' + t.unit;
    $('bdColName').textContent = t.unit.charAt(0).toUpperCase() + t.unit.slice(1);
    $('breakdownNote').textContent = 'Hanya ' + t.unit + ' yang memiliki pengeluaran yang ditampilkan.';
    renderBreakdownTable(groups, {
      count: groups.reduce((s, g) => s + g.count, 0),
      total: Math.round(groups.reduce((s, g) => s + Math.round(g.total * 100), 0)) / 100,
    });
    card.classList.remove('d-none');
  }

  function buildDetailRow(x) {
    const tr = h('tr');
    tr.appendChild(h('td', 'tx-date', Fmt.formatDate(x.transaction_date)));

    const desc = h('td', 'tx-desc');
    desc.appendChild(h('div', 'fw-semibold', x.description));
    if (x.notes) desc.appendChild(h('div', 'small text-secondary rp-notes', x.notes));
    desc.appendChild(h('div', 'small text-secondary d-md-none',
      catLabel(x.category) + (x.payment_method ? ' · ' + x.payment_method.name : '')));
    tr.appendChild(desc);

    const cat = h('td', 'd-none d-md-table-cell');
    const chip = h('span', 'cat-chip');
    const dot = h('span', 'cat-dot');
    dot.style.backgroundColor = isHex(x.category.color) ? x.category.color : '#6B7280';
    chip.appendChild(dot);
    chip.appendChild(h('span', '', catLabel(x.category)));
    cat.appendChild(chip);
    tr.appendChild(cat);

    tr.appendChild(h('td', 'd-none d-lg-table-cell', x.payment_method ? x.payment_method.name : '-'));
    tr.appendChild(h('td', 'tx-amount', money(x.amount)));
    return tr;
  }

  function renderDetail() {
    const r = S.report;
    const rows = r.detail.data;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    S.page = Math.min(Math.max(1, S.page), pages);
    const from = (S.page - 1) * PAGE_SIZE;
    const slice = rows.slice(from, from + PAGE_SIZE);

    $('detailBody').replaceChildren(...slice.map(buildDetailRow));
    $('detailInfo').textContent = rows.length
      ? 'Menampilkan ' + (from + 1) + '–' + (from + slice.length) + ' dari ' + rows.length.toLocaleString('id-ID') +
        ' transaksi' + (r.detail.truncated ? ' (rincian dipotong)' : '')
      : '';
    $('detailPager').classList.toggle('d-none', pages <= 1);
    $('pageInfo').textContent = 'Halaman ' + S.page + ' dari ' + pages;
    $('prevPage').disabled = S.page <= 1;
    $('nextPage').disabled = S.page >= pages;
  }

  function render() {
    const r = S.report;
    const empty = r.summary.transaction_count === 0;
    const t = TYPES[r.type];

    $('resultTitle').textContent = 'Laporan ' + t.label;
    $('resultPeriod').textContent = (r.start === r.end ? Fmt.formatDate(r.start) : Fmt.formatDate(r.start) + ' – ' + Fmt.formatDate(r.end)) +
      (r.categoryName ? ' · ' + r.categoryName : '');

    const trunc = $('truncAlert');
    if (r.detail.truncated) {
      trunc.textContent = 'Rentang ini memuat ' + r.detail.transaction_count.toLocaleString('id-ID') +
        ' transaksi, melebihi batas rincian ' + r.detail.max_rows.toLocaleString('id-ID') + ' baris. Ringkasan dan total tetap lengkap, ' +
        'tetapi tabel detail hanya memuat ' + r.detail.max_rows.toLocaleString('id-ID') + ' transaksi paling awal' +
        (t.group ? ' dan pengelompokan per ' + t.unit + ' tidak ditampilkan' : '') +
        '. Persempit rentang tanggal untuk rincian yang utuh.';
      trunc.classList.remove('d-none');
    } else {
      trunc.classList.add('d-none');
    }

    renderSummary(r);
    $('emptyState').classList.toggle('d-none', !empty);
    renderBreakdown(r);
    $('detailCard').classList.toggle('d-none', empty);
    S.page = 1;
    if (!empty) renderDetail();
    $('result').classList.remove('d-none');
  }

  /* ---------- Preview ---------- */
  function syncUrl(r) {
    const p = new URLSearchParams({ type: r.type, start: r.start, end: r.end });
    if (r.categoryId) p.set('category', r.categoryId);
    try { history.replaceState(null, '', location.pathname + '?' + p.toString()); } catch (e) { /* abaikan */ }
  }

  async function preview() {
    hideAlert();
    if (!validateForm()) return;

    const type = $('rType').value;
    const start = $('rStart').value;
    const end = $('rEnd').value;
    const categoryId = $('rCategory').value;
    const seq = ++S.seq;

    const q = new URLSearchParams({ start_date: start, end_date: end });
    if (categoryId) q.set('category_id', categoryId);
    const sq = new URLSearchParams(q);
    sq.set('date', Fmt.iso(new Date())); // "hari ini" menurut browser: rata-rata per hari hanya sampai hari ini

    $('result').classList.add('d-none');
    $('placeholder').classList.add('d-none');
    setLoading(true);
    try {
      const jobs = [Api.get('/reports/summary?' + sq), Api.get('/reports/transactions?' + q)];
      if (type === 'kategori') jobs.push(Api.get('/reports/category?' + q));
      const [summary, detail, category] = await Promise.all(jobs);
      if (seq !== S.seq) return;

      const cat = categoryId ? S.categories.find((c) => String(c.id) === categoryId) : null;
      S.report = {
        type, start, end, categoryId,
        categoryName: cat ? catLabel(cat) : '',
        summary, detail, category: category || null,
      };
      render();
      syncUrl(S.report);
    } catch (err) {
      if (seq !== S.seq) return;
      showAlert('danger', err.message);
    } finally {
      if (seq === S.seq) setLoading(false);
    }
  }

  /* ---------- Init ---------- */
  function readUrl() {
    const q = new URLSearchParams(location.search);
    const type = q.get('type');
    const start = q.get('start');
    const end = q.get('end');
    if (!TYPES[type] || !validDate(start) || !validDate(end) || end < start) return null;
    const cat = q.get('category');
    return { type, start, end, category: /^\d+$/.test(cat || '') ? cat : '' };
  }

  document.addEventListener('DOMContentLoaded', async function () {
    if (!$('reportForm')) return;

    $('rType').addEventListener('change', onTypeChange);
    $('reportForm').addEventListener('submit', (e) => { e.preventDefault(); preview(); });
    ['rStart', 'rEnd'].forEach((id) => $(id).addEventListener('input', () => $(id).classList.remove('is-invalid')));
    $('prevPage').addEventListener('click', () => { S.page -= 1; renderDetail(); });
    $('nextPage').addEventListener('click', () => { S.page += 1; renderDetail(); });

    if (!Api.isLoggedIn()) return; // auth.js sudah mengalihkan ke login

    const fromUrl = readUrl();
    if (fromUrl) {
      $('rType').value = fromUrl.type;
      $('rStart').value = fromUrl.start;
      $('rEnd').value = fromUrl.end;
      $('typeHint').textContent = hintFor(fromUrl.type, true);
    } else {
      applyPreset($('rType').value);
    }
    S.type = $('rType').value;

    try {
      S.categories = await Api.get('/categories');
      populateCategories();
      if (fromUrl && fromUrl.category && S.categories.some((c) => String(c.id) === fromUrl.category)) $('rCategory').value = fromUrl.category;
    } catch (err) {
      showAlert('warning', 'Daftar kategori gagal dimuat, filter kategori belum tersedia: ' + err.message);
    }

    preview(); // tampilkan laporan bawaan langsung, tanpa menunggu klik
  });
})();
