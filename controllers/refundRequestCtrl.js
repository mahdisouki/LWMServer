const RefundRequest = require('../models/RefundRequest');
const Task = require('../models/Task');
const PaymentHistory = require('../models/PaymentHistory');
const Notification = require('../models/Notification');
const { User } = require('../models/User');
const refundCtrl = require('./refundCtrl');

function senderDisplayName(user) {
  return (
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.username ||
    'Admin'
  );
}

async function notifyUsers(userIds, message, senderName, metadata = null) {
  const uniqueIds = [...new Set(userIds.map((id) => String(id)).filter(Boolean))];
  await Promise.all(
    uniqueIds.map((userId) =>
      Notification.create({
        userId,
        type: 'Refunds',
        message,
        senderName,
        metadata,
      }).catch((err) => {
        console.error('Refund notification failed:', err.message);
      }),
    ),
  );
}

async function getAvailableToRefund(taskId) {
  const paymentHistories = await PaymentHistory.find({ taskId, status: 'success' });
  if (paymentHistories.length > 0) {
    const totalPaid = paymentHistories.reduce((sum, ph) => sum + (ph.amount || 0), 0);
    const totalRefunded = paymentHistories.reduce(
      (sum, ph) => sum + (ph.refundedTotalGBP || 0),
      0,
    );
    return {
      available: totalPaid - totalRefunded,
      totalPaid,
      totalRefunded,
      source: 'paymentHistory',
    };
  }

  const task = await Task.findById(taskId);
  if (!task) return { available: 0, totalPaid: 0, totalRefunded: 0, source: 'none' };

  const isCash =
    task.paymentMethod === 'cash' ||
    task.paidAmount?.method === 'cash' ||
    task.remainingAmount?.method === 'cash';
  const isBankTransfer =
    task.paymentMethod === 'BankTransfer' ||
    task.paidAmount?.method === 'BankTransfer' ||
    task.remainingAmount?.method === 'BankTransfer';

  if (!isCash && !isBankTransfer) {
    return { available: 0, totalPaid: 0, totalRefunded: 0, source: 'none' };
  }

  const depositAmount = task.paidAmount?.amount || 0;
  const remainingPaymentAmount = task.remainingAmount?.amount || 0;
  const cashAmount = isCash ? task.cashReceived || 0 : 0;
  const totalPaid = Math.max(depositAmount + remainingPaymentAmount, cashAmount);
  const allHistories = await PaymentHistory.find({ taskId });
  const totalRefunded = allHistories.reduce(
    (sum, ph) => sum + (ph.refundedTotalGBP || 0),
    0,
  );
  return {
    available: totalPaid - totalRefunded,
    totalPaid,
    totalRefunded,
    source: isCash ? 'cash' : 'bank',
  };
}

exports.createRefundRequest = async (req, res) => {
  try {
    const { taskId, amount, reason } = req.body;
    const refundAmount = Number(amount);
    const note = String(reason || '').trim();

    if (!taskId || !refundAmount || refundAmount <= 0) {
      return res.status(400).json({ message: 'Task ID and a valid amount are required' });
    }
    if (!note) {
      return res.status(400).json({ message: 'Reason / note is required' });
    }

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    const { available, totalPaid, totalRefunded } = await getAvailableToRefund(taskId);
    if (available <= 0) {
      return res.status(400).json({ message: 'No refundable amount available for this task' });
    }
    if (refundAmount > available + 0.001) {
      return res.status(400).json({
        message: `Refund amount exceeds available amount. Total paid: £${totalPaid.toFixed(2)}, Already refunded: £${totalRefunded.toFixed(2)}, Available: £${available.toFixed(2)}`,
      });
    }

    const existingPending = await RefundRequest.findOne({
      taskId,
      status: 'pending',
    });
    if (existingPending) {
      return res.status(400).json({
        message: 'A pending refund request already exists for this task',
        requestId: existingPending._id,
      });
    }

    const request = await RefundRequest.create({
      taskId,
      requestedBy: req.user._id,
      amount: refundAmount,
      reason: note,
      status: 'pending',
    });

    const superAdmins = await User.find({
      roleType: 'Admin',
      isSuperAdmin: true,
      _id: { $ne: req.user._id },
    }).select('_id');

    const clientName =
      [task.firstName, task.lastName].filter(Boolean).join(' ') ||
      task.email ||
      'client';
    await notifyUsers(
      superAdmins.map((a) => a._id),
      `Refund request £${refundAmount.toFixed(2)} for order ${task.orderNumber || taskId} (${clientName})`,
      senderDisplayName(req.user),
      {
        refundRequestId: request._id,
        taskId: task._id,
        path: '/dashboard/refund-requests',
      },
    );

    const populated = await RefundRequest.findById(request._id)
      .populate('requestedBy', 'username firstName lastName email')
      .populate('taskId', 'orderNumber firstName lastName email phoneNumber totalPrice paymentStatus');

    return res.status(201).json({
      message: 'Refund request submitted for super admin approval',
      request: populated,
    });
  } catch (error) {
    console.error('createRefundRequest error:', error);
    return res.status(500).json({
      message: 'Failed to create refund request',
      error: error.message,
    });
  }
};

exports.listRefundRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status && ['pending', 'accepted', 'refused'].includes(String(status))) {
      filter.status = status;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      RefundRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('requestedBy', 'username firstName lastName email')
        .populate('reviewedBy', 'username firstName lastName email')
        .populate(
          'taskId',
          'orderNumber firstName lastName email phoneNumber totalPrice paymentStatus',
        ),
      RefundRequest.countDocuments(filter),
    ]);

    return res.json({
      items,
      total,
      page: pageNum,
      limit: limitNum,
      isSuperAdmin: Boolean(req.user?.isSuperAdmin),
    });
  } catch (error) {
    console.error('listRefundRequests error:', error);
    return res.status(500).json({
      message: 'Failed to list refund requests',
      error: error.message,
    });
  }
};

exports.getRefundRequest = async (req, res) => {
  try {
    const request = await RefundRequest.findById(req.params.id)
      .populate('requestedBy', 'username firstName lastName email')
      .populate('reviewedBy', 'username firstName lastName email')
      .populate(
        'taskId',
        'orderNumber firstName lastName email phoneNumber totalPrice paymentStatus',
      );
    if (!request) return res.status(404).json({ message: 'Refund request not found' });
    return res.json({ request, isSuperAdmin: Boolean(req.user?.isSuperAdmin) });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to get refund request',
      error: error.message,
    });
  }
};

exports.acceptRefundRequest = async (req, res) => {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ message: 'Only super admins can accept refund requests' });
    }

    const request = await RefundRequest.findById(req.params.id).populate('taskId');
    if (!request) return res.status(404).json({ message: 'Refund request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ message: `Request is already ${request.status}` });
    }

    const taskId = request.taskId?._id || request.taskId;
    let result = await refundCtrl.runRefundForTask(taskId, request.amount, req.user);

    const needsManual =
      result.status === 400 &&
      String(result.body?.message || '').toLowerCase().includes('manual');

    if (needsManual) {
      result = await refundCtrl.runManualRefundForTask(taskId, request.amount, req.user, {
        notes: `Approved refund request ${request._id}: ${request.reason}`,
      });
    }

    if (result.status < 200 || result.status >= 300) {
      return res.status(result.status || 500).json(
        result.body || { message: 'Failed to process refund' },
      );
    }

    request.status = 'accepted';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = String(req.body?.reviewNote || '').trim();
    await request.save();

    const orderLabel = request.taskId?.orderNumber || String(taskId);
    await notifyUsers(
      [request.requestedBy],
      `Your refund request of £${Number(request.amount).toFixed(2)} for order ${orderLabel} was accepted`,
      senderDisplayName(req.user),
      {
        refundRequestId: request._id,
        taskId,
        status: 'accepted',
        path: '/dashboard/refund-requests',
      },
    );

    const populated = await RefundRequest.findById(request._id)
      .populate('requestedBy', 'username firstName lastName email')
      .populate('reviewedBy', 'username firstName lastName email')
      .populate(
        'taskId',
        'orderNumber firstName lastName email phoneNumber totalPrice paymentStatus',
      );

    return res.json({
      message: 'Refund request accepted and refund processed',
      request: populated,
      refund: result.body,
    });
  } catch (error) {
    console.error('acceptRefundRequest error:', error);
    return res.status(500).json({
      message: 'Failed to accept refund request',
      error: error.message,
    });
  }
};

exports.refuseRefundRequest = async (req, res) => {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ message: 'Only super admins can refuse refund requests' });
    }

    const request = await RefundRequest.findById(req.params.id).populate(
      'taskId',
      'orderNumber',
    );
    if (!request) return res.status(404).json({ message: 'Refund request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ message: `Request is already ${request.status}` });
    }

    request.status = 'refused';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = String(req.body?.reviewNote || '').trim();
    await request.save();

    const orderLabel = request.taskId?.orderNumber || String(request.taskId);
    await notifyUsers(
      [request.requestedBy],
      `Your refund request of £${Number(request.amount).toFixed(2)} for order ${orderLabel} was refused${
        request.reviewNote ? `: ${request.reviewNote}` : ''
      }`,
      senderDisplayName(req.user),
      {
        refundRequestId: request._id,
        taskId: request.taskId?._id || request.taskId,
        status: 'refused',
        path: '/dashboard/refund-requests',
      },
    );

    const populated = await RefundRequest.findById(request._id)
      .populate('requestedBy', 'username firstName lastName email')
      .populate('reviewedBy', 'username firstName lastName email')
      .populate(
        'taskId',
        'orderNumber firstName lastName email phoneNumber totalPrice paymentStatus',
      );

    return res.json({
      message: 'Refund request refused',
      request: populated,
    });
  } catch (error) {
    console.error('refuseRefundRequest error:', error);
    return res.status(500).json({
      message: 'Failed to refuse refund request',
      error: error.message,
    });
  }
};
