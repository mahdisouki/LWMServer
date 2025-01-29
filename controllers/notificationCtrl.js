const Notification = require('../models/Notification');

const notificationController = {
  getUserNotifications: async (req, res) => {
    try {
      const userId = req.user._id; 

      const notifications = await Notification.find({ userId }).sort({ createdAt: -1 });

      res.status(200).json({
        message: 'Notifications retrieved successfully',
        notifications,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve notifications',
        error: error.message,
      });
    }
  },
};

module.exports = notificationController;