const express = require('express');
const cors = require('cors');
const path = require('path');
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

// File upload (bukti transaksi)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', app: 'Student Finance API' });
});

// Routes
app.use('/api/v1/auth', require('./routes/auth'));
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
