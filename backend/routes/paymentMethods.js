const express = require('express');
const paymentMethodController = require('../controllers/paymentMethodController');
const auth = require('../middlewares/auth');

const router = express.Router();

router.get('/', auth, paymentMethodController.getPaymentMethods);

module.exports = router;
