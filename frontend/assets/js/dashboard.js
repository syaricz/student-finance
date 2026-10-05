/* ============================================================
   dashboard.js - halaman Dashboard
   Kartu statistik, peringatan anggaran, dan transaksi terbaru.
   Butuh: api.js, auth.js, utils.js (Fmt).
   Semua teks dari server dirender dengan textContent (anti XSS).
   ============================================================ */
(function () {
  'use strict';

  const RECENT_LIMIT = 5;
  const MAX_ALERTS = 4;

  // Warna & label mengikuti Blueprint 4.E (Threshold)
  const STATUS = {
    aman: { label: 'Aman', color: '#108981' },
    waspada: { label: 'Waspada', color: '#F59E0B' },
    hampir_habis: { label: 'Hampir habis', color: '#F97316' },
    melebihi: { label: 'Melebihi anggaran', color: '#EF4444' },
  };

  const $ = (id) => document.getElementById(id);
  const h = Fmt.h;
  const isHex = (c) => /^#[0-9A-Fa-f]{6}$/.test(c || '');
  const percentFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
  const longDate = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });

  let loading = false;

  /* ---------- Kartu statistik ---------- */
  function setStatus(el, statusKey) {
    // Titik berwarna + teks status (warna saja tidak cukup untuk aksesibilitas)
    el.replaceChildren();
    const st = STATUS[statusKey];
    if (!st) return;
    const dot = h('span', 'dot');
    dot.style.backgroundColor = st.color;
    el.appendChild(dot);
    el.appendChild(document.createTextNode(st.label));
  }

  function renderCards(sum) {
    const now = new Date(sum.year, sum.month - 1, 1);

    $('statMonth').textContent = Fmt.rupiah.format(sum.total_expense_this_month);
    $('statMonthSub').textContent =
      sum.transaction_count_this_month > 0
        ? sum.transaction_count_this_month + ' transaksi · ' + monthName.format(now)
        : 'Belum ada transaksi · ' + monthName.format(now);

    $('statToday').textContent = Fmt.rupiah.format(sum.expense_today);
    const [y, m, d] = sum.date.split('-').map(Number);
    $('statTodaySub').textContent = longDate.format(new Date(y, m - 1, d));

    const remaining = $('statRemaining');
    const percent = $('statPercent');
    const bar = $('statPercentBar');
    remaining.classList.remove('text-danger');
    percent.classList.remove('text-danger');

    if (sum.budget_total === null) {
      // Anggaran bulan ini belum diatur
      remaining.textContent = '–';
      $('statRemainingSub').textContent = 'Anggaran bulan ini belum diatur';
      percent.textContent = '–';
      $('statPercentSub').textContent = 'Belum ada anggaran';
      bar.classList.add('d-none');
      return;
    }

    if (sum.budget_remaining < 0) {
      remaining.textContent = '−' + Fmt.rupiah.format(Math.abs(sum.budget_remaining));
      remaining.classList.add('text-danger');
      $('statRemainingSub').textContent = 'Melebihi anggaran ' + Fmt.rupiah.format(sum.budget_total);
    } else {
      remaining.textContent = Fmt.rupiah.format(sum.budget_remaining);
      $('statRemainingSub').textContent = 'dari anggaran ' + Fmt.rupiah.format(sum.budget_total);
    }

    percent.textContent = percentFmt.format(sum.budget_percentage) + '%';
    if (sum.budget_status === 'melebihi') percent.classList.add('text-danger');
    setStatus($('statPercentSub'), sum.budget_status);

    const width = Math.min(Math.max(sum.budget_percentage, 0), 100);
    bar.classList.remove('d-none');
    bar.setAttribute('aria-valuenow', String(Math.round(width)));
    const fill = bar.querySelector('.progress-bar');
    fill.style.width = width + '%';
    fill.style.backgroundColor = (STATUS[sum.budget_status] || STATUS.aman).color;
  }

  /* ---------- Kartu peringatan anggaran ---------- */
  function alertDetail(a) {
    const pct = percentFmt.format(a.percentage) + '%';
    if (a.status === 'melebihi') {
      return pct + ' terpakai · lebih ' + Fmt.rupiah.format(a.used - a.allocated) +
        ' dari anggaran ' + Fmt.rupiah.format(a.allocated);
    }
    return pct + ' terpakai · ' + Fmt.rupiah.format(a.used) + ' dari ' + Fmt.rupiah.format(a.allocated);
  }

  function renderAlerts(alerts) {
    const box = $('budgetAlerts');
    box.replaceChildren();
    if (!alerts || !alerts.length) {
      box.classList.add('d-none');
      return;
    }

    alerts.slice(0, MAX_ALERTS).forEach((a) => {
      const st = STATUS[a.status] || STATUS.waspada;
      const card = h('div', 'sf-alert-card');
      card.setAttribute('role', 'status');
      card.style.borderLeftColor = st.color;

      const body = h('div', 'flex-grow-1 min-w-0');
      const title = h('div', 'fw-semibold sf-alert-title',
        (a.icon ? a.icon + ' ' : '') + (a.scope === 'total' ? a.name : 'Anggaran ' + a.name));
      body.appendChild(title);
      body.appendChild(h('div', 'small text-secondary', alertDetail(a)));
      card.appendChild(body);

      const badge = h('span', 'sf-alert-badge');
      const dot = h('span', 'dot');
      dot.style.backgroundColor = st.color;
      badge.appendChild(dot);
      badge.appendChild(document.createTextNode(st.label));
      card.appendChild(badge);

      box.appendChild(card);
    });

    if (alerts.length > MAX_ALERTS) {
      box.appendChild(h('div', 'small text-secondary px-1',
        'dan ' + (alerts.length - MAX_ALERTS) + ' peringatan lainnya'));
    }
    box.classList.remove('d-none');
  }

  /* ---------- Transaksi terbaru ---------- */
  function renderRecent(rows) {
    const body = $('recentBody');
    const empty = !rows.length;
    $('recentWrap').classList.toggle('d-none', empty);
    $('recentEmpty').classList.toggle('d-none', !empty);
    if (empty) return;

    body.replaceChildren(...rows.map((tx) => {
      const tr = h('tr');
      // Kolom tanggal disembunyikan di layar sempit (tanggalnya pindah ke bawah deskripsi)
      tr.appendChild(h('td', 'tx-date d-none d-sm-table-cell', Fmt.formatDate(tx.transaction_date)));

      const catLabel = (tx.category.icon ? tx.category.icon + ' ' : '') + tx.category.name;
      const desc = h('td', 'tx-desc');
      desc.appendChild(h('div', 'fw-semibold', tx.description));
      // < 576px: tanggal + kategori | 576-767px: kategori saja | >= 768px: kategori punya kolom sendiri
      desc.appendChild(h('div', 'small text-secondary d-sm-none', Fmt.formatDate(tx.transaction_date) + ' · ' + catLabel));
      desc.appendChild(h('div', 'small text-secondary d-none d-sm-block d-md-none', catLabel));
      tr.appendChild(desc);

      const cat = h('td', 'd-none d-md-table-cell');
      const chip = h('span', 'cat-chip');
      const dot = h('span', 'cat-dot');
      if (isHex(tx.category.color)) dot.style.backgroundColor = tx.category.color;
      chip.appendChild(dot);
      chip.appendChild(h('span', '', (tx.category.icon ? tx.category.icon + ' ' : '') + tx.category.name));
      cat.appendChild(chip);
      tr.appendChild(cat);

      tr.appendChild(h('td', 'tx-amount', Fmt.rupiah.format(tx.amount)));
      return tr;
    }));
  }

  /* ---------- Muat data ---------- */
  function showError(message) {
    const box = $('dashAlert');
    box.replaceChildren(document.createTextNode(message + ' '));
    const retry = h('button', 'btn btn-link p-0 align-baseline', 'Coba lagi');
    retry.type = 'button';
    retry.addEventListener('click', load);
    box.appendChild(retry);
    box.classList.remove('d-none');
  }

  async function load() {
    if (loading) return;
    loading = true;
    $('dashAlert').classList.add('d-none');

    // Tanggal "hari ini" dikirim dari browser agar tidak terpengaruh timezone server
    const today = Fmt.iso(new Date());
    const [summary, recent] = await Promise.allSettled([
      Api.get('/dashboard/summary?date=' + today),
      Api.get('/transactions?limit=' + RECENT_LIMIT + '&sort=date_desc'),
    ]);

    const errors = [];
    try {
      if (summary.status === 'fulfilled') {
        renderCards(summary.value);
        renderAlerts(summary.value.alerts);
      } else {
        errors.push(summary.reason.message);
      }
      if (recent.status === 'fulfilled') {
        renderRecent(recent.value.data);
      } else {
        $('recentBody').replaceChildren();
        errors.push(recent.reason.message);
      }
    } catch (err) {
      // Respons server tidak sesuai bentuk yang diharapkan: tampilkan pesan, jangan biarkan halaman macet
      console.error(err);
      errors.push('Data dashboard tidak dapat ditampilkan. Coba muat ulang halaman.');
    } finally {
      loading = false;
    }

    if (errors.length) showError(errors[0]);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!$('statMonth')) return; // bukan halaman dashboard
    // Jika sesi tidak valid, auth.js sudah mengalihkan ke login; jangan panggil API
    if (Api.isLoggedIn()) load();
  });
})();
