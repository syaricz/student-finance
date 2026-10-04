/* ============================================================
   utils.js - helper format bersama (rupiah, tanggal, DOM)
   Dipakai sebagai global: Fmt.rupiah, Fmt.iso, Fmt.formatDate, Fmt.h
   ============================================================ */
(function (global) {
  'use strict';

  const rupiah = new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  const dateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

  // Date -> 'YYYY-MM-DD' menurut waktu lokal (bukan UTC)
  function iso(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // 'YYYY-MM-DD' -> teks tanggal tanpa bergeser karena timezone
  function formatDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? dateFmt.format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : s || '';
  }

  // Buat elemen dengan teks aman (textContent)
  function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  global.Fmt = { rupiah: rupiah, iso: iso, formatDate: formatDate, h: h };
})(window);
