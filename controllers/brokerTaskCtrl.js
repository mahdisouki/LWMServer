const BrokerTask = require('../models/BrokerTask');
const BrokerLead = require('../models/BrokerLead');
const { TASK_STATUSES, TASK_TYPES } = require('../models/BrokerTask');
const { resolveBrokerIdForUser } = require('../utils/brokerScope');

const { escapeRegex, pushActivity, nextReferenceCode } = require('../utils/brokerHelpers');

function buildFilter(brokerId, query = {}) {
  const filter = { brokerId };
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.type && query.type !== 'all') filter.type = query.type;
  if (query.leadId) filter.leadId = query.leadId;
  if (query.overdue === 'true' || query.overdue === true) {
    filter.dueAt = { $lt: new Date(), $ne: null };
    filter.status = { $in: ['Pending', 'InProgress'] };
  }
  if (query.keyword && String(query.keyword).trim()) {
    const regex = new RegExp(escapeRegex(String(query.keyword).trim()), 'i');
    filter.$or = [{ title: regex }, { companyName: regex }, { referenceCode: regex }];
  }
  return filter;
}

const brokerTaskCtrl = {
  listByBroker: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }
      const items = await BrokerTask.find(buildFilter(brokerId, req.query))
        .sort({ dueAt: 1, updatedAt: -1 })
        .lean();
      return res.json({
        success: true,
        data: items.map((t) => ({ ...t, id: t._id })),
      });
    } catch (error) {
      console.error('listByBroker tasks error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  create: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id || req.body.brokerId;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }

      const {
        leadId,
        quoteRequestId,
        negotiationId,
        orderId,
        contactId,
        title,
        companyName,
        type,
        status,
        priority,
        dueAt,
        notes,
      } = req.body;

      if (!leadId) {
        return res.status(400).json({ success: false, message: 'leadId is required' });
      }
      if (!title || !String(title).trim()) {
        return res.status(400).json({ success: false, message: 'title is required' });
      }

      const lead = await BrokerLead.findOne({ _id: leadId, brokerId });
      if (!lead) {
        return res.status(404).json({ success: false, message: 'Lead not found for this broker' });
      }

      const actorName = req.user?.username || req.user?.firstName || 'User';
      const referenceCode = await nextReferenceCode(BrokerTask, 'TSK');
      const initialStatus = status && TASK_STATUSES.includes(status) ? status : 'Pending';
      const initialType = type && TASK_TYPES.includes(type) ? type : 'General';

      const task = await BrokerTask.create({
        brokerId,
        leadId,
        quoteRequestId: quoteRequestId || null,
        negotiationId: negotiationId || null,
        orderId: orderId || null,
        contactId: contactId || null,
        referenceCode,
        title: String(title).trim(),
        companyName: companyName || lead.companyName,
        type: initialType,
        status: initialStatus,
        priority: priority || 'Medium',
        dueAt: dueAt ? new Date(dueAt) : null,
        completedAt: initialStatus === 'Completed' ? new Date() : null,
        notes: notes || '',
        activityLog: [
          {
            action: 'Task created',
            detail: referenceCode,
            actorName,
            createdAt: new Date(),
          },
        ],
      });

      if (!lead.activityLog) lead.activityLog = [];
      lead.activityLog.unshift({
        action: 'Task created',
        detail: `${referenceCode}: ${task.title}`,
        actorName,
        createdAt: new Date(),
      });
      await lead.save();

      return res.status(201).json({
        success: true,
        data: { ...task.toObject(), id: task._id },
      });
    } catch (error) {
      console.error('create task error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  update: async (req, res) => {
    try {
      const task = await BrokerTask.findById(req.params.taskId);
      if (!task) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }

      const allowed = [
        'title',
        'companyName',
        'type',
        'status',
        'priority',
        'dueAt',
        'notes',
        'quoteRequestId',
        'negotiationId',
        'orderId',
        'contactId',
      ];
      const actorName = req.user?.username || req.user?.firstName || 'User';
      const changes = [];

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          if (key === 'status' && !TASK_STATUSES.includes(req.body[key])) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
          }
          if (key === 'type' && !TASK_TYPES.includes(req.body[key])) {
            return res.status(400).json({ success: false, message: 'Invalid type' });
          }
          if (key === 'dueAt') {
            task[key] = req.body[key] ? new Date(req.body[key]) : null;
          } else {
            task[key] = req.body[key];
          }
          changes.push(key);
        }
      }

      if (req.body.status === 'Completed' && !task.completedAt) {
        task.completedAt = new Date();
      }
      if (req.body.status && req.body.status !== 'Completed') {
        task.completedAt = null;
      }

      if (changes.length) {
        pushActivity(task, 'Task updated', changes.join(', '), actorName);
      }

      await task.save();

      return res.json({ success: true, data: { ...task.toObject(), id: task._id } });
    } catch (error) {
      console.error('update task error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  listMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      req.params.id = String(brokerId);
      return brokerTaskCtrl.listByBroker(req, res);
    } catch (error) {
      console.error('listMine tasks error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  createMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      req.params.brokerId = String(brokerId);
      return brokerTaskCtrl.create(req, res);
    } catch (error) {
      console.error('createMine task error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  updateMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      const task = await BrokerTask.findById(req.params.taskId);
      if (!task || String(task.brokerId) !== String(brokerId)) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }
      return brokerTaskCtrl.update(req, res);
    } catch (error) {
      console.error('updateMine task error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = brokerTaskCtrl;
