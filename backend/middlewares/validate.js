const { validationResult } = require('express-validator');

// Kembalikan 400 jika ada error validasi dari express-validator
module.exports = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  return res.status(400).json({
    message: 'Validasi gagal',
    errors: result.array().map((e) => ({ field: e.path, message: e.msg })),
  });
};
