const express = require('express');
const { body } = require('express-validator');

const authController = require('../controllers/authController');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();

const registerRules = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Nama 2-100 karakter'),
  body('email')
    .trim()
    .toLowerCase()
    .isEmail().withMessage('Format email tidak valid')
    .isLength({ max: 150 }).withMessage('Email maksimal 150 karakter'),
  body('password').isLength({ min: 8, max: 72 }).withMessage('Password 8-72 karakter'),
  body('confirm_password')
    .optional()
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Konfirmasi password tidak sama'),
];

const loginRules = [
  body('email').trim().toLowerCase().isEmail().withMessage('Format email tidak valid'),
  body('password').notEmpty().withMessage('Password wajib diisi'),
];

router.post('/register', registerRules, validate, authController.register);
router.post('/login', loginRules, validate, authController.login);
router.post('/logout', auth, authController.logout);
router.get('/me', auth, authController.me);

module.exports = router;
