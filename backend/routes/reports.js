const express = require('express');
const { query } = require('express-validator');

const reportController = require('../controllers/reportController');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();

// Semua route laporan butuh login
router.use(auth);

const DATE_OPTS = { format: 'YYYY-MM-DD', strictMode: true, delimiters: ['-'] };
const inSupportedYears = (v) => v >= '2000-01-01' && v <= '2100-12-31';

const dateRule = (field, label) =>
  query(field)
    .exists({ values: 'falsy' }).withMessage(`${label} wajib diisi (YYYY-MM-DD)`)
    .bail()
    .isDate(DATE_OPTS).withMessage(`${label} harus berformat YYYY-MM-DD dan tanggal yang valid`)
    .bail()
    .custom(inSupportedYears).withMessage(`${label} harus antara tahun 2000 dan 2100`);

const rangeRules = [
  dateRule('start_date', 'start_date'),
  dateRule('end_date', 'end_date')
    .bail()
    .custom((value, { req }) => !req.query.start_date || value >= req.query.start_date)
    .withMessage('end_date tidak boleh sebelum start_date'),
  query('category_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('category_id tidak valid'),
];

router.get(
  '/summary',
  [
    ...rangeRules,
    // Tanggal "hari ini" menurut browser (opsional) untuk menghitung rata-rata per hari
    query('date').optional({ values: 'falsy' }).isDate(DATE_OPTS).withMessage('date harus berformat YYYY-MM-DD'),
  ],
  validate,
  reportController.getSummary
);

router.get(
  '/monthly',
  [
    query('year').optional({ values: 'falsy' }).isInt({ min: 2000, max: 2100 }).withMessage('year harus 2000-2100'),
    query('category_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('category_id tidak valid'),
  ],
  validate,
  reportController.getMonthlyReport
);

router.get('/category', rangeRules, validate, reportController.getCategoryReport);

module.exports = router;
