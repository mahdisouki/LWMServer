const express = require('express');
const router = express.Router();
const notificationCtrl = require('../controllers/notificationCtrl');
const { isAuth } = require('../middlewares/auth');

router.get('/notifications', isAuth, notificationCtrl.getUserNotifications);

module.exports = router;
