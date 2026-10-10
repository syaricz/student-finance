const express = require('express');
const { param, query } = require('express-validator');

const notificationController = require('../controllers/notificationController');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();

// Semua route notifikasi butuh login
router.use(auth);

const listRules = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page minimal 1'),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 100 }).withMessage('limit 1-100'),
  query('unread').optional({ values: 'falsy' }).isIn(['1', 'true', '0', 'false']).withMessage('unread harus 1 atau 0'),
];

router.get('/', listRules, validate, notificationController.getNotifications);
// /read-all dideklarasikan sebelum /:id/read agar tidak tertukar
router.put('/read-all', notificationController.markAllAsRead);
router.put('/:id/read', param('id').isInt({ min: 1 }).withMessage('ID notifikasi tidak valid'), validate, notificationController.markAsRead);

module.exports = router;
