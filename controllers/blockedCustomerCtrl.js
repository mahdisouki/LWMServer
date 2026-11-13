const BlockedCustomer = require('../models/BlockedCustomer');
const Task = require('../models/Task');
const loggingService = require('../services/loggingService');
const {
  identityFrom,
  hasIdentity,
  labelsFromIdentity,
  customerName,
  findActiveBlock,
} = require('../services/blockedCustomerService');

function uniquePhones(phones) {
  return [...new Set((phones || []).filter(Boolean))];
}

const blockedCustomerCtrl = {
  checkBlockedCustomer: async (req, res) => {
    try {
      const match = await findActiveBlock({
        email: req.body.email,
        phoneNumber: req.body.phoneNumber,
        phoneNumber2: req.body.phoneNumber2,
        collectionAddress: req.body.collectionAddress,
      });
      if (!match) {
        return res.status(200).json({ blocked: false });
      }
      res.status(200).json({
        blocked: true,
        reason: match.block.reason || '',
        matchedOn: match.matchedOn,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to check blocked customer', error: error.message });
    }
  },

  listBlockedCustomers: async (req, res) => {
    try {
    const active = req.query.active;
    const keyword = String(req.query.keyword || '').trim();
    const filter = {};
    if (active === 'false') {
      filter.active = false;
    } else if (active !== 'all') {
      filter.active = true;
    }
    if (keyword) {
      const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { email: pattern },
        { customerName: pattern },
        { collectionAddressNormalized: pattern },
        { phones: pattern },
        { reason: pattern },
      ];
    }
    const blockedCustomers = await BlockedCustomer.find(filter).sort({ createdAt: -1 }).limit(200);
    res.status(200).json({
      message: 'Blocked customers retrieved successfully',
      blockedCustomers,
    });
    } catch (error) {
      res.status(500).json({ message: 'Failed to retrieve blocked customers', error: error.message });
    }
  },

  blockFromTask: async (req, res) => {
    try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ message: 'A reason is required' });
    }

    const task = await Task.findById(req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const identity = identityFrom(task);
    if (!hasIdentity(identity)) {
      return res.status(400).json({
        message: 'This order has no email, phone, or collection address to block',
      });
    }

    const ors = [];
    if (identity.email) ors.push({ email: identity.email, active: true });
    if (identity.phones.length) ors.push({ phones: { $in: identity.phones }, active: true });
    if (identity.address) {
      ors.push({ collectionAddressNormalized: identity.address, active: true });
    }
    const matches = await BlockedCustomer.find({ $or: ors }).sort({ createdAt: 1 });

    let block = matches[0] || null;
    if (!block) {
      block = await BlockedCustomer.create({
        email: identity.email,
        phones: identity.phones,
        collectionAddressNormalized: identity.address,
        customerName: customerName(task),
        reason,
        blockedBy: req.user._id,
        sourceTaskId: task._id,
        active: true,
      });
    } else {
      if (identity.email) block.email = identity.email;
      if (identity.address) block.collectionAddressNormalized = identity.address;
      block.phones = uniquePhones([...(block.phones || []), ...identity.phones]);
      block.customerName = customerName(task);
      block.reason = reason;
      block.blockedBy = req.user._id;
      block.sourceTaskId = task._id;
      for (const extra of matches.slice(1)) {
        if (extra.email && !block.email) block.email = extra.email;
        if (extra.collectionAddressNormalized && !block.collectionAddressNormalized) {
          block.collectionAddressNormalized = extra.collectionAddressNormalized;
        }
        block.phones = uniquePhones([...(block.phones || []), ...(extra.phones || [])]);
        extra.active = false;
        extra.unblockedBy = req.user._id;
        extra.unblockedAt = new Date();
        await extra.save();
        await Task.updateMany(
          { blockedCustomerId: extra._id },
          { $set: { blockedCustomerId: block._id, blockedReason: reason } },
        );
      }
      await block.save();
    }

    task.blockedCustomer = true;
    task.blockedMatchOn = labelsFromIdentity(identity);
    task.blockedReason = reason;
    task.blockedCustomerId = block._id;
    await task.save();

    await loggingService.createLog({
      userId: req.user._id,
      username: req.user.username,
      action: 'UPDATE',
      entityType: 'TASK',
      entityId: task._id,
      changes: {
        blockedCustomer: true,
        blockedMatchOn: task.blockedMatchOn,
        reason,
        blockedCustomerId: block._id,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(200).json({
      message: 'Customer blocked',
      blockedCustomer: block,
      task,
    });
    } catch (error) {
      res.status(500).json({ message: 'Failed to block customer', error: error.message });
    }
  },

  unblockCustomer: async (req, res) => {
    try {
    const block = await BlockedCustomer.findById(req.params.id);
    if (!block) {
      return res.status(404).json({ message: 'Blocked customer not found' });
    }
    if (!block.active) {
      return res.status(400).json({ message: 'Customer is already unblocked' });
    }

    block.active = false;
    block.unblockedBy = req.user._id;
    block.unblockedAt = new Date();
    await block.save();

    await Task.updateMany(
      { blockedCustomerId: block._id },
      { $set: { blockedCustomer: false, blockedMatchOn: [], blockedReason: '' } },
    );

    await loggingService.createLog({
      userId: req.user._id,
      username: req.user.username,
      action: 'UPDATE',
      entityType: 'TASK',
      entityId: block.sourceTaskId,
      changes: {
        blockedCustomer: false,
        blockedCustomerId: block._id,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(200).json({
      message: 'Customer unblocked',
      blockedCustomer: block,
    });
    } catch (error) {
      res.status(500).json({ message: 'Failed to unblock customer', error: error.message });
    }
  },
};

module.exports = blockedCustomerCtrl;
