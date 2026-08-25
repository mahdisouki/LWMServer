const Task = require('../../models/Task');
const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels } = require('../../utils/analyticsDateRange');
const { excludeMigratedOrdersFilter } = require('./taskFilters');
const { TRAFFIC_SOURCES } = require('../../utils/trafficSource');

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 50;

const SOURCE_CONFIG = [
  { source: TRAFFIC_SOURCES.GOOGLE_ADS, color: 'green' },
  { source: TRAFFIC_SOURCES.MICROSOFT_ADS, color: 'blue' },
  { source: TRAFFIC_SOURCES.INSTAGRAM, color: 'purple' },
  { source: TRAFFIC_SOURCES.FACEBOOK, color: 'pink' },
  { source: TRAFFIC_SOURCES.DIRECT, color: 'gray' },
  { source: TRAFFIC_SOURCES.ORGANIC, color: 'orange' },
];

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function clampLimit(limit) {
  return Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
}

const ORDER_MATCH = (start, end) => ({
  createdAt: { $gte: start, $lte: end },
  paymentStatus: { $ne: 'Failed' },
  ...excludeMigratedOrdersFilter,
});

/**
 * Period-scoped order traffic sources (order count + revenue by trafficSource).
 * Replaces the analytics page's previous all-clients fetch + client-side grouping.
 */
async function getOrderTrafficSources({
  preset,
  startDate,
  endDate,
  limit = DEFAULT_LIMIT,
} = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });
  const rowLimit = clampLimit(limit);

  const rows = await Task.aggregate([
    { $match: ORDER_MATCH(period.start, period.end) },
    {
      $group: {
        _id: {
          $ifNull: ['$trafficSource', TRAFFIC_SOURCES.ORGANIC],
        },
        orderCount: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$totalPrice', 0] } },
      },
    },
  ]);

  const bySource = new Map(
    rows.map((row) => [
      row._id || TRAFFIC_SOURCES.ORGANIC,
      {
        orderCount: row.orderCount || 0,
        revenue: roundMoney(row.revenue || 0),
      },
    ]),
  );

  const totalOrderCount = rows.reduce((sum, row) => sum + (row.orderCount || 0), 0);
  const totalRevenue = roundMoney(
    rows.reduce((sum, row) => sum + (row.revenue || 0), 0),
  );

  const sources = SOURCE_CONFIG.slice(0, rowLimit).map(({ source, color }, index) => {
    const stats = bySource.get(source) || { orderCount: 0, revenue: 0 };
    return {
      rank: index + 1,
      trafficSource: source,
      label: source,
      orderCount: stats.orderCount,
      revenue: stats.revenue,
      sharePercent:
        totalOrderCount > 0
          ? roundPercent((stats.orderCount / totalOrderCount) * 100)
          : 0,
      color,
    };
  });

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    sources,
    totals: {
      orderCount: totalOrderCount,
      revenue: totalRevenue,
      uniqueSources: sources.filter((source) => source.orderCount > 0).length,
    },
    limit: rowLimit,
    dataSources: {
      orders:
        'Task collection — all orders (public, Admin, broker) with paymentStatus not Failed, excluding createdBy MigrationScript, grouped by trafficSource for the selected period',
      ranking: 'Fixed channel order (Google Ads, Microsoft Ads, Instagram, Facebook, Direct, Organic)',
    },
  };
}

module.exports = {
  getOrderTrafficSources,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
