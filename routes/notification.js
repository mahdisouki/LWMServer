const express = require('express');
const router = express.Router();
const notificationCtrl = require('../controllers/notificationCtrl');
const { isAuth } = require('../middlewares/auth');
const User = require('../models/User').User;

router.get('/notifications', isAuth, notificationCtrl.getUserNotifications);
router.patch('/notifications/read-all', isAuth, notificationCtrl.markAllAsRead);

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

    const trimmedPlayerId = playerId.trim();
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        message: 'User not found',
      });
    }

    // Add to array if it doesn't exist
    if (!user.oneSignalWebPlayerIds || !Array.isArray(user.oneSignalWebPlayerIds)) {
      user.oneSignalWebPlayerIds = [];
    }
    
    if (!user.oneSignalWebPlayerIds.includes(trimmedPlayerId)) {
      user.oneSignalWebPlayerIds.push(trimmedPlayerId);
      // Also update legacy field for backward compatibility
      user.oneSignalWebPlayerId = trimmedPlayerId;
      await user.save();
      
      res.status(200).json({
        message: 'Web push player ID registered successfully',
        totalDevices: user.oneSignalWebPlayerIds.length,
      });
    } else {
      res.status(200).json({
        message: 'Web push player ID already registered',
        totalDevices: user.oneSignalWebPlayerIds.length,
      });
    }
  } catch (error) {
    res.status(500).json({
      message: 'Failed to register web push player ID',
      error: error.message,
    });
  }
});

module.exports = router;
