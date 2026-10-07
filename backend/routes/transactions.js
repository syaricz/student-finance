const express = require('express');
const { body, param, query } = require('express-validator');

const transactionController = require('../controllers/transactionController');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { upload } = require('../middlewares/upload');
const { validateMoney } = require('../utils/validators');

const router = express.Router();

// Semua route transaksi butuh login
router.use(auth);

const DATE_OPTS = { format: 'YYYY-MM-DD', strictMode: true, delimiters: ['-'] };

const idRule = param('id').isInt({ min: 1 }).withMessage('ID transaksi tidak valid');
const attachmentIdRule = param('attachmentId').isInt({ min: 1 }).withMessage('ID bukti tidak valid');

/* ---------- Validasi query GET /transactions ---------- */
const listRules = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page minimal 1'),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 100 }).withMessage('limit 1-100'),
  query('sort')
    .optional({ values: 'falsy' })
    .isIn(Object.keys(transactionController.SORTS))
    .withMessage('sort harus salah satu dari: ' + Object.keys(transactionController.SORTS).join(', ')),
  query('category_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('category_id tidak valid'),
  query('payment_method_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('payment_method_id tidak valid'),
  query('start_date').optional({ values: 'falsy' }).isDate(DATE_OPTS).withMessage('start_date harus berformat YYYY-MM-DD'),
  query('end_date')
    .optional({ values: 'falsy' })
    .isDate(DATE_OPTS).withMessage('end_date harus berformat YYYY-MM-DD')
    .bail()
    .custom((value, { req }) => !req.query.start_date || value >= req.query.start_date)
    .withMessage('Tanggal akhir tidak boleh sebelum tanggal mulai'),
  query('search').optional().trim().isLength({ max: 100 }).withMessage('Kata kunci maksimal 100 karakter'),
];

/* ---------- Validasi body POST / PUT ---------- */
const transactionRules = [
  body('transaction_date')
    .optional({ values: 'falsy' })
    .isDate(DATE_OPTS)
    .withMessage('Tanggal harus berformat YYYY-MM-DD dan valid'),
  body('amount').custom(validateMoney('Nominal')),
  body('category_id').isInt({ min: 1 }).withMessage('Kategori wajib dipilih'),
  body('payment_method_id').isInt({ min: 1 }).withMessage('Metode pembayaran wajib dipilih'),
  body('description')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Deskripsi wajib diisi (maksimal 255 karakter)'),
  body('notes')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Catatan maksimal 2000 karakter'),
];

router.get('/', listRules, validate, transactionController.getTransactions);
router.post('/', upload, transactionRules, validate, transactionController.createTransaction);
router.get('/:id', idRule, validate, transactionController.getTransactionById);
router.put('/:id', upload, idRule, transactionRules, validate, transactionController.updateTransaction);
router.delete('/:id', idRule, validate, transactionController.deleteTransaction);
router.get(
  '/:id/attachments/:attachmentId',
  idRule,
  attachmentIdRule,
  validate,
  transactionController.getAttachment
);

module.exports = router;
