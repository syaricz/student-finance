const fs = require('fs');
const { validationResult } = require('express-validator');

// Kembalikan 400 jika ada error validasi dari express-validator.
// File yang sudah terlanjur diunggah (multer) ikut dihapus agar tidak menjadi sampah.
module.exports = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  if (req.file) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      /* file sudah tidak ada: abaikan */
    }
  }

  return res.status(400).json({
    message: 'Validasi gagal',
    errors: result.array().map((e) => ({ field: e.path, message: e.msg })),
  });
};
