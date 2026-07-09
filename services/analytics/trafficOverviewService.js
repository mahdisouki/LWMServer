const ClaritySnapshot = require('../../models/ClaritySnapshot');
const Task = require('../../models/Task');
const { resolvePeriod } = require('./dashboardService');
const { ANALYTICS_TIMEZONE, toDateString, getPeriodLabels } = require('../../utils/analyticsDateRange');
const {
  extractOverviewTrafficSeries,
  extractSnapshotSourceBreakdown,
  getTopSourceLabel,
  SOURCE_LABELS,
} = require('../../utils/clarityMetricsParser');

function emptySourceBreakdown() {
  return {
    organic: 0,
    direct: 0,
    referral: 0,
    social: 0,
    paid: 0,
    other: 0,
  };
}

function sumSourceBreakdown(target, addition) {
  for (const key of Object.keys(target)) {
    target[key] += addition[key] || 0;
  }
}

async function loadOrdersAndRevenueByDay(start, end) {
  const rows = await Task.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        paymentStatus: { $ne: 'Failed' },
        createdByType: 'public',
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt',
            timezone: ANALYTICS_TIMEZONE,
          },
        },
        orders: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$totalPrice', 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return new Map(rows.map((row) => [row._id, { orders: row.orders, revenue: row.revenue }]));
}

async function getTrafficOverview({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  const [overviewSnapshots, sourceSnapshots, ordersByDay] = await Promise.all([
    ClaritySnapshot.find({
      snapshotType: 'overview',
      snapshotDate: { $gte: period.start, $lte: period.end },
    }).sort({ snapshotDate: 1 }).lean(),
    ClaritySnapshot.find({
      snapshotType: 'traffic_sources',
      snapshotDate: { $gte: period.start, $lte: period.end },
    }).sort({ snapshotDate: 1 }).lean(),
    loadOrdersAndRevenueByDay(period.start, period.end),
  ]);

  const sourcesByDate = new Map(
    sourceSnapshots.map((snapshot) => [
      toDateString(snapshot.snapshotDate),
      extractSnapshotSourceBreakdown(snapshot.data),
    ]),
  );

  const daily = overviewSnapshots.map((snapshot) => {
    const date = toDateString(snapshot.snapshotDate);
    const traffic = extractOverviewTrafficSeries(snapshot.data);
    const sources = sourcesByDate.get(date) || emptySourceBreakdown();
    const business = ordersByDay.get(date) || { orders: 0, revenue: 0 };

    return {
      date,
      pageViews: traffic.pageViews,
      visitors: traffic.visitors,
      sessions: traffic.sessions,
      orders: business.orders,
      revenue: Math.round(business.revenue * 100) / 100,
      sources,
    };
  });

  const totals = {
    pageViews: 0,
    visitors: 0,
    sessions: 0,
    orders: 0,
    revenue: 0,
    sources: emptySourceBreakdown(),
  };

  for (const day of daily) {
    totals.pageViews += day.pageViews;
    totals.visitors += day.visitors;
    totals.sessions += day.sessions;
    totals.orders += day.orders;
    totals.revenue += day.revenue;
    sumSourceBreakdown(totals.sources, day.sources);
  }

  totals.revenue = Math.round(totals.revenue * 100) / 100;
  totals.topSource = getTopSourceLabel(totals.sources);

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: overviewSnapshots.length,
      note: overviewSnapshots.length === 0
        ? 'No Clarity snapshots for this period. Traffic and source data will appear as daily sync runs.'
        : undefined,
    },
    daily,
    totals: {
      pageViews: totals.pageViews,
      visitors: totals.visitors,
      sessions: totals.sessions,
      orders: totals.orders,
      revenue: totals.revenue,
      topSource: totals.topSource,
      sources: totals.sources,
    },
    sourceLabels: SOURCE_LABELS,
    dataSources: {
      pageViews: 'Clarity overview snapshots (PopularPages)',
      visitors: 'Clarity overview snapshots (distinctUserCount)',
      sources: 'Clarity traffic_sources snapshots (Channel + Source dimensions)',
      orders: 'Task collection — public bookings with paymentStatus not Failed, created per day',
      revenue: 'Task collection — sum of totalPrice for public bookings with paymentStatus not Failed, created per day',
    },
  };
}

module.exports = {
  getTrafficOverview,
};
