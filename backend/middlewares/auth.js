const jwt = require('jsonwebtoken');

// Verifikasi JWT dari header: Authorization: Bearer <token>
module.exports = (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Akses ditolak, token tidak ditemukan' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError'
        ? 'Token sudah kedaluwarsa, silakan login ulang'
        : 'Token tidak valid';
    return res.status(401).json({ message });
  }
};
