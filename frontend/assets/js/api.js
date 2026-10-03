/* ============================================================
   api.js - helper fetch + token (Student Finance)
   Dipanggil sebagai global: Api.get / Api.post / Api.put / Api.del
   ============================================================ */
(function (global) {
  'use strict';

  // Ubah jika backend berjalan di host/port lain
  const API_BASE_URL = 'http://localhost:3000/api/v1';
  const TOKEN_KEY = 'sf_token';
  const USER_KEY = 'sf_user';

  class ApiError extends Error {
    constructor(message, status, errors) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.errors = errors || [];
    }
  }

  /* ---------- Session ---------- */
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch (e) {
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  // Hanya hapus key milik aplikasi (preferensi lain, mis. tema, tidak ikut terhapus)
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function parseJwt(token) {
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload));
    } catch (e) {
      return null;
    }
  }

  // true jika ada token yang formatnya benar dan belum kedaluwarsa
  function isLoggedIn() {
    const token = getToken();
    if (!token) return false;
    const payload = parseJwt(token);
    if (!payload) {
      clearSession();
      return false;
    }
    if (payload.exp && payload.exp * 1000 <= Date.now()) {
      clearSession();
      return false;
    }
    return true;
  }

  /* ---------- Navigasi ---------- */
  // Halaman di folder /admin/ perlu naik satu level
  function pageUrl(name) {
    const prefix = location.pathname.indexOf('/admin/') !== -1 ? '../' : '';
    return prefix + name;
  }

  function redirect(url) {
    location.replace(url);
  }

  /* ---------- Request ---------- */
  async function request(path, options) {
    const opts = options || {};
    const method = opts.method || 'GET';
    const useAuth = opts.auth !== false;
    const token = getToken();

    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    const headers = { Accept: opts.responseType === 'blob' ? '*/*' : 'application/json' };
    // FormData: biarkan browser mengisi Content-Type (multipart + boundary)
    if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (useAuth && token) headers.Authorization = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(API_BASE_URL + path, {
        method: method,
        headers: headers,
        body: opts.body === undefined ? undefined : isForm ? opts.body : JSON.stringify(opts.body),
      });
    } catch (e) {
      throw new ApiError('Tidak dapat terhubung ke server. Pastikan backend sudah berjalan.', 0);
    }

    // Unduhan file (mis. bukti transaksi): kembalikan Blob
    if (res.ok && opts.responseType === 'blob') return res.blob();

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* respons tanpa body JSON */
    }

    if (!res.ok) {
      // Token ditolak server (kedaluwarsa/tidak valid): bersihkan sesi lalu ke halaman login
      if (res.status === 401 && useAuth && token) {
        clearSession();
        global.Api.redirect(pageUrl('login.html') + '?expired=1');
      }
      throw new ApiError(
        (data && data.message) || 'Terjadi kesalahan pada server',
        res.status,
        data && data.errors
      );
    }
    return data;
  }

  global.Api = {
    API_BASE_URL: API_BASE_URL,
    ApiError: ApiError,
    getToken: getToken,
    getUser: getUser,
    setSession: setSession,
    clearSession: clearSession,
    isLoggedIn: isLoggedIn,
    pageUrl: pageUrl,
    redirect: redirect,
    request: request,
    get: (path, opts) => request(path, Object.assign({ method: 'GET' }, opts)),
    post: (path, body, opts) => request(path, Object.assign({ method: 'POST', body: body }, opts)),
    put: (path, body, opts) => request(path, Object.assign({ method: 'PUT', body: body }, opts)),
    del: (path, opts) => request(path, Object.assign({ method: 'DELETE' }, opts)),
    // GET file dengan token (untuk bukti transaksi; tidak ada folder uploads publik)
    blob: (path) => request(path, { method: 'GET', responseType: 'blob' }),
  };
})(window);
