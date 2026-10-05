const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// Middleware global
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting: max 100 request/menit per IP
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Terlalu banyak request, coba lagi nanti.' },
  })
);

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
app.use('/api/v1/dashboard', require('./routes/dashboard'));
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
