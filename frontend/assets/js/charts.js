/* ============================================================
   charts.js - grafik dashboard (Chart.js 4)
   1. Line     : tren pengeluaran harian (7 / 30 hari)
   2. Doughnut : distribusi pengeluaran per kategori (bulan ini)
   3. Bar      : anggaran vs realisasi per kategori (bulan ini)
   Data dari GET /dashboard/chart. Butuh: api.js, utils.js, Chart.js (CDN).
   Teks dari server dirender dengan textContent (anti XSS).
   ============================================================ */
(function () {
  'use strict';

  const C = {
    primary: '#2563EB',
    text: '#111827',
    muted: '#6B7280',
    border: '#E5E7EB',
    fallback: '#6B7280',
    budget: '#CBD5E1',
    budgetEdge: '#64748B',
  };
  const STATUS = {
    aman: { label: 'Aman', color: '#108981' },
    waspada: { label: 'Waspada', color: '#F59E0B' },
    hampir_habis: { label: 'Hampir habis', color: '#F97316' },
    melebihi: { label: 'Melebihi anggaran', color: '#EF4444' },
  };

  const $ = (id) => document.getElementById(id);
  const h = Fmt.h;
  const money = (n) => Fmt.rupiah.format(n);
  const isHex = (c) => /^#[0-9A-Fa-f]{6}$/.test(c || '');
  const colorOf = (c) => (isHex(c) ? c : C.fallback);
  const pct = (n) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%';

  const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
  const axisMoney = (v) => (v === 0 ? 'Rp 0' : 'Rp ' + compact.format(v));

  const parseISO = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const shortDateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
  const longDateFmt = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthFmt = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
  const shortDate = (s) => { const d = parseISO(s); return d ? shortDateFmt.format(d) : s; };
  const longDate = (s) => { const d = parseISO(s); return d ? longDateFmt.format(d) : s; };

  const label = (item) => (item.icon ? item.icon + ' ' : '') + item.name;
  const truncate = (s, max) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
  // Kontainer sempit (HP): label kategori lebih pendek agar batang punya ruang
  const barMaxLabel = () => (($('barCanvasBox').clientWidth || 600) < 420 ? 16 : 24);

  const panels = {
    line: { chart: null, seq: 0, period: '7d' },
    pie: { chart: null, seq: 0 },
    bar: { chart: null, seq: 0 },
  };

  /* ---------- Tampilan panel: loading / empty / error / ready ---------- */
  function show(key, state, message, onRetry, link) {
    const box = $(key + 'Box');
    const st = $(key + 'State');
    if (state === 'ready') {
      box.classList.remove('d-none');
      st.classList.add('d-none');
      return;
    }
    box.classList.add('d-none');
    st.classList.remove('d-none');
    st.replaceChildren(h('p', 'mb-0', message));
    if (link) {
      const a = h('a', 'btn btn-outline-primary btn-sm', link.text);
      a.href = link.href;
      st.appendChild(a);
    }
    if (onRetry) {
      const btn = h('button', 'btn btn-outline-primary btn-sm', 'Coba lagi');
      btn.type = 'button';
      btn.addEventListener('click', onRetry);
      st.appendChild(btn);
    }
  }

  function destroy(key) {
    if (panels[key].chart) {
      panels[key].chart.destroy();
      panels[key].chart = null;
    }
  }

  const todayISO = () => Fmt.iso(new Date());

  function applyDefaults() {
    const d = Chart.defaults;
    d.font.family = "'Inter', system-ui, -apple-system, sans-serif";
    d.font.size = 12;
    d.color = C.muted;
    d.borderColor = C.border;
    // Hormati preferensi "kurangi animasi" dari sistem operasi
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) d.animation = false;

    const t = d.plugins.tooltip;
    t.backgroundColor = C.text;
    t.titleColor = '#fff';
    t.bodyColor = '#fff';
    t.footerColor = '#D1D5DB';
    t.padding = 10;
    t.cornerRadius = 8;
    t.boxPadding = 4;
    t.titleFont = { weight: '600' };
    t.footerFont = { weight: '400' };
  }

  /* ============================================================
     1. LINE: tren pengeluaran harian
     ============================================================ */
  function renderLine(data) {
    const days = data.labels.length;
    const total = data.total;
    const average = days ? total / days : 0;
    const periodText = data.period === '30d' ? '30 hari' : '7 hari';

    $('lineSummary').textContent = total > 0
      ? 'Total ' + periodText + ': ' + money(total) + ' · rata-rata ' + money(Math.round(average)) + '/hari'
      : periodText.charAt(0).toUpperCase() + periodText.slice(1) + ' terakhir';

    destroy('line');
    if (total === 0) return show('line', 'empty', 'Belum ada pengeluaran pada ' + periodText + ' terakhir.');
    show('line', 'ready');

    const peakIdx = data.values.indexOf(Math.max.apply(null, data.values));
    $('lineChart').setAttribute(
      'aria-label',
      'Grafik garis pengeluaran harian ' + periodText + ' terakhir. Total ' + money(total) +
      ', rata-rata ' + money(Math.round(average)) + ' per hari, tertinggi ' + money(data.values[peakIdx]) +
      ' pada ' + longDate(data.labels[peakIdx]) + '.'
    );

    const dense = days > 14;
    panels.line.chart = new Chart($('lineChart'), {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{
          label: 'Pengeluaran',
          data: data.values,
          borderColor: C.primary,
          borderWidth: 2,
          cubicInterpolationMode: 'monotone', // tidak melengkung melewati data (mis. di bawah Rp 0)
          fill: true,
          backgroundColor: function (ctx) {
            const area = ctx.chart.chartArea;
            if (!area) return 'rgba(37, 99, 235, 0.12)';
            const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, 'rgba(37, 99, 235, 0.25)');
            g.addColorStop(1, 'rgba(37, 99, 235, 0)');
            return g;
          },
          pointRadius: dense ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#fff',
          pointBorderColor: C.primary,
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 8, right: 8 } },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: dense ? 6 : 7,
              callback: function (value) { return shortDate(this.getLabelForValue(value)); },
            },
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            ticks: { maxTicksLimit: 5, callback: (v) => axisMoney(v) },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => longDate(items[0].label),
              label: (ctx) => 'Pengeluaran: ' + money(ctx.parsed.y),
              footer: () => 'Rata-rata harian: ' + money(Math.round(average)),
            },
          },
        },
      },
    });
  }

  async function loadLine() {
    const p = panels.line;
    const seq = ++p.seq; // abaikan respons lama bila user berganti periode dengan cepat
    destroy('line');
    show('line', 'loading', 'Memuat grafik...');
    try {
      const data = await Api.get('/dashboard/chart?type=line&period=' + p.period + '&date=' + todayISO());
      if (seq !== p.seq) return;
      renderLine(data);
    } catch (err) {
      if (seq !== p.seq) return;
      show('line', 'error', err.message, loadLine);
    }
  }

  function bindPeriodToggle() {
    const buttons = document.querySelectorAll('.sf-seg [data-period]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (panels.line.period === btn.dataset.period) return;
        panels.line.period = btn.dataset.period;
        buttons.forEach(function (b) {
          const on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        loadLine();
      });
    });
  }

  /* ============================================================
     2. DOUGHNUT: distribusi per kategori
     ============================================================ */
  function renderPie(data) {
    const items = data.items;
    const monthLabel = monthFmt.format(parseISO(data.start_date) || new Date());
    $('pieSummary').textContent = data.total > 0
      ? monthLabel + ' · total ' + money(data.total)
      : monthLabel;

    destroy('pie');
    if (!items.length) return show('pie', 'empty', 'Belum ada pengeluaran bulan ini.');
    show('pie', 'ready');

    $('pieChart').setAttribute(
      'aria-label',
      'Grafik donat pengeluaran per kategori. ' +
      items.slice(0, 3).map((i) => i.name + ' ' + pct(i.percentage)).join(', ') +
      (items.length > 3 ? ', dan ' + (items.length - 3) + ' kategori lain.' : '.')
    );

    panels.pie.chart = new Chart($('pieChart'), {
      type: 'doughnut',
      data: {
        labels: items.map((i) => i.name),
        datasets: [{
          data: items.map((i) => i.amount),
          backgroundColor: items.map((i) => colorOf(i.color)),
          borderColor: '#fff',
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false }, // legenda dibuat sendiri (HTML) agar tidak terpotong di layar kecil
          tooltip: {
            callbacks: {
              title: (tt) => label(items[tt[0].dataIndex]),
              label: (ctx) => money(ctx.parsed) + ' (' + pct(items[ctx.dataIndex].percentage) + ')',
            },
          },
        },
      },
    });

    // Legenda HTML: sekaligus menjadi padanan teks grafik untuk pembaca layar
    $('pieLegend').replaceChildren(...items.map(function (i) {
      const li = h('li');
      const dot = h('span', 'sf-swatch');
      dot.style.background = colorOf(i.color);
      li.appendChild(dot);
      li.appendChild(h('span', 'sf-legend-name', label(i)));
      li.appendChild(h('span', 'sf-legend-amount', money(i.amount)));
      li.appendChild(h('span', 'sf-legend-pct', pct(i.percentage)));
      return li;
    }));
  }

  async function loadPie() {
    const p = panels.pie;
    const seq = ++p.seq;
    destroy('pie');
    show('pie', 'loading', 'Memuat grafik...');
    try {
      const data = await Api.get('/dashboard/chart?type=pie&period=month&date=' + todayISO());
      if (seq !== p.seq) return;
      renderPie(data);
    } catch (err) {
      if (seq !== p.seq) return;
      show('pie', 'error', err.message, loadPie);
    }
  }

  /* ============================================================
     3. BAR: anggaran vs realisasi (horizontal agar nama kategori panjang tetap terbaca)
     ============================================================ */
  function renderBar(data) {
    const items = data.items;
    const monthLabel = monthFmt.format(new Date(data.year, data.month - 1, 1));

    destroy('bar');
    if (!data.has_budget) {
      $('barSummary').textContent = monthLabel;
      return show('bar', 'empty', 'Anggaran ' + monthLabel.toLowerCase() + ' belum diatur, jadi belum ada yang dibandingkan.', null, { text: 'Atur anggaran', href: 'budgets.html' });
    }
    $('barSummary').textContent = monthLabel + ' · anggaran total ' + money(data.budget_total);
    if (!items.length) {
      return show('bar', 'empty', 'Belum ada alokasi anggaran per kategori dan belum ada pengeluaran bulan ini.');
    }
    show('bar', 'ready');
    const maxLabel = barMaxLabel();
    panels.bar.data = data;
    panels.bar.maxLabel = maxLabel;

    // Tinggi mengikuti jumlah kategori supaya batang tidak menyempit
    $('barCanvasBox').style.height = Math.max(200, items.length * 56 + 56) + 'px';

    const statusColor = (i) => (i.status && STATUS[i.status] ? STATUS[i.status].color : C.budgetEdge);
    $('barChart').setAttribute(
      'aria-label',
      'Grafik batang anggaran dan realisasi bulan ini untuk ' + items.length + ' kategori. ' +
      items.slice(0, 3).map((i) => i.name + ': ' + money(i.used) + (i.allocated > 0 ? ' dari ' + money(i.allocated) : ', tanpa anggaran')).join('; ') +
      (items.length > 3 ? '; dan seterusnya.' : '.')
    );

    panels.bar.chart = new Chart($('barChart'), {
      type: 'bar',
      data: {
        labels: items.map((i) => truncate(label(i), maxLabel)),
        datasets: [
          {
            label: 'Anggaran',
            data: items.map((i) => i.allocated),
            backgroundColor: C.budget,
            borderColor: C.budgetEdge,
            borderWidth: 1,
            borderRadius: 4,
            maxBarThickness: 18,
          },
          {
            label: 'Realisasi',
            data: items.map((i) => i.used),
            backgroundColor: items.map(statusColor),
            borderRadius: 4,
            maxBarThickness: 18,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', axis: 'y', intersect: false },
        layout: { padding: { right: 8 } },
        scales: {
          x: {
            beginAtZero: true,
            border: { display: false },
            ticks: { maxTicksLimit: 5, callback: (v) => axisMoney(v) },
          },
          y: { grid: { display: false }, ticks: { autoSkip: false } },
        },
        plugins: {
          legend: { display: false }, // keterangan warna ada di bawah grafik (HTML)
          tooltip: {
            callbacks: {
              title: (tt) => label(items[tt[0].dataIndex]),
              label: (ctx) => ctx.dataset.label + ': ' + money(ctx.parsed.x),
              footer: function (tt) {
                const i = items[tt[0].dataIndex];
                if (!(i.allocated > 0)) return 'Tidak dianggarkan';
                const st = STATUS[i.status];
                const rest = i.used > i.allocated
                  ? 'Lebih ' + money(i.used - i.allocated)
                  : 'Sisa ' + money(i.allocated - i.used);
                return pct(i.percentage) + ' terpakai · ' + (st ? st.label : '') + '\n' + rest;
              },
            },
          },
        },
      },
    });
  }

  async function loadBar() {
    const p = panels.bar;
    const seq = ++p.seq;
    destroy('bar');
    show('bar', 'loading', 'Memuat grafik...');
    try {
      const data = await Api.get('/dashboard/chart?type=bar&date=' + todayISO());
      if (seq !== p.seq) return;
      renderBar(data);
    } catch (err) {
      if (seq !== p.seq) return;
      show('bar', 'error', err.message, loadBar);
    }
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (!$('lineChart')) return; // bukan halaman dashboard
    if (!Api.isLoggedIn()) return; // auth.js sudah mengalihkan ke login

    bindPeriodToggle();

    // Chart.js gagal diunduh dari CDN (offline / diblokir)
    if (typeof Chart === 'undefined') {
      const msg = 'Grafik tidak dapat dimuat karena pustaka Chart.js gagal diunduh. Periksa koneksi internet lalu muat ulang halaman.';
      ['line', 'pie', 'bar'].forEach((k) => show(k, 'error', msg));
      return;
    }

    applyDefaults();
    loadLine();
    loadPie();
    loadBar();

    // Lebar layar berubah melewati batas sempit/lebar: gambar ulang grafik bar dengan label yang sesuai
    let resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        const p = panels.bar;
        if (p.chart && p.data && barMaxLabel() !== p.maxLabel) renderBar(p.data);
      }, 200);
    });
  });
})();
