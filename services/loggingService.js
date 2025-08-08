const SystemLog = require('../models/SystemLog');
const StandardItem = require('../models/StandardItem');
async function enrichLogsWithItemNames(logs) {
  // Collect all unique standardItemIds
  const itemIds = new Set();
  logs.forEach(log => {
    ['before', 'after'].forEach(when => {
      log.changes?.[when]?.items?.forEach(item => {
        if (item.standardItemId) itemIds.add(item.standardItemId.toString());
      });
    });
  });

  // Fetch StandardItems (if any IDs found)
  const standardItems = itemIds.size
    ? await StandardItem.find({ _id: { $in: Array.from(itemIds) } }).select('_id itemName')
    : [];
  const itemMap = {};
  standardItems.forEach(item => {
    itemMap[item._id.toString()] = item;
  });

  // Attach the itemName in place of standardItemId
  logs.forEach(log => {
    ['before', 'after'].forEach(when => {
      log.changes?.[when]?.items?.forEach(item => {
        if (item.standardItemId && itemMap[item.standardItemId.toString()]) {
          // Replace just with name, or with the whole object if you want
          item.standardItemName = itemMap[item.standardItemId.toString()].itemName;
          // Or, to replace the id with the whole item object:
          // item.standardItemId = itemMap[item.standardItemId.toString()];
        }
      });
    });
  });
}
const loggingService = {
  async createLog({
    userId,
    username,
    action,
    entityType,
    entityId,
    changes = {},
    ipAddress,
    userAgent
  }) {
    try {
      const log = new SystemLog({
        userId,
        username,
        action,
        entityType,
        entityId,
        changes,
        ipAddress,
        userAgent
      });

      await log.save();
      return log;
    } catch (error) {
      console.error('Error creating system log:', error);
      throw error;
    }
  },

  async getLogs(filters = {}, page = 1, limit = 10) {
    try {
      const query = {};

      // Apply filters
      if (filters.userId) query.userId = filters.userId;
      if (filters.action) query.action = filters.action;
      if (filters.entityType) query.entityType = filters.entityType;
      if (filters.entityId) query.entityId = filters.entityId;
      if (filters.startDate && filters.endDate) {
        query.timestamp = {
          $gte: new Date(filters.startDate),
          $lte: new Date(filters.endDate)
        };
      }

      const logs = await SystemLog.find(query)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'username email');

      await enrichLogsWithItemNames(logs);

      const total = await SystemLog.countDocuments(query);

      return {
        logs,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      console.error('Error retrieving system logs:', error);
      throw error;
    }
  },

  async getLogsByEntity(entityType, entityId, page = 1, limit = 10) {
    try {
      const logs = await SystemLog.find({ entityType, entityId })
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'username email');
      await enrichLogsWithItemNames(logs);

      const total = await SystemLog.countDocuments({ entityType, entityId });

      return {
        logs,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      console.error('Error retrieving entity logs:', error);
      throw error;
    }
  }
};

module.exports = loggingService; 