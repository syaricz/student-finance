const pool = require('../config/db');

// GET /api/v1/payment-methods (untuk dropdown metode pembayaran)
exports.getPaymentMethods = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, name, is_default FROM payment_methods ORDER BY id ASC');
    return res.status(200).json(
      rows.map((r) => ({ id: r.id, name: r.name, is_default: Boolean(r.is_default) }))
    );
  } catch (err) {
    next(err);
  }
};
