/* ============================================================
   layout.js - memuat navbar & sidebar lewat fetch() dan menyiapkan perilakunya
   Halaman terproteksi cukup menyediakan:
     <body data-page="dashboard">          (menandai menu aktif)
     <div id="navbar-placeholder"></div>
     <div class="sf-shell"><div id="sidebar-placeholder"></div><main class="sf-main">...</main></div>
   Dimuat dengan: <script src="assets/js/layout.js" defer></script> (setelah api.js & auth.js)
   Catatan: fetch() butuh HTTP (mis. Live Server), tidak bisa dari file://
   ============================================================ */
(function () {
  'use strict';

  const COLLAPSE_KEY = 'sf_sidebar_collapsed';
  const root = document.documentElement;

  // Jangan lakukan apa pun jika halaman bukan terproteksi atau sesi tidak valid (auth.js sudah redirect)
  if (root.dataset.auth !== 'protected' || !Api.isLoggedIn()) return;

  // Pulihkan status sidebar secepat mungkin supaya tidak berkedip
  try {
    if (localStorage.getItem(COLLAPSE_KEY) === '1') root.classList.add('sf-collapsed');
  } catch (e) { /* localStorage tidak tersedia */ }

  /* ---------- Muat komponen ---------- */
  // Placeholder diganti (bukan diisi) agar <header>/<aside> menjadi anak langsung layout
  async function loadComponent(placeholderId, file) {
    const placeholder = document.getElementById(placeholderId);
    if (!placeholder) return null;

    const res = await fetch(Api.pageUrl('components/' + file));
    if (!res.ok) throw new Error('Gagal memuat ' + file + ' (' + res.status + ')');

    const tpl = document.createElement('template');
    tpl.innerHTML = (await res.text()).trim();
    const element = tpl.content.firstElementChild;
    placeholder.replaceWith(tpl.content);
    return element;
  }

  function showLoadError(message) {
    const bar = document.createElement('div');
    bar.className = 'alert alert-warning rounded-0 mb-0';
    bar.setAttribute('role', 'alert');
    bar.textContent = message;
    document.body.prepend(bar);
  }

  /* ---------- Perilaku ---------- */
  function markActive(sidebar) {
    const page = document.body.dataset.page;
    if (!page || !sidebar) return;
    const link = sidebar.querySelector('.sf-nav-link[data-page="' + page + '"]');
    if (link) {
      link.classList.add('active');
      if (link.tagName === 'A') link.setAttribute('aria-current', 'page');
    }
  }

  function bindCollapse() {
    const btn = document.getElementById('sidebarCollapseBtn');
    if (!btn) return;

    const sync = () => {
      const collapsed = root.classList.contains('sf-collapsed');
      btn.setAttribute('aria-pressed', String(collapsed));
      const label = collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    };
    sync();

    btn.addEventListener('click', function () {
      root.classList.toggle('sf-collapsed');
      try {
        localStorage.setItem(COLLAPSE_KEY, root.classList.contains('sf-collapsed') ? '1' : '0');
      } catch (e) { /* abaikan */ }
      sync();
    });
  }

  // Badge lonceng; dipakai oleh fitur notifikasi di Fase 2.4: Layout.setNotificationCount(n)
  function setNotificationCount(count) {
    const badge = document.getElementById('notifBadge');
    const btn = document.getElementById('notifBtn');
    if (!badge) return;
    const n = Number(count) || 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('d-none', n <= 0);
    if (btn) btn.setAttribute('aria-label', n > 0 ? 'Notifikasi, ' + n + ' belum dibaca' : 'Notifikasi');
  }

  // Skrip notifikasi (lonceng, toast, polling) dimuat setelah navbar ada, di semua halaman terproteksi
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = function () { reject(new Error('Gagal memuat ' + src)); };
      document.body.appendChild(el);
    });
  }

  async function init() {
    try {
      const [navbar, sidebar] = await Promise.all([
        loadComponent('navbar-placeholder', 'navbar.html'),
        loadComponent('sidebar-placeholder', 'sidebar.html'),
      ]);
      markActive(sidebar);
      if (window.Auth && Auth.bindUserUi) Auth.bindUserUi(navbar || document);
      bindCollapse();
      document.dispatchEvent(new CustomEvent('layout:ready'));
      loadScript(Api.pageUrl('assets/js/notifications.js')).catch(function (e) { console.warn(e.message); });
    } catch (err) {
      showLoadError(
        'Menu navigasi gagal dimuat. Buka halaman ini lewat server (mis. Live Server), bukan langsung dari file. ' + err.message
      );
    }
  }

  window.Layout = { setNotificationCount: setNotificationCount };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
