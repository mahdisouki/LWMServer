const Task = require('../../models/Task');
const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels, eachDayKeyInPeriod } = require('../../utils/analyticsDateRange');
const { isGa4Enabled } = require('../../config/ga4Config');
const { TRAFFIC_SOURCES } = require('../../utils/trafficSource');
const {
  fetchDailyTraffic,
  fetchPeriodTraffic,
} = require('./ga4Service');
const { excludeMigratedOrdersFilter } = require('./taskFilters');

const ORDER_SOURCE_KEYS = [
  TRAFFIC_SOURCES.GOOGLE_ADS,
  TRAFFIC_SOURCES.MICROSOFT_ADS,
  TRAFFIC_SOURCES.INSTAGRAM,
  TRAFFIC_SOURCES.FACEBOOK,
  TRAFFIC_SOURCES.ORGANIC,
];

function emptySourceStats() {
  return { orders: 0, revenue: 0 };
}

function emptyOrderSourceBreakdown() {
  return {
    [TRAFFIC_SOURCES.GOOGLE_ADS]: emptySourceStats(),
    [TRAFFIC_SOURCES.MICROSOFT_ADS]: emptySourceStats(),
    [TRAFFIC_SOURCES.INSTAGRAM]: emptySourceStats(),
    [TRAFFIC_SOURCES.FACEBOOK]: emptySourceStats(),
    [TRAFFIC_SOURCES.ORGANIC]: emptySourceStats(),
  };
}

function normalizeOrderSource(raw) {
  const value = String(raw || '').trim();
  if (ORDER_SOURCE_KEYS.includes(value)) {
    return value;
  }
  return TRAFFIC_SOURCES.ORGANIC;
}

function sumOrderSourceBreakdown(target, addition) {
  for (const key of ORDER_SOURCE_KEYS) {
    const row = addition[key] || emptySourceStats();
    target[key].orders += row.orders || 0;
    target[key].revenue += row.revenue || 0;
  }
}

function getTopOrderSource(sources) {
  let top = TRAFFIC_SOURCES.ORGANIC;
  let maxOrders = -1;
  for (const key of ORDER_SOURCE_KEYS) {
    const orders = sources[key]?.orders || 0;
    if (orders > maxOrders) {
      maxOrders = orders;
      top = key;
    }
  }
  return maxOrders > 0 ? top : '—';
}

async function loadOrdersAndRevenueByDay(start, end) {
  const rows = await Task.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        paymentStatus: { $ne: 'Failed' },
        ...excludeMigratedOrdersFilter,
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt',
            timezone: 'Europe/London',
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

/** Orders + revenue per London day, broken down by Task.trafficSource enum. */
async function loadOrdersBySourceByDay(start, end) {
  const rows = await Task.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        paymentStatus: { $ne: 'Failed' },
        ...excludeMigratedOrdersFilter,
      },
    },
    {
      $group: {
        _id: {
          date: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'Europe/London',
            },
          },
          source: { $ifNull: ['$trafficSource', TRAFFIC_SOURCES.ORGANIC] },
        },
        orders: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$totalPrice', 0] } },
      },
    },
  ]);

  const byDate = new Map();
  for (const row of rows) {
    const dateKey = row._id.date;
    const source = normalizeOrderSource(row._id.source);
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, emptyOrderSourceBreakdown());
    }
    const bucket = byDate.get(dateKey)[source];
    bucket.orders += row.orders;
    bucket.revenue = Math.round((bucket.revenue + row.revenue) * 100) / 100;
  }
  return byDate;
}

async function getTrafficOverview({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  if (!isGa4Enabled()) {
    throw new Error('GA4 is not configured — Traffic Overview requires Google Analytics 4');
  }

  const [ordersByDay, ordersBySourceByDay, ga4Daily, ga4Period] = await Promise.all([
    loadOrdersAndRevenueByDay(period.start, period.end),
    loadOrdersBySourceByDay(period.start, period.end),
    fetchDailyTraffic({ startKey: period.startKey, endKey: period.endKey }),
    fetchPeriodTraffic({ startKey: period.startKey, endKey: period.endKey }),
  ]);

  if (!ga4Daily?.available) {
    throw new Error('Failed to load traffic overview from Google Analytics 4');
  }

  const chartDayKeys = eachDayKeyInPeriod(period.start, period.end, {
    startKey: period.startKey,
    endKey: period.endKey,
  });

  const daily = chartDayKeys.map((date) => {
    const ga4 = ga4Daily.byDate?.get(date);
    const sources = ordersBySourceByDay.get(date) || emptyOrderSourceBreakdown();
    const business = ordersByDay.get(date) || { orders: 0, revenue: 0 };

    return {
      date,
      pageViews: ga4?.pageViews || 0,
      visitors: ga4?.users || 0,
      sessions: ga4?.sessions || 0,
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
    sources: emptyOrderSourceBreakdown(),
  };

  for (const day of daily) {
    totals.pageViews += day.pageViews;
    totals.visitors += day.visitors;
    totals.sessions += day.sessions;
    totals.orders += day.orders;
    totals.revenue += day.revenue;
    sumOrderSourceBreakdown(totals.sources, day.sources);
  }

  if (ga4Period?.available) {
    totals.pageViews = ga4Period.pageViews;
    totals.sessions = ga4Period.sessions;
    totals.visitors = ga4Period.users;
  }

  for (const key of ORDER_SOURCE_KEYS) {
    totals.sources[key].revenue = Math.round(totals.sources[key].revenue * 100) / 100;
  }

  totals.revenue = Math.round(totals.revenue * 100) / 100;
  totals.topSource = getTopOrderSource(totals.sources);

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: chartDayKeys.length,
      trafficSource: 'ga4',
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
    sourceLabels: ORDER_SOURCE_KEYS,
    dataSources: {
      pageViews: 'Google Analytics 4 — screenPageViews',
      visitors: 'Google Analytics 4 — totalUsers (period unique; daily chart uses per-day users)',
      sessions: 'Google Analytics 4 — sessions',
      sources:
        'Task.trafficSource enum (Google Ads, Microsoft Ads, Instagram, Facebook, Organic) — orders & revenue per source',
      orders: 'Task collection — all orders (public, Admin, broker) with paymentStatus not Failed, excluding createdBy MigrationScript, grouped by Europe/London day',
      revenue: 'Task collection — sum of totalPrice for all orders (public, Admin, broker) with paymentStatus not Failed, excluding createdBy MigrationScript, grouped by Europe/London day',
    },
  };
}

module.exports = {
  getTrafficOverview,
};
