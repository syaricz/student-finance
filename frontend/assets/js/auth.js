/* ============================================================
   auth.js - logic login / register / logout + proteksi halaman
   Wajib dimuat SETELAH api.js, di <head> (tanpa defer) supaya
   redirect terjadi sebelum halaman sempat tampil.

   Atribut di <html>:
     data-auth="protected" -> wajib login, jika tidak ke login.html
     data-auth="guest"     -> khusus tamu, jika sudah login ke dashboard.html
   ============================================================ */
(function () {
  'use strict';

  const mode = document.documentElement.dataset.auth;

  /* ---------- Proteksi halaman ---------- */
  if (mode === 'protected' && !Api.isLoggedIn()) {
    Api.redirect(Api.pageUrl('login.html'));
    return;
  }
  if (mode === 'guest' && Api.isLoggedIn()) {
    Api.redirect(Api.pageUrl('dashboard.html'));
    return;
  }

  /* ---------- Helper UI ---------- */
  function showAlert(type, message) {
    const box = document.getElementById('formAlert');
    if (!box) return;
    box.className = 'alert alert-' + type;
    box.textContent = message; // textContent: aman dari XSS
  }

  function hideAlert() {
    const box = document.getElementById('formAlert');
    if (box) box.className = 'alert d-none';
  }

  function setLoading(button, loading) {
    if (!button) return;
    if (loading) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Memproses...';
    } else {
      button.disabled = false;
      button.textContent = button.dataset.label || button.textContent;
    }
  }

  // Tampilkan pesan error per field dari respons backend (400)
  function applyFieldErrors(form, errors) {
    let applied = false;
    (errors || []).forEach(function (err) {
      const input = form.elements[err.field];
      if (!input) return;
      input.classList.add('is-invalid');
      const feedback = input.closest('.mb-3')
        ? input.closest('.mb-3').querySelector('.invalid-feedback')
        : null;
      if (feedback) feedback.textContent = err.message;
      applied = true;
    });
    return applied;
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.is-invalid').forEach(function (el) {
      el.classList.remove('is-invalid');
    });
  }

  function bindPasswordToggles() {
    document.querySelectorAll('[data-toggle-password]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const input = document.getElementById(btn.dataset.togglePassword);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Sembunyikan' : 'Lihat';
        btn.setAttribute('aria-pressed', String(show));
      });
    });
  }

  // Hapus penanda error saat user mulai mengetik ulang
  function bindLiveClear(form) {
    form.addEventListener('input', function (e) {
      if (e.target.classList) e.target.classList.remove('is-invalid');
    });
  }

  /* ---------- Login ---------- */
  function initLogin(form) {
    const params = new URLSearchParams(location.search);
    if (params.get('registered')) {
      showAlert('success', 'Akun berhasil dibuat. Silakan masuk.');
    } else if (params.get('expired')) {
      showAlert('warning', 'Sesi Anda berakhir. Silakan masuk lagi.');
    }
    if (params.get('email')) form.elements.email.value = params.get('email');

    bindLiveClear(form);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideAlert();
      clearFieldErrors(form);

      if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
      }
      form.classList.remove('was-validated');

      const button = form.querySelector('button[type="submit"]');
      setLoading(button, true);
      try {
        const data = await Api.post(
          '/auth/login',
          { email: form.elements.email.value.trim(), password: form.elements.password.value },
          { auth: false }
        );
        Api.setSession(data.token, data.user);
        Api.redirect(Api.pageUrl('dashboard.html'));
      } catch (err) {
        setLoading(button, false);
        if (err.status === 400 && applyFieldErrors(form, err.errors)) return;
        showAlert('danger', err.message);
      }
    });
  }

  /* ---------- Register ---------- */
  function initRegister(form) {
    const password = form.elements.password;
    const confirm = form.elements.confirm_password;

    function checkConfirm() {
      confirm.setCustomValidity(confirm.value !== password.value ? 'Konfirmasi tidak sama' : '');
    }
    password.addEventListener('input', checkConfirm);
    confirm.addEventListener('input', checkConfirm);
    bindLiveClear(form);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideAlert();
      clearFieldErrors(form);
      checkConfirm();

      if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
      }
      form.classList.remove('was-validated');

      const email = form.elements.email.value.trim();
      const button = form.querySelector('button[type="submit"]');
      setLoading(button, true);
      try {
        await Api.post(
          '/auth/register',
          {
            name: form.elements.name.value.trim(),
            email: email,
            password: password.value,
            confirm_password: confirm.value,
          },
          { auth: false }
        );
        Api.redirect('login.html?registered=1&email=' + encodeURIComponent(email));
      } catch (err) {
        setLoading(button, false);
        if (err.status === 409) {
          const input = form.elements.email;
          input.classList.add('is-invalid');
          const fb = input.closest('.mb-3').querySelector('.invalid-feedback');
          if (fb) fb.textContent = 'Email sudah terdaftar. Gunakan email lain atau masuk.';
          return;
        }
        if (err.status === 400 && applyFieldErrors(form, err.errors)) return;
        showAlert('danger', err.message);
      }
    });
  }

  /* ---------- Forgot password (placeholder) ---------- */
  function initForgot(form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
      }
      showAlert(
        'info',
        'Fitur reset password belum tersedia. Untuk sementara, hubungi admin untuk mengatur ulang password Anda.'
      );
    });
  }

  /* ---------- Logout ---------- */
  async function logout() {
    try {
      await Api.post('/auth/logout'); // best effort; token tetap dihapus di client
    } catch (e) {
      /* abaikan: sesi lokal tetap dibersihkan */
    }
    Api.clearSession();
    Api.redirect(Api.pageUrl('index.html'));
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    bindPasswordToggles();

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const forgotForm = document.getElementById('forgotForm');
    if (loginForm) initLogin(loginForm);
    if (registerForm) initRegister(registerForm);
    if (forgotForm) initForgot(forgotForm);

    document.querySelectorAll('[data-logout]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        logout();
      });
    });

    const user = Api.getUser();
    if (user) {
      document.querySelectorAll('[data-user-name]').forEach(function (el) {
        el.textContent = user.name;
      });
    }
  });

  window.Auth = { logout: logout };
})();
