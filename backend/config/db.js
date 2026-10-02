const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'student_finance',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true, // DATE tetap string 'YYYY-MM-DD', bebas masalah timezone
});

// Tes koneksi (dipanggil saat server start)
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log('✅ Koneksi database berhasil:', process.env.DB_NAME || 'student_finance');
  } catch (err) {
    console.error('❌ Koneksi database gagal:', err.message);
    process.exit(1);
  }
}

module.exports = pool;
module.exports.testConnection = testConnection;
