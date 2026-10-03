const express = require('express');
const { body, param } = require('express-validator');

const categoryController = require('../controllers/categoryController');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();

// Semua route kategori butuh login
router.use(auth);

const idRule = param('id').isInt({ min: 1 }).withMessage('ID kategori tidak valid');

const categoryRules = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Nama kategori wajib diisi (maksimal 100 karakter)'),
  body('icon')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 50 })
    .withMessage('Icon maksimal 50 karakter'),
  body('color')
    .optional({ values: 'falsy' })
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage('Warna harus berformat hex, contoh #2563EB'),
];

router.get('/', categoryController.getCategories);
router.post('/', categoryRules, validate, categoryController.createCategory);
router.put('/:id', idRule, categoryRules, validate, categoryController.updateCategory);
router.delete('/:id', idRule, validate, categoryController.deleteCategory);

module.exports = router;
