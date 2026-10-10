/* ============================================================
   notifications.js - notifikasi in-app (Blueprint bagian 17)
   - Badge + dropdown lonceng di navbar (semua halaman terproteksi)
   - Toast Bootstrap saat ada notifikasi baru
   - Polling setiap 30 detik (dijeda saat tab tersembunyi)
   - Logika halaman notifications.html (daftar, filter, tandai dibaca)
   Dimuat otomatis oleh layout.js setelah navbar tersedia.
   Mandiri: tidak bergantung pada utils.js. Teks dari server dirender dengan textContent (anti XSS).
   ============================================================ */
(function () {
  'use strict';

  if (!window.Api || !Api.isLoggedIn()) return;
  if (window.Notifications) return; // jangan diinisialisasi dua kali

  // Interval polling. Nilai bawaan 30 detik; window.SF_NOTIF_POLL_MS hanya untuk pengujian.
  const POLL_MS = Number(window.SF_NOTIF_POLL_MS) || 30000;
  const MAX_SINGLE_TOASTS = 3; // lebih dari ini diringkas menjadi satu toast
  const TOAST_DELAY = 8000;

  const LEVEL_COLOR = { waspada: '#F59E0B', hampir_habis: '#F97316', habis: '#F97316', melebihi: '#EF4444' };
  const TYPE_COLOR = { budget_warning: '#F59E0B', budget_exceeded: '#EF4444', reminder: '#2563EB', monthly_summary: '#7C3AED' };
  const colorOf = (n) => LEVEL_COLOR[n.level] || TYPE_COLOR[n.type] || '#6B7280';
  const isBudget = (n) => n.type === 'budget_warning' || n.type === 'budget_exceeded';
  const targetOf = (n) => Api.pageUrl(isBudget(n) ? 'budgets.html' : 'notifications.html');
  const targetLabel = (n) => (isBudget(n) ? 'Lihat anggaran' : 'Lihat');

  const $ = (id) => document.getElementById(id);
  function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  /* ---------- Waktu ---------- */
  // Server mengirim age_seconds (umur saat respons dibuat) sehingga waktu relatif benar
  // walau zona waktu server berbeda dari browser.
  function stamp(items) {
    const now = Date.now();
    return items.map((n) => Object.assign({}, n, { occurred: now - (Number(n.age_seconds) || 0) * 1000 }));
  }
  const absFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  function relTime(occurred) {
    const s = Math.max(0, (Date.now() - occurred) / 1000);
    if (s < 45) return 'baru saja';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' menit lalu';
    const hr = Math.floor(s / 3600);
    if (hr < 24) return hr + ' jam lalu';
    const d = Math.floor(s / 86400);
    if (d === 1) return 'kemarin';
    if (d < 7) return d + ' hari lalu';
    return dayFmt.format(new Date(occurred));
  }

  /* ---------- State ---------- */
  const state = { items: [], unread: 0, loaded: false, failed: false, inflight: null, timer: null };
  const newListeners = [];

  const seenKey = () => 'sf_notif_seen_' + ((Api.getUser() || {}).id || 'x');
  function getSeen() {
    try { const v = localStorage.getItem(seenKey()); return v === null ? null : Number(v); } catch (e) { return null; }
  }
  function setSeen(id) {
    try { localStorage.setItem(seenKey(), String(id)); } catch (e) { /* abaikan */ }
  }

  /* ---------- Badge & dropdown ---------- */
  function setBadge(count) {
    state.unread = count;
    if (window.Layout && Layout.setNotificationCount) Layout.setNotificationCount(count);
    const btn = $('notifReadAll');
    if (btn) btn.disabled = count <= 0;
  }

  function renderDropdown() {
    const list = $('notifList');
    if (!list) return;
    list.replaceChildren();

    if (!state.items.length) {
      const msg = state.failed && !state.loaded ? 'Gagal memuat notifikasi.' : 'Belum ada notifikasi.';
      list.appendChild(h('li', 'sf-dropdown-empty', msg));
      return;
    }
    state.items.forEach(function (n) {
      const li = h('li');
      const a = h('a', 'sf-notif-item' + (n.is_read ? '' : ' unread'));
      a.href = targetOf(n);
      a.dataset.id = n.id;
      const dot = h('span', 'sf-notif-dot');
      dot.style.background = colorOf(n);
      const body = h('span', 'sf-notif-body');
      body.appendChild(h('span', 'sf-notif-title', n.title));
      body.appendChild(h('span', 'sf-notif-msg', n.message));
      body.appendChild(h('span', 'sf-notif-time', relTime(n.occurred) + (n.is_read ? '' : ' · belum dibaca')));
      a.appendChild(dot);
      a.appendChild(body);
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  /* ---------- Toast ---------- */
  function toastHost() {
    let host = $('sfToastHost');
    if (!host) {
      host = h('div', 'toast-container position-fixed bottom-0 end-0 p-3');
      host.id = 'sfToastHost';
      host.style.zIndex = '1090';
      document.body.appendChild(host);
    }
    return host;
  }

  function showToast(title, message, color, href, linkText) {
    const el = h('div', 'toast sf-toast');
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    el.setAttribute('aria-atomic', 'true');
    el.style.setProperty('--c', color);

    const wrap = h('div', 'd-flex');
    const body = h('div', 'toast-body');
    body.appendChild(h('div', 'fw-semibold', title));
    if (message) body.appendChild(h('div', 'small sf-toast-msg', message));
    if (href) {
      const link = h('a', 'small', linkText || 'Lihat');
      link.href = href;
      body.appendChild(link);
    }
    const close = h('button', 'btn-close me-2 m-auto');
    close.type = 'button';
    close.setAttribute('aria-label', 'Tutup');
    close.setAttribute('data-bs-dismiss', 'toast');
    wrap.appendChild(body);
    wrap.appendChild(close);
    el.appendChild(wrap);
    toastHost().appendChild(el);

    if (window.bootstrap && bootstrap.Toast) {
      const t = bootstrap.Toast.getOrCreateInstance(el, { delay: TOAST_DELAY });
      el.addEventListener('hidden.bs.toast', function () { el.remove(); });
      t.show();
    } else {
      el.classList.add('show');
      setTimeout(function () { el.remove(); }, TOAST_DELAY);
    }
  }

  function announce(fresh) {
    if (fresh.length > MAX_SINGLE_TOASTS) {
      showToast(fresh.length + ' notifikasi baru', 'Ada beberapa peringatan anggaran yang perlu Anda lihat.', '#2563EB',
        Api.pageUrl('notifications.html'), 'Buka notifikasi');
      return;
    }
    fresh.slice().reverse().forEach(function (n) {
      showToast(n.title, n.message, colorOf(n), targetOf(n), targetLabel(n));
    });
  }

  /* ---------- Ambil data & deteksi notifikasi baru ---------- */
  function applyLatest(res) {
    const data = Array.isArray(res && res.data) ? res.data : [];
    state.items = stamp(data);
    state.loaded = true;
    state.failed = false;
    setBadge(Number(res && res.unread_count) || 0);

    // Toast hanya untuk notifikasi belum dibaca yang id-nya lebih baru dari yang terakhir diketahui.
    // Pemuatan pertama (belum ada catatan) hanya menetapkan acuan, agar tidak membanjiri toast lama.
    const maxId = data.reduce((m, n) => Math.max(m, n.id), 0);
    const seen = getSeen();
    if (seen === null) {
      setSeen(maxId);
    } else if (maxId > seen) {
      const fresh = state.items.filter((n) => n.id > seen && !n.is_read);
      setSeen(maxId);
      if (fresh.length) {
        announce(fresh);
        newListeners.forEach((fn) => { try { fn(fresh); } catch (e) { /* abaikan */ } });
      }
    }
    renderDropdown();
  }

  function refresh() {
    if (state.inflight) return state.inflight; // jangan tumpang tindih
    state.inflight = Api.get('/notifications?limit=5')
      .then(applyLatest)
      .catch(function () {
        // Gagal (server mati/offline): diam saja, badge terakhir dipertahankan. Polling berikutnya mencoba lagi.
        state.failed = true;
        if (!state.loaded) renderDropdown();
      })
      .then(function () { state.inflight = null; });
    return state.inflight;
  }

  function startPolling() {
    if (state.timer) clearInterval(state.timer);
    // Dijeda saat tab tersembunyi supaya tidak memboroskan request
    state.timer = setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
  }

  /* ---------- Tandai dibaca ---------- */
  async function markRead(id) {
    const res = await Api.put('/notifications/' + id + '/read');
    state.items = state.items.map((n) => (n.id === id ? Object.assign({}, n, { is_read: true }) : n));
    setBadge(res.unread_count);
    renderDropdown();
    return res;
  }

  async function markAllRead() {
    const res = await Api.put('/notifications/read-all');
    state.items = state.items.map((n) => Object.assign({}, n, { is_read: true }));
    setBadge(0);
    renderDropdown();
    return res;
  }

  function bindDropdown() {
    const list = $('notifList');
    if (list) {
      list.addEventListener('click', async function (e) {
        const a = e.target.closest('a[data-id]');
        if (!a) return;
        e.preventDefault();
        const id = Number(a.dataset.id);
        const item = state.items.find((n) => n.id === id);
        if (item && !item.is_read) {
          try { await markRead(id); } catch (err) { /* tetap lanjut ke halaman tujuan */ }
        }
        location.href = a.getAttribute('href');
      });
    }
    const all = $('notifReadAll');
    if (all) {
      all.addEventListener('click', async function (e) {
        e.stopPropagation(); // dropdown tetap terbuka agar hasilnya terlihat
        try { await markAllRead(); } catch (err) { /* abaikan */ }
      });
    }
  }

  /* ============================================================
     Halaman notifications.html
     ============================================================ */
  function initPage() {
    const listEl = $('notifPageList');
    if (!listEl) return;
    const P = { page: 1, limit: 10, unreadOnly: false, items: [], pagination: null, seq: 0 };

    function alertBox(type, message) {
      const box = $('pageAlert');
      box.className = 'alert alert-' + type;
      box.textContent = message;
    }

    function buildCard(n) {
      const li = h('li', 'sf-notif-card' + (n.is_read ? '' : ' unread'));
      li.style.setProperty('--c', colorOf(n));

      const head = h('div', 'd-flex justify-content-between align-items-start gap-2');
      head.appendChild(h('h2', 'h6 fw-semibold mb-0 sf-notif-card-title', n.title));
      if (!n.is_read) head.appendChild(h('span', 'badge text-bg-primary flex-shrink-0', 'Baru'));
      li.appendChild(head);

      li.appendChild(h('p', 'mb-2 mt-1', n.message));

      const foot = h('div', 'd-flex flex-wrap justify-content-between align-items-center gap-2');
      const time = h('span', 'small text-secondary', relTime(n.occurred));
      time.title = absFmt.format(new Date(n.occurred));
      foot.appendChild(time);

      const actions = h('div', 'd-flex flex-wrap gap-2');
      const view = h('a', 'btn btn-outline-primary btn-sm', targetLabel(n));
      view.href = targetOf(n);
      actions.appendChild(view);
      if (!n.is_read) {
        const read = h('button', 'btn btn-outline-secondary btn-sm', 'Tandai dibaca');
        read.type = 'button';
        read.dataset.action = 'read';
        read.dataset.id = n.id;
        read.setAttribute('aria-label', 'Tandai dibaca: ' + n.title);
        actions.appendChild(read);
      }
      foot.appendChild(actions);
      li.appendChild(foot);
      return li;
    }

    function render(unreadCount) {
      $('loading').classList.add('d-none');
      const empty = P.items.length === 0;
      listEl.classList.toggle('d-none', empty);
      $('emptyState').classList.toggle('d-none', !empty);
      if (empty) {
        $('emptyText').textContent = P.unreadOnly
          ? 'Tidak ada notifikasi yang belum dibaca.'
          : 'Belum ada notifikasi.';
      }
      listEl.replaceChildren(...P.items.map(buildCard));

      const pg = P.pagination;
      const pages = pg ? pg.total_pages : 0;
      $('pager').classList.toggle('d-none', pages <= 1);
      $('pageInfo').textContent = 'Halaman ' + (pg ? pg.page : 1) + ' dari ' + pages;
      $('prevPage').disabled = !pg || pg.page <= 1;
      $('nextPage').disabled = !pg || pg.page >= pages;

      $('tabUnreadCount').textContent = unreadCount > 0 ? ' (' + unreadCount + ')' : '';
      $('markAllBtn').disabled = unreadCount <= 0;
    }

    async function load() {
      const seq = ++P.seq;
      try {
        const res = await Api.get('/notifications?page=' + P.page + '&limit=' + P.limit + (P.unreadOnly ? '&unread=1' : ''));
        if (seq !== P.seq) return;
        const total = res.pagination.total_pages;
        // Halaman sekarang kosong padahal masih ada data (mis. setelah menandai item terakhir di filter "belum dibaca")
        if (res.data.length === 0 && P.page > 1 && total > 0) {
          P.page = total;
          return load();
        }
        P.items = stamp(res.data);
        P.pagination = res.pagination;
        setBadge(res.unread_count);
        render(res.unread_count);
      } catch (err) {
        if (seq !== P.seq) return;
        $('loading').classList.add('d-none');
        alertBox('danger', err.message);
      }
    }

    function setTab(unreadOnly) {
      if (P.unreadOnly === unreadOnly) return;
      P.unreadOnly = unreadOnly;
      P.page = 1;
      $('tabAll').classList.toggle('active', !unreadOnly);
      $('tabAll').setAttribute('aria-pressed', String(!unreadOnly));
      $('tabUnread').classList.toggle('active', unreadOnly);
      $('tabUnread').setAttribute('aria-pressed', String(unreadOnly));
      load();
    }

    $('tabAll').addEventListener('click', () => setTab(false));
    $('tabUnread').addEventListener('click', () => setTab(true));
    $('prevPage').addEventListener('click', () => { P.page -= 1; load(); window.scrollTo({ top: 0 }); });
    $('nextPage').addEventListener('click', () => { P.page += 1; load(); window.scrollTo({ top: 0 }); });

    listEl.addEventListener('click', async function (e) {
      const btn = e.target.closest('button[data-action="read"]');
      if (!btn) return;
      btn.disabled = true;
      try {
        await markRead(Number(btn.dataset.id));
        await load();
      } catch (err) {
        btn.disabled = false;
        alertBox('danger', err.message);
      }
    });

    $('markAllBtn').addEventListener('click', async function () {
      try {
        await markAllRead();
        alertBox('success', 'Semua notifikasi ditandai sudah dibaca.');
        await load();
      } catch (err) {
        alertBox('danger', err.message);
      }
    });

    // Ada notifikasi baru saat halaman terbuka: segarkan daftar (bila di halaman pertama)
    newListeners.push(function () { if (P.page === 1) load(); });
    load();
  }

  /* ---------- Init ---------- */
  window.Notifications = {
    refresh: refresh,
    markRead: markRead,
    markAllRead: markAllRead,
    POLL_MS: POLL_MS,
    onNew: function (fn) { newListeners.push(fn); },
  };

  bindDropdown();
  initPage();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  refresh();
  startPolling();
})();
