const LabelingJob = require('../../models/LabelingJob');
const LabeledImage = require('../../models/LabeledImage');
const { User } = require('../../models/User');
const { resolvePeriod, getPeriodLabels } = require('../../utils/analyticsDateRange');

function roundPercent(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function progressBucket(labeled, remaining, skipped) {
  const open = labeled + remaining;
  return {
    labeled,
    remaining,
    skipped,
    total: open + skipped,
    // Share of photos still intended for the dataset (skipped photos are out of the queue).
    percent: roundPercent(labeled, open),
  };
}

function displayName(user) {
  if (!user) return 'Unknown';
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || user.username || 'Unknown';
}

const ITEMS_REMAINING = {
  $and: [
    { $or: [{ category: { $exists: false } }, { category: null }] },
    { status: { $nin: ['labeled', 'skipped'] } },
  ],
};

const LOADS_REMAINING = {
  category: 'load',
  status: { $nin: ['labeled', 'skipped'] },
};

const UNEXPORTED = {
  $or: [{ exportedAt: null }, { exportedAt: { $exists: false } }],
};

async function getLabelingProgress({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });
  const range = { $gte: period.start, $lte: period.end };

  const [
    itemsLabeled,
    loadsLabeled,
    itemsRemaining,
    loadsRemaining,
    itemsSkipped,
    loadsSkipped,
    unexported,
    labeledInPeriod,
    skippedInPeriod,
    labeledByUser,
    skippedByUser,
  ] = await Promise.all([
    LabeledImage.countDocuments({ category: 'item' }),
    LabeledImage.countDocuments({ category: 'load' }),
    LabelingJob.countDocuments(ITEMS_REMAINING),
    LabelingJob.countDocuments(LOADS_REMAINING),
    LabelingJob.countDocuments({ status: 'skipped', category: { $ne: 'load' } }),
    LabelingJob.countDocuments({ status: 'skipped', category: 'load' }),
    LabeledImage.countDocuments(UNEXPORTED),
    LabeledImage.countDocuments({ labeledAt: range }),
    LabelingJob.countDocuments({ status: 'skipped', skippedAt: range }),
    LabeledImage.aggregate([
      { $match: { labeledAt: range } },
      {
        $group: {
          _id: '$labeledBy',
          labeled: { $sum: 1 },
          items: { $sum: { $cond: [{ $eq: ['$category', 'item'] }, 1, 0] } },
          loads: { $sum: { $cond: [{ $eq: ['$category', 'load'] }, 1, 0] } },
          boxes: { $sum: { $size: { $ifNull: ['$boxes', []] } } },
          lastLabeledAt: { $max: '$labeledAt' },
        },
      },
    ]),
    LabelingJob.aggregate([
      { $match: { status: 'skipped', skippedAt: range } },
      {
        $group: {
          _id: '$labeledBy',
          skipped: { $sum: 1 },
          lastSkippedAt: { $max: '$skippedAt' },
        },
      },
    ]),
  ]);

  const byUser = new Map();
  const touch = (id) => {
    const key = id ? String(id) : 'unknown';
    if (!byUser.has(key)) {
      byUser.set(key, {
        userId: id ? String(id) : null,
        labeled: 0,
        items: 0,
        loads: 0,
        boxes: 0,
        skipped: 0,
        lastActivityAt: null,
      });
    }
    return byUser.get(key);
  };

  for (const row of labeledByUser) {
    const entry = touch(row._id);
    entry.labeled = row.labeled;
    entry.items = row.items;
    entry.loads = row.loads;
    entry.boxes = row.boxes;
    entry.lastActivityAt = row.lastLabeledAt || null;
  }

  for (const row of skippedByUser) {
    const entry = touch(row._id);
    entry.skipped = row.skipped;
    const skippedAt = row.lastSkippedAt ? new Date(row.lastSkippedAt) : null;
    const labeledAt = entry.lastActivityAt ? new Date(entry.lastActivityAt) : null;
    if (skippedAt && (!labeledAt || skippedAt > labeledAt)) {
      entry.lastActivityAt = skippedAt;
    }
  }

  const userIds = [...byUser.values()].map((row) => row.userId).filter(Boolean);
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('username firstName lastName').lean()
    : [];
  const usersById = new Map(users.map((user) => [String(user._id), user]));

  const labelers = [...byUser.values()]
    .map((row) => ({
      userId: row.userId,
      name: displayName(row.userId ? usersById.get(row.userId) : null),
      labeled: row.labeled,
      items: row.items,
      loads: row.loads,
      boxes: row.boxes,
      skipped: row.skipped,
      sharePercent: roundPercent(row.labeled, labeledInPeriod),
      lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt).toISOString() : null,
    }))
    .sort((a, b) => b.labeled - a.labeled || b.skipped - a.skipped || a.name.localeCompare(b.name));

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    progress: {
      overall: progressBucket(
        itemsLabeled + loadsLabeled,
        itemsRemaining + loadsRemaining,
        itemsSkipped + loadsSkipped,
      ),
      items: progressBucket(itemsLabeled, itemsRemaining, itemsSkipped),
      loads: progressBucket(loadsLabeled, loadsRemaining, loadsSkipped),
      unexported,
      labeledInPeriod,
      skippedInPeriod,
    },
    labelers,
  };
}

module.exports = { getLabelingProgress };
