const mongoose = require('mongoose');
const Tick = require('../models/Tick');
const Task = require('../models/Task');

const USER_SELECT = 'firstName lastName email username';

const TICK_LIST_SEARCH_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'username',
  'phoneNumber',
  'postcode',
  'orderNumber',
];

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function prefixTaskFilter(filter) {
  const prefixed = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$or') {
      prefixed.$or = value.map((clause) =>
        Object.fromEntries(
          Object.entries(clause).map(([k, v]) => [`task.${k}`, v])
        )
      );
    } else {
      prefixed[`task.${key}`] = value;
    }
  }
  return prefixed;
}

function buildTaskSearchMatch(keyword) {
  const trimmed = String(keyword || '').trim();
  if (!trimmed || TICK_LIST_SEARCH_FIELDS.length === 0) return null;

  const keywordParts = trimmed.split(/\s+/);
  const hasFirstName = TICK_LIST_SEARCH_FIELDS.includes('firstName');
  const hasLastName = TICK_LIST_SEARCH_FIELDS.includes('lastName');
  const taskField = (field) => `task.${field}`;

  let orConditions;

  if (hasFirstName && hasLastName && keywordParts.length >= 2) {
    orConditions = TICK_LIST_SEARCH_FIELDS.filter(
      (field) => field !== 'firstName' && field !== 'lastName'
    ).map((field) => ({
      [taskField(field)]: { $regex: trimmed, $options: 'i' },
    }));

    orConditions.push(
      {
        $and: [
          { [taskField('firstName')]: { $regex: keywordParts[0], $options: 'i' } },
          {
            [taskField('lastName')]: {
              $regex: keywordParts.slice(1).join(' '),
              $options: 'i',
            },
          },
        ],
      },
      {
        $and: [
          {
            [taskField('firstName')]: {
              $regex: keywordParts.slice(1).join(' '),
              $options: 'i',
            },
          },
          { [taskField('lastName')]: { $regex: keywordParts[0], $options: 'i' } },
        ],
      }
    );
  } else {
    orConditions = TICK_LIST_SEARCH_FIELDS.map((field) => ({
      [taskField(field)]: { $regex: trimmed, $options: 'i' },
    }));
  }

  return { $or: orConditions };
}

function buildTaskMatchForFilter(paymentFilter) {
  const completed = { 'task.taskStatus': 'Completed' };
  if (paymentFilter === 'unpaid') {
    return { ...completed, 'task.paymentStatus': 'Unpaid' };
  }
  if (paymentFilter === 'partial_remaining') {
    return {
      ...completed,
      'task.paymentStatus': 'partial_Paid',
      'task.remainingAmount.status': 'Not_Paid',
    };
  }
  return prefixTaskFilter(Tick.eligibleTaskFilter);
}

function mapOrderRow(tick) {
  const taskDoc = tick.task ?? tick.taskId;
  if (!taskDoc) return null;

  const task = taskDoc.toObject ? taskDoc.toObject() : taskDoc;
  const isPartialRemaining = task.paymentStatus === 'partial_Paid';

  return {
    tickId: tick._id,
    note: tick.note || '',
    noteUpdatedAt: tick.updatedAt,
    lastModifiedBy: tick.lastModifiedBy,
    paymentCategory: isPartialRemaining ? 'partial_remaining' : 'unpaid',
    remainingUnpaid: isPartialRemaining
      ? Number(task.remainingAmount?.amount) || 0
      : Number(task.totalPrice) || 0,
    ...task,
    _id: task._id,
  };
}

async function computeStats() {
  const [result] = await Task.aggregate([
    { $match: Tick.eligibleTaskFilter },
    {
      $group: {
        _id: null,
        fullUnpaidJobs: {
          $sum: {
            $cond: [{ $eq: ['$paymentStatus', 'Unpaid'] }, 1, 0],
          },
        },
        fullUnpaidAmount: {
          $sum: {
            $cond: [
              { $eq: ['$paymentStatus', 'Unpaid'] },
              { $ifNull: ['$totalPrice', 0] },
              0,
            ],
          },
        },
        remainingUnpaidJobs: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$paymentStatus', 'partial_Paid'] },
                  { $eq: ['$remainingAmount.status', 'Not_Paid'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        remainingUnpaidAmount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$paymentStatus', 'partial_Paid'] },
                  { $eq: ['$remainingAmount.status', 'Not_Paid'] },
                ],
              },
              { $ifNull: ['$remainingAmount.amount', 0] },
              0,
            ],
          },
        },
      },
    },
  ]);

  const fullUnpaidJobs = result?.fullUnpaidJobs || 0;
  const fullUnpaidAmount = Math.round((result?.fullUnpaidAmount || 0) * 100) / 100;
  const remainingUnpaidJobs = result?.remainingUnpaidJobs || 0;
  const remainingUnpaidAmount =
    Math.round((result?.remainingUnpaidAmount || 0) * 100) / 100;

  return {
    fullUnpaid: { jobs: fullUnpaidJobs, amount: fullUnpaidAmount },
    remainingUnpaid: { jobs: remainingUnpaidJobs, amount: remainingUnpaidAmount },
    totalJobs: fullUnpaidJobs + remainingUnpaidJobs,
    totalOutstandingAmount:
      Math.round((fullUnpaidAmount + remainingUnpaidAmount) * 100) / 100,
  };
}

const tickCtrl = {
  getTickList: async (req, res) => {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const paymentFilter = String(req.query.filter || 'all').toLowerCase();

      if (!['all', 'unpaid', 'partial_remaining'].includes(paymentFilter)) {
        return res.status(400).json({
          message: 'filter must be one of: all, unpaid, partial_remaining',
        });
      }

      await Tick.syncFromEligibleTasks();

      const taskMatch = buildTaskMatchForFilter(paymentFilter);
      const searchMatch = buildTaskSearchMatch(req.query.keyword);
      const combinedMatch = searchMatch
        ? { $and: [taskMatch, searchMatch] }
        : taskMatch;

      const [stats, aggregation] = await Promise.all([
        computeStats(),
        Tick.aggregate([
          {
            $lookup: {
              from: 'tasks',
              localField: 'taskId',
              foreignField: '_id',
              as: 'task',
            },
          },
          { $unwind: '$task' },
          { $match: combinedMatch },
          { $sort: { 'task.date': -1 } },
          {
            $facet: {
              metadata: [{ $count: 'total' }],
              data: [{ $skip: skip }, { $limit: limit }],
            },
          },
        ]),
      ]);

      const facet = aggregation[0] || { metadata: [], data: [] };
      const total = facet.metadata[0]?.total || 0;
      const tickIds = facet.data.map((t) => t._id);

      const ticks = await Tick.find({ _id: { $in: tickIds } })
        .populate('taskId')
        .populate('lastModifiedBy', USER_SELECT);

      const tickById = new Map(
        ticks.map((t) => [
          t._id.toString(),
          { ...t.toObject(), task: t.taskId },
        ])
      );

      const orders = tickIds
        .map((id) => mapOrderRow(tickById.get(id.toString())))
        .filter(Boolean);

      res.status(200).json({
        message: 'Tick list retrieved successfully.',
        stats,
        filter: paymentFilter,
        keyword: req.query.keyword?.trim() || '',
        orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 0,
        },
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve tick list.',
        error: error.message,
      });
    }
  },

  updateTaskNote: async (req, res) => {
    try {
      const { taskId } = req.params;
      const { note } = req.body;

      if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return res.status(400).json({ message: 'Invalid task ID.' });
      }

      if (note === undefined || note === null) {
        return res.status(400).json({ message: 'note is required.' });
      }

      const task = await Task.findOne({
        _id: taskId,
        ...Tick.eligibleTaskFilter,
      }).select('_id');

      if (!task) {
        return res.status(404).json({
          message:
            'Task not found or not eligible (completed, unpaid or partially paid with remaining balance).',
        });
      }

      const tick = await Tick.findOneAndUpdate(
        { taskId },
        {
          note: String(note).trim(),
          lastModifiedBy: req.user._id,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
        .populate('taskId')
        .populate('lastModifiedBy', USER_SELECT);

      const order = mapOrderRow(tick);

      res.status(200).json({
        message: 'Tick note updated successfully.',
        tick,
        order,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update tick note.',
        error: error.message,
      });
    }
  },
};

module.exports = tickCtrl;
