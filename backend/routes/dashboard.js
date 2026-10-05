const express = require('express');
const { query } = require('express-validator');

const dashboardController = require('../controllers/dashboardController');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();

// Semua route dashboard butuh login
router.use(auth);

const dateRule = query('date')
  .optional({ values: 'falsy' })
  .isDate({ format: 'YYYY-MM-DD', strictMode: true, delimiters: ['-'] })
  .withMessage('date harus berformat YYYY-MM-DD dan valid');

router.get('/summary', dateRule, validate, dashboardController.getSummary);

router.get(
  '/chart',
  [
    dateRule,
    query('type')
      .optional({ values: 'falsy' })
      .isIn(['line', 'pie', 'bar'])
      .withMessage('type harus salah satu dari: line, pie, bar'),
    query('period')
      .optional({ values: 'falsy' })
      .isIn(['7d', '30d', 'month'])
      .withMessage('period harus salah satu dari: 7d, 30d, month'),
  ],
  validate,
  dashboardController.getChartData
);

module.exports = router;
