// Cek role admin. Pasang SETELAH middleware auth.
module.exports = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses khusus admin' });
  }
  next();
};
