const SystemLog = require('../models/SystemLog');
const StandardItem = require('../models/StandardItem');
const Task = require('../models/Task');

async function enrichLogsWithTasks(logs) {
  // Collect all unique orderNumbers from logs (from changes field)
  const orderNumbers = new Set();
  logs.forEach(log => {
    // Check changes field for orderNumber
    if (log.changes?.created?.orderNumber) {
      orderNumbers.add(log.changes.created.orderNumber);
    }
    if (log.changes?.after?.orderNumber) {
      orderNumbers.add(log.changes.after.orderNumber);
    }
    if (log.changes?.before?.orderNumber) {
      orderNumbers.add(log.changes.before.orderNumber);
    }
  });

  // Fetch Tasks by orderNumber (if any orderNumbers found)
  const tasks = orderNumbers.size
    ? await Task.find({ orderNumber: { $in: Array.from(orderNumbers) } })
      .populate('createdBy', 'email name')
      .populate('couponId', 'code percentage discountType validFrom validTo maxUses currentUses')
      .lean()
    : [];

  const taskMap = {};
  tasks.forEach(task => {
    if (task.orderNumber) {
      taskMap[task.orderNumber] = task;
    }
  });

  // Attach task data to logs
  logs.forEach(log => {
    const orderNumber = log.changes?.created?.orderNumber ||
      log.changes?.after?.orderNumber ||
      log.changes?.before?.orderNumber;

    if (orderNumber && taskMap[orderNumber]) {
      log.task = taskMap[orderNumber];
    }
  });
}

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

      // Search by orderNumber in changes field
      if (filters.orderNumber) {
        query.$or = [
          { 'changes.created.orderNumber': { $regex: filters.orderNumber, $options: 'i' } },
          { 'changes.after.orderNumber': { $regex: filters.orderNumber, $options: 'i' } },
          { 'changes.before.orderNumber': { $regex: filters.orderNumber, $options: 'i' } }
        ];
      }

      const logs = await SystemLog.find(query)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'username email');

      await enrichLogsWithItemNames(logs);
      await enrichLogsWithTasks(logs);

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
      await enrichLogsWithTasks(logs);

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