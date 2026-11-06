const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const {
  listNotifications,
  markNotificationsRead,
} = require('../controllers/notificationsController');

const router = express.Router();

router.get('/', requireAuth, listNotifications);
router.post('/mark-read', requireAuth, markNotificationsRead);

module.exports = router;
