const Task = require('../../models/Task');
const { isGa4Enabled } = require('../../config/ga4Config');
const {
  dayKeyInTimeZone,
  addDaysToDayKey,
  ANALYTICS_TIMEZONE,
} = require('../../utils/analyticsDateRange');
const {
  TRAFFIC_SOURCES,
  mapGa4ChannelToTrafficSource,
  canApplyGa4TrafficSource,
} = require('../../utils/trafficSource');
const { excludeMigratedOrdersFilter } = require('./taskFilters');
const { fetchPurchasesByTransaction } = require('./ga4Service');

/** Look back far enough for GA4 processing delay + late thank-you hits. */
const DEFAULT_LOOKBACK_DAYS = Math.min(
  Math.max(parseInt(process.env.GA4_ORDER_TRAFFIC_LOOKBACK_DAYS, 10) || 14, 1),
  90,
);

function resolveLookbackRange(lookbackDays = DEFAULT_LOOKBACK_DAYS) {
  const todayKey = dayKeyInTimeZone(new Date(), ANALYTICS_TIMEZONE);
  // Exclude "today" end partially — still include today for same-day matches.
  const endKey = todayKey;
  const startKey = addDaysToDayKey(todayKey, -(lookbackDays - 1));
  return { startKey, endKey, lookbackDays };
}

function startOfUtcDayFromKey(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/**
 * Match GA4 purchase transactionId → Task.orderNumber and stamp Direct
 * onto Organic public orders when GA4 session channel is Direct.
 */
async function syncGa4OrderTrafficSources({
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  dryRun = false,
} = {}) {
  if (!isGa4Enabled()) {
    return {
      skipped: true,
      reason: 'GA4_DISABLED',
      updated: 0,
      matched: 0,
      candidates: 0,
    };
  }

  const { startKey, endKey } = resolveLookbackRange(lookbackDays);
  const ga4 = await fetchPurchasesByTransaction({ startKey, endKey });

  if (!ga4?.available) {
    return {
      skipped: true,
      reason: 'GA4_UNAVAILABLE',
      startKey,
      endKey,
      updated: 0,
      matched: 0,
      candidates: 0,
    };
  }

  // Broaden Mongo window slightly vs GA4 keys (timezone edge + lag).
  const createdAfter = new Date(
    startOfUtcDayFromKey(startKey).getTime() - 2 * 24 * 60 * 60 * 1000,
  );

  const candidates = await Task.find({
    createdAt: { $gte: createdAfter },
    paymentStatus: { $ne: 'Failed' },
    createdByType: 'public',
    orderNumber: { $exists: true, $nin: [null, ''] },
    $or: [
      { trafficSource: TRAFFIC_SOURCES.ORGANIC },
      { trafficSource: { $exists: false } },
      { trafficSource: null },
    ],
    ...excludeMigratedOrdersFilter,
  })
    .select('_id orderNumber trafficSource ga4SessionChannel')
    .lean();

  const summary = {
    skipped: false,
    dryRun,
    startKey,
    endKey,
    lookbackDays,
    ga4PurchaseRows: ga4.rows.length,
    candidates: candidates.length,
    matched: 0,
    updated: 0,
    alreadyDirect: 0,
    noGa4Row: 0,
    channelNotDirect: 0,
    errors: 0,
    samples: [],
  };

  const syncedAt = new Date();

  for (const task of candidates) {
    const orderKey = String(task.orderNumber).trim();
    const ga4Row = ga4.byTransactionId.get(orderKey);
    if (!ga4Row) {
      summary.noGa4Row += 1;
      continue;
    }

    summary.matched += 1;
    const mapped = mapGa4ChannelToTrafficSource(ga4Row.channel);

    if (!canApplyGa4TrafficSource(task.trafficSource, mapped)) {
      summary.channelNotDirect += 1;
      continue;
    }

    if (summary.samples.length < 20) {
      summary.samples.push({
        orderNumber: orderKey,
        from: task.trafficSource || null,
        to: mapped,
        ga4Channel: ga4Row.channel,
      });
    }

    if (dryRun) {
      summary.updated += 1;
      continue;
    }

    try {
      const result = await Task.updateOne(
        {
          _id: task._id,
          createdByType: 'public',
          $or: [
            { trafficSource: TRAFFIC_SOURCES.ORGANIC },
            { trafficSource: { $exists: false } },
            { trafficSource: null },
          ],
        },
        {
          $set: {
            trafficSource: TRAFFIC_SOURCES.DIRECT,
            ga4SessionChannel: ga4Row.channel,
            ga4TrafficChannelSyncedAt: syncedAt,
          },
        },
      );
      if (result.modifiedCount > 0) {
        summary.updated += 1;
      } else {
        summary.alreadyDirect += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(
        `[GA4 Order Traffic Sync] Failed order ${orderKey}:`,
        error.message,
      );
    }
  }

  return summary;
}

module.exports = {
  syncGa4OrderTrafficSources,
  DEFAULT_LOOKBACK_DAYS,
  resolveLookbackRange,
};
