const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// Middleware global
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting: max 100 request/menit per IP.
// Pengecualian: polling notifikasi (GET /notifications, dikirim tiap tab setiap 30 detik) punya pembatas
// sendiri yang lebih longgar. Tanpa ini, banyak mahasiswa di satu jaringan kampus (satu IP) bisa
// menghabiskan jatah 100/menit hanya dengan membiarkan tab terbuka.
const limitOptions = {
  windowMs: 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak request, coba lagi nanti.' },
};
const isNotificationPolling = (req) => req.method === 'GET' && req.path === '/v1/notifications';

app.use('/api', rateLimit({ ...limitOptions, max: 100, skip: isNotificationPolling }));
app.use('/api/v1/notifications', rateLimit({ ...limitOptions, max: 600, skip: (req) => req.method !== 'GET' }));

// Catatan: folder uploads TIDAK disajikan publik. Bukti transaksi dibuka lewat
// GET /api/v1/transactions/:id/attachments/:attachmentId (butuh login, hanya pemilik).

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', app: 'Student Finance API' });
});

// Routes
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/categories', require('./routes/categories'));
app.use('/api/v1/payment-methods', require('./routes/paymentMethods'));
app.use('/api/v1/transactions', require('./routes/transactions'));
app.use('/api/v1/budgets', require('./routes/budgets'));
app.use('/api/v1/dashboard', require('./routes/dashboard'));
app.use('/api/v1/notifications', require('./routes/notifications'));
// TODO: route lain didaftarkan di fase berikutnya

// 404
app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint tidak ditemukan' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Terjadi kesalahan server' });
});

module.exports = app;
