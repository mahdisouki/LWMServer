const { getOnlineUsers, isUserOnline, getUsersPresence } = require('../socket');

const presenceCtrl = {
  getOnlineUsers: async (req, res) => {
    try {
      const onlineUserIds = getOnlineUsers();
      return res.status(200).json({
        message: 'Online users retrieved successfully',
        onlineUserIds,
        count: onlineUserIds.length,
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to retrieve online users',
        error: error.message,
      });
    }
  },

  getUserPresence: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
      }

      const online = isUserOnline(userId);
      return res.status(200).json({
        userId,
        status: online ? 'online' : 'offline',
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to retrieve user presence',
        error: error.message,
      });
    }
  },

  getBulkPresence: async (req, res) => {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          message: 'userIds must be a non-empty array',
        });
      }

      const presence = getUsersPresence(userIds);
      return res.status(200).json({
        message: 'User presence retrieved successfully',
        presence,
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to retrieve user presence',
        error: error.message,
      });
    }
  },
};

module.exports = presenceCtrl;
