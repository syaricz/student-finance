const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const BCRYPT_COST = 10;
const JWT_EXPIRES_IN = '1d';

// POST /api/v1/auth/register
exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const [exist] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exist.length) {
      return res.status(409).json({ message: 'Email sudah terdaftar' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, passwordHash]
    );

    return res.status(201).json({ id: result.insertId, name, email });
  } catch (err) {
    // Antisipasi race condition: dua register bersamaan dengan email sama
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Email sudah terdaftar' });
    }
    next(err);
  }
};

// POST /api/v1/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.query(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = ?',
      [email]
    );
    const user = rows[0];

    // Pesan sengaja sama untuk email salah / password salah (anti user enumeration)
    const invalid = () => res.status(401).json({ message: 'Email atau password salah' });
    if (!user) return invalid();

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return invalid();

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.status(200).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/logout
// JWT bersifat stateless: logout sebenarnya dilakukan di client (hapus token).
exports.logout = (req, res) => {
  return res.status(200).json({ message: 'Logout berhasil' });
};

// GET /api/v1/auth/me
exports.me = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, avatar_url, currency, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }
    return res.status(200).json(rows[0]);
  } catch (err) {
    next(err);
  }
};
