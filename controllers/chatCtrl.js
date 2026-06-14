const Truck = require('../models/Truck');
const { buildChatTrucksPayload } = require('../utils/chatMessageHelpers');

const chatCtrl = {
  getChatStats: async (req, res) => {
    try {
      const userId = req.user._id || req.user.id;
      const trucks = await Truck.find().select('_id');
      const roomIds = trucks.map((truck) => String(truck._id));

      const { stats } = await buildChatTrucksPayload(trucks, userId);

      return res.status(200).json({
        message: 'Chat stats retrieved successfully',
        stats,
        roomCount: roomIds.length,
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to retrieve chat stats',
        error: error.message,
      });
    }
  },

  getRoomUnreadCount: async (req, res) => {
    try {
      const userId = req.user._id || req.user.id;
      const { roomId } = req.params;

      if (!roomId) {
        return res.status(400).json({ message: 'roomId is required' });
      }

      const { getRoomUnreadCount } = require('../utils/chatMessageHelpers');
      const unreadCount = await getRoomUnreadCount(roomId, userId);

      return res.status(200).json({
        roomId,
        unreadCount,
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to retrieve room unread count',
        error: error.message,
      });
    }
  },
};

module.exports = chatCtrl;
