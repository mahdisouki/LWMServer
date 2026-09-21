const Task = require('../../models/Task');
const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels } = require('../../utils/analyticsDateRange');
const { excludeMigratedOrdersFilter } = require('./taskFilters');
const { TRAFFIC_SOURCES } = require('../../utils/trafficSource');
const {
  getDailyAdsSpendByPlatform,
  sumMap,
  roundMoney,
} = require('./adsSpendPlatformsService');

const DEFAULT_LIMIT = 7;
const MAX_LIMIT = 50;

const SOURCE_CONFIG = [
  { source: TRAFFIC_SOURCES.GOOGLE_ADS, color: 'green', spendKey: 'google' },
  { source: TRAFFIC_SOURCES.LSA, color: 'yellow', spendKey: 'localServices' },
  { source: TRAFFIC_SOURCES.MICROSOFT_ADS, color: 'blue', spendKey: 'microsoft' },
  { source: TRAFFIC_SOURCES.INSTAGRAM, color: 'purple', spendKey: 'meta' },
  { source: TRAFFIC_SOURCES.FACEBOOK, color: 'pink', spendKey: 'meta' },
  { source: TRAFFIC_SOURCES.DIRECT, color: 'gray', spendKey: null },
  { source: TRAFFIC_SOURCES.ORGANIC, color: 'orange', spendKey: null },
];

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
 * Ads spend is attached from Google / Microsoft / Meta (Instagram + Facebook share Meta).
 */
async function getOrderTrafficSources({
  preset,
  startDate,
  endDate,
  limit = DEFAULT_LIMIT,
} = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });
  const periodLabels = getPeriodLabels(period);
  const rowLimit = clampLimit(limit);

  const [rows, adsSpendMaps] = await Promise.all([
    Task.aggregate([
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
    ]),
    getDailyAdsSpendByPlatform({
      startDate: periodLabels.startDate,
      endDate: periodLabels.endDate,
    }),
  ]);

  const adsSpendTotals = {
    google: sumMap(adsSpendMaps.google),
    localServices: sumMap(adsSpendMaps.localServices),
    microsoft: sumMap(adsSpendMaps.microsoft),
    meta: sumMap(adsSpendMaps.meta),
  };

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

  const sources = SOURCE_CONFIG.slice(0, rowLimit).map(({ source, color, spendKey }, index) => {
    const stats = bySource.get(source) || { orderCount: 0, revenue: 0 };
    const spend = spendKey ? roundMoney(adsSpendTotals[spendKey] || 0) : 0;
    const localServicesSpend =
      source === TRAFFIC_SOURCES.GOOGLE_ADS
        ? roundMoney(adsSpendTotals.localServices || 0)
        : 0;
    return {
      rank: index + 1,
      trafficSource: source,
      label: source,
      orderCount: stats.orderCount,
      revenue: stats.revenue,
      spend,
      ...(source === TRAFFIC_SOURCES.GOOGLE_ADS ? { localServicesSpend } : {}),
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
      ...periodLabels,
    },
    sources,
    totals: {
      orderCount: totalOrderCount,
      revenue: totalRevenue,
      spend: roundMoney(
        adsSpendTotals.google + adsSpendTotals.microsoft + adsSpendTotals.meta,
      ),
      localServicesSpend: roundMoney(adsSpendTotals.localServices),
      uniqueSources: sources.filter((source) => source.orderCount > 0).length,
    },
    limit: rowLimit,
    dataSources: {
      orders:
        'Task collection — all orders (public, Admin, broker) with paymentStatus not Failed, excluding createdBy MigrationScript, grouped by trafficSource for the selected period',
      spend:
        'Google Ads Cost excluding Local Services (LSA shown in parentheses on Google Ads); LSA row uses Local Services Cost; Microsoft Ads; Meta Marketing API (Instagram & Facebook rows share combined Meta spend)',
      ranking: 'Fixed channel order (Google Ads, LSA, Microsoft Ads, Instagram, Facebook, Direct, Organic)',
    },
  };
}

const VALID_TRAFFIC_SOURCES = new Set(Object.values(TRAFFIC_SOURCES));
const ORDERS_DEFAULT_LIMIT = 20;
const ORDERS_MAX_LIMIT = 100;

function clampOrdersLimit(limit) {
  return Math.min(Math.max(parseInt(limit, 10) || ORDERS_DEFAULT_LIMIT, 1), ORDERS_MAX_LIMIT);
}

function clampOrdersPage(page) {
  return Math.max(parseInt(page, 10) || 1, 1);
}

function buildSourceMatch(trafficSource) {
  if (trafficSource === TRAFFIC_SOURCES.ORGANIC) {
    return {
      $or: [
        { trafficSource: TRAFFIC_SOURCES.ORGANIC },
        { trafficSource: { $exists: false } },
        { trafficSource: null },
        { trafficSource: '' },
      ],
    };
  }
  return { trafficSource };
}

/**
 * Paginated orders for one traffic source within the selected analytics period.
 * Uses the same match rules as the aggregate card (exclude Failed + MigrationScript).
 */
async function getOrderTrafficSourceOrders({
  trafficSource,
  preset,
  startDate,
  endDate,
  page = 1,
  limit = ORDERS_DEFAULT_LIMIT,
} = {}) {
  const source = String(trafficSource || '').trim();
  if (!VALID_TRAFFIC_SOURCES.has(source)) {
    const err = new Error(
      `Invalid trafficSource. Must be one of: ${[...VALID_TRAFFIC_SOURCES].join(', ')}`,
    );
    err.statusCode = 400;
    throw err;
  }

  const period = resolvePeriod({ preset, startDate, endDate });
  const periodLabels = getPeriodLabels(period);
  const pageNum = clampOrdersPage(page);
  const limitNum = clampOrdersLimit(limit);
  const skip = (pageNum - 1) * limitNum;

  const match = {
    ...ORDER_MATCH(period.start, period.end),
    ...buildSourceMatch(source),
  };

  const [total, orders] = await Promise.all([
    Task.countDocuments(match),
    Task.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .select(
        [
          'orderNumber',
          'firstName',
          'lastName',
          'email',
          'phoneNumber',
          'postcode',
          'date',
          'createdAt',
          'totalPrice',
          'price',
          'paymentStatus',
          'taskStatus',
          'trafficSource',
          'createdByType',
          'createdBy',
        ].join(' '),
      )
      .populate('createdBy', 'email username firstName lastName')
      .lean(),
  ]);

  return {
    period: {
      preset: period.preset,
      ...periodLabels,
    },
    trafficSource: source,
    orders: orders.map((order) => {
      const createdBy =
        order.createdBy && typeof order.createdBy === 'object'
          ? {
              _id: String(order.createdBy._id),
              email: order.createdBy.email || null,
              username: order.createdBy.username || null,
              firstName: order.createdBy.firstName || null,
              lastName: order.createdBy.lastName || null,
            }
          : order.createdBy
            ? { _id: String(order.createdBy), email: null, username: null, firstName: null, lastName: null }
            : null;

      return {
        _id: String(order._id),
        orderNumber: order.orderNumber || null,
        firstName: order.firstName || '',
        lastName: order.lastName || '',
        email: order.email || '',
        phoneNumber: order.phoneNumber || '',
        postcode: order.postcode || '',
        date: order.date || null,
        createdAt: order.createdAt,
        totalPrice: roundMoney(order.totalPrice ?? order.price ?? 0),
        paymentStatus: order.paymentStatus || null,
        taskStatus: order.taskStatus || null,
        trafficSource: order.trafficSource || TRAFFIC_SOURCES.ORGANIC,
        createdByType: order.createdByType || null,
        createdBy,
      };
    }),
    meta: {
      currentPage: pageNum,
      limit: limitNum,
      total,
      count: orders.length,
    },
  };
}

module.exports = {
  getOrderTrafficSources,
  getOrderTrafficSourceOrders,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
