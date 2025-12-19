const express = require('express');
const router = express.Router();
const notificationCtrl = require('../controllers/notificationCtrl');
const { isAuth } = require('../middlewares/auth');
const User = require('../models/User').User;

router.get('/notifications', isAuth, notificationCtrl.getUserNotifications);

// Register OneSignal web player ID
router.post('/register-web-push', isAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { playerId } = req.body;

    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({
        message: 'Player ID is required',
      });
    }

    await User.findByIdAndUpdate(userId, {
      oneSignalWebPlayerId: playerId.trim()
    });

    res.status(200).json({
      message: 'Web push player ID registered successfully',
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to register web push player ID',
      error: error.message,
    });
  }
});

module.exports = router;
