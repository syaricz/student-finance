const express = require('express');
const { body, param, query } = require('express-validator');

const budgetController = require('../controllers/budgetController');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { validateMoney } = require('../utils/validators');

const router = express.Router();

// Semua route anggaran butuh login
router.use(auth);

const idRule = param('id').isInt({ min: 1 }).withMessage('ID anggaran tidak valid');

const periodRules = (required) => {
  const opt = required ? {} : { values: 'falsy' };
  const month = required ? body('month') : body('month').optional(opt);
  const year = required ? body('year') : body('year').optional(opt);
  return [
    month.isInt({ min: 1, max: 12 }).withMessage('Bulan harus 1-12'),
    year.isInt({ min: 2000, max: 2100 }).withMessage('Tahun harus 2000-2100'),
  ];
};

const budgetRules = [
  body('total_amount').custom(validateMoney('Total anggaran')),
  body('categories')
    .optional({ nullable: true })
    .isArray({ max: 100 })
    .withMessage('categories harus berupa daftar (maksimal 100 kategori)'),
  body('categories.*.category_id').isInt({ min: 1 }).withMessage('Kategori wajib dipilih'),
  // Aturan bisnis #11: allocated_amount harus > 0
  body('categories.*.allocated_amount').custom(validateMoney('Alokasi')),
];

const listRules = [
  query('month').optional({ values: 'falsy' }).isInt({ min: 1, max: 12 }).withMessage('month harus 1-12'),
  query('year').optional({ values: 'falsy' }).isInt({ min: 2000, max: 2100 }).withMessage('year harus 2000-2100'),
];

router.get('/', listRules, validate, budgetController.getBudget);
router.post('/', periodRules(true), budgetRules, validate, budgetController.createBudget);
router.put('/:id', idRule, periodRules(false), budgetRules, validate, budgetController.updateBudget);
router.delete('/:id', idRule, validate, budgetController.deleteBudget);

module.exports = router;
