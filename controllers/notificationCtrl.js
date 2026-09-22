const Notification = require('../models/Notification');
const AdditionalItemRequest = require('../models/AdditionalItemRequest');

function mapQuoteDecisionFromStatus(status) {
  if (status === 'accepted') return 'accepted';
  if (status === 'declined') return 'declined';
  return null;
}

const notificationController = {
  getUserNotifications: async (req, res) => {
    try {
      const userId = req.user._id; 

      const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).lean();

      const quoteNotificationRequestIds = notifications
        .filter((notification) => {
          const metadataType = notification?.metadata?.type;
          return (
            metadataType === 'additional_item_quote_submitted' ||
            metadataType === 'additional item quote submitted'
          ) && notification?.metadata?.requestId;
        })
        .map((notification) => notification.metadata.requestId);

      const uniqueRequestIds = [...new Set(quoteNotificationRequestIds)];
      const requestDecisionMap = new Map();
      if (uniqueRequestIds.length) {
        const requests = await AdditionalItemRequest.find({
          _id: { $in: uniqueRequestIds },
        })
          .select('_id status')
          .lean();
        requests.forEach((request) => {
          requestDecisionMap.set(
            String(request._id),
            mapQuoteDecisionFromStatus(request.status),
          );
        });
      }

      const hydratedNotifications = notifications.map((notification) => {
        const metadata = notification?.metadata && typeof notification.metadata === 'object'
          ? { ...notification.metadata }
          : null;
        if (!metadata) return notification;

        const isQuoteNotification =
          metadata.type === 'additional_item_quote_submitted' ||
          metadata.type === 'additional item quote submitted';
        if (!isQuoteNotification || !metadata.requestId) return notification;

        const quoteDecision =
          requestDecisionMap.get(String(metadata.requestId)) ?? null;

        return {
          ...notification,
          metadata: {
            ...metadata,
            quoteDecision,
          },
        };
      });

      res.status(200).json({
        message: 'Notifications retrieved successfully',
        notifications: hydratedNotifications,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve notifications',
        error: error.message,
      });
    }
  },

  markAllAsRead: async (req, res) => {
    try {
      const result = await Notification.updateMany(
        { userId: req.user._id, read: false },
        { $set: { read: true } },
      );

      res.status(200).json({
        message: 'Notifications marked as read',
        updated: result.modifiedCount || 0,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to mark notifications as read',
        error: error.message,
      });
    }
  },
};

module.exports = notificationController;