const ClaritySnapshot = require('../../models/ClaritySnapshot');
const { SNAPSHOT_TYPES } = require('../../models/ClaritySnapshot');
const { isClarityEnabled } = require('../../config/clarityConfig');
const clarityService = require('./clarityService');

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

const SNAPSHOT_FETCHERS = [
  { snapshotType: 'overview', fetch: () => clarityService.getOverview(1) },
  { snapshotType: 'top_pages', fetch: () => clarityService.getTopPages(1) },
  { snapshotType: 'traffic_sources', fetch: () => clarityService.getTrafficSources(1) },
  { snapshotType: 'devices', fetch: () => clarityService.getDeviceBreakdown(1) },
];

async function syncDailySnapshots({ snapshotDate = new Date() } = {}) {
  if (!isClarityEnabled()) {
    throw new Error('Clarity is not configured');
  }

  const dayStart = startOfUtcDay(snapshotDate);
  const fetchedAt = new Date();
  const results = [];

  for (const { snapshotType, fetch } of SNAPSHOT_FETCHERS) {
    const data = await fetch();
    const doc = await ClaritySnapshot.findOneAndUpdate(
      { snapshotType, snapshotDate: dayStart },
      { data, numOfDays: 1, fetchedAt },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    results.push({
      snapshotType,
      snapshotDate: dayStart,
      id: doc._id.toString(),
    });
  }

  return {
    snapshotDate: dayStart,
    synced: results.length,
    snapshots: results,
  };
}

async function getSnapshotHistory({
  startDate,
  endDate,
  snapshotType,
  page = 1,
  limit = 30,
} = {}) {
  const filter = {};

  if (snapshotType) {
    if (!SNAPSHOT_TYPES.includes(snapshotType)) {
      throw new Error(`snapshotType must be one of: ${SNAPSHOT_TYPES.join(', ')}`);
    }
    filter.snapshotType = snapshotType;
  }

  if (startDate || endDate) {
    filter.snapshotDate = {};
    if (startDate) {
      const start = startOfUtcDay(new Date(startDate));
      if (Number.isNaN(start.getTime())) {
        throw new Error('Invalid startDate');
      }
      filter.snapshotDate.$gte = start;
    }
    if (endDate) {
      const end = endOfUtcDay(new Date(endDate));
      if (Number.isNaN(end.getTime())) {
        throw new Error('Invalid endDate');
      }
      filter.snapshotDate.$lte = end;
    }
  }

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const [total, rows] = await Promise.all([
    ClaritySnapshot.countDocuments(filter),
    ClaritySnapshot.find(filter)
      .sort({ snapshotDate: -1, snapshotType: 1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);

  return {
    data: rows.map((row) => ({
      id: row._id.toString(),
      snapshotType: row.snapshotType,
      snapshotDate: row.snapshotDate,
      numOfDays: row.numOfDays,
      data: row.data,
      fetchedAt: row.fetchedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 0,
    },
  };
}

module.exports = {
  syncDailySnapshots,
  getSnapshotHistory,
  SNAPSHOT_TYPES,
};
