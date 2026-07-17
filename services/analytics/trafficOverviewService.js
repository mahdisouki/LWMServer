const ClaritySnapshot = require('../../models/ClaritySnapshot');
const Task = require('../../models/Task');
const { resolvePeriod } = require('./dashboardService');
const { toDateString, getPeriodLabels, eachDayKeyInPeriod } = require('../../utils/analyticsDateRange');
const { isGa4Enabled } = require('../../config/ga4Config');
const {
  extractOverviewTrafficSeries,
  extractSnapshotSourceBreakdown,
  getTopSourceLabel,
  SOURCE_LABELS,
} = require('../../utils/clarityMetricsParser');
const {
  fetchDailyTraffic,
  fetchPeriodTraffic,
} = require('./ga4Service');

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
            timezone: 'UTC',
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

  const [overviewSnapshots, sourceSnapshots, ordersByDay, ga4Daily, ga4Period] = await Promise.all([
    ClaritySnapshot.find({
      snapshotType: 'overview',
      snapshotDate: { $gte: period.start, $lte: period.end },
    }).sort({ snapshotDate: 1 }).lean(),
    ClaritySnapshot.find({
      snapshotType: 'traffic_sources',
      snapshotDate: { $gte: period.start, $lte: period.end },
    }).sort({ snapshotDate: 1 }).lean(),
    loadOrdersAndRevenueByDay(period.start, period.end),
    isGa4Enabled()
      ? fetchDailyTraffic({ startKey: period.startKey, endKey: period.endKey })
      : Promise.resolve(null),
    isGa4Enabled()
      ? fetchPeriodTraffic({ startKey: period.startKey, endKey: period.endKey })
      : Promise.resolve(null),
  ]);

  const sourcesByDate = new Map(
    sourceSnapshots.map((snapshot) => [
      toDateString(snapshot.snapshotDate),
      extractSnapshotSourceBreakdown(snapshot.data),
    ]),
  );

  const trafficFromGa4 = Boolean(ga4Daily?.available);
  const dayKeys = trafficFromGa4
    ? Array.from(ga4Daily.byDate.keys())
    : overviewSnapshots.map((snapshot) => toDateString(snapshot.snapshotDate));

  const clarityByDate = new Map(
    overviewSnapshots.map((snapshot) => [
      toDateString(snapshot.snapshotDate),
      extractOverviewTrafficSeries(snapshot.data),
    ]),
  );

  // When GA4 is available, fill every day in the period so the chart is continuous.
  const chartDayKeys = trafficFromGa4
    ? eachDayKeyInPeriod(period.start, period.end, {
      startKey: period.startKey,
      endKey: period.endKey,
    })
    : dayKeys;

  const daily = chartDayKeys.map((date) => {
    const ga4 = ga4Daily?.byDate?.get(date);
    const clarity = clarityByDate.get(date);
    const sources = sourcesByDate.get(date) || emptySourceBreakdown();
    const business = ordersByDay.get(date) || { orders: 0, revenue: 0 };

    return {
      date,
      pageViews: trafficFromGa4 ? (ga4?.pageViews || 0) : (clarity?.pageViews || 0),
      visitors: trafficFromGa4 ? (ga4?.users || 0) : (clarity?.visitors || 0),
      sessions: trafficFromGa4 ? (ga4?.sessions || 0) : (clarity?.sessions || 0),
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

  // Prefer period-level unique users from GA4 (not summed daily uniques).
  if (ga4Period?.available) {
    totals.pageViews = ga4Period.pageViews;
    totals.sessions = ga4Period.sessions;
    totals.visitors = ga4Period.users;
  }

  totals.revenue = Math.round(totals.revenue * 100) / 100;
  totals.topSource = getTopSourceLabel(totals.sources);

  let coverageNote;
  if (trafficFromGa4) {
    coverageNote = undefined;
  } else if (isGa4Enabled()) {
    coverageNote = 'GA4 is configured but unavailable; showing Clarity fallback for page views / visitors / sessions.';
  } else if (overviewSnapshots.length === 0) {
    coverageNote = 'No Clarity snapshots for this period. Enable GA4 for trusted traffic totals.';
  } else {
    coverageNote = undefined;
  }

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: chartDayKeys.length,
      note: coverageNote,
      trafficSource: trafficFromGa4 ? 'ga4' : 'clarity',
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
      pageViews: trafficFromGa4
        ? 'Google Analytics 4 — screenPageViews'
        : 'Clarity overview snapshots (sessions × pages per session)',
      visitors: trafficFromGa4
        ? 'Google Analytics 4 — totalUsers (period unique; daily chart uses per-day users)'
        : 'Clarity overview snapshots (distinctUserCount)',
      sessions: trafficFromGa4
        ? 'Google Analytics 4 — sessions'
        : 'Clarity overview snapshots (totalSessionCount)',
      sources: 'Clarity traffic_sources snapshots (Channel + Source dimensions)',
      orders: 'Task collection — public bookings with paymentStatus not Failed, created per UTC day',
      revenue: 'Task collection — sum of totalPrice for public bookings with paymentStatus not Failed, created per UTC day',
    },
  };
}

module.exports = {
  getTrafficOverview,
};
