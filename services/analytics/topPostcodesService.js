const Task = require('../../models/Task');
const QuotationRequest = require('../../models/QuotationRequest');
const { resolvePeriod } = require('./dashboardService');

const PAID_TASK_STATUSES = ['Paid', 'partial_Paid', 'partial_Refunded', 'refunded', 'On_Hold'];
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

const BAR_COLORS = [
  'green', 'blue', 'purple', 'orange', 'pink', 'cyan', 'amber', 'indigo',
  'teal', 'lime', 'rose', 'violet', 'sky', 'emerald', 'fuchsia', 'red',
];

const ORDER_MATCH = (start, end) => ({
  createdAt: { $gte: start, $lte: end },
  paymentStatus: { $in: PAID_TASK_STATUSES },
  taskStatus: { $ne: 'Cancelled' },
  postcode: { $exists: true, $nin: ['', null] },
});

const QUOTE_MATCH = (start, end) => ({
  createdAt: { $gte: start, $lte: end },
  postcode: { $exists: true, $nin: ['', null] },
});

const POSTCODE_PREFIX_PROJECT = {
  postcodePrefix: {
    $toUpper: {
      $arrayElemAt: [
        { $split: [{ $trim: { input: '$postcode' } }, ' '] },
        0,
      ],
    },
  },
};

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toDateString(date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function facetCount(facetResult, key) {
  return facetResult?.[0]?.count || 0;
}

async function aggregateOrderBreakdown(start, end, limit) {
  const [result] = await Task.aggregate([
    { $match: ORDER_MATCH(start, end) },
    { $project: POSTCODE_PREFIX_PROJECT },
    {
      $facet: {
        topByOrders: [
          { $match: { postcodePrefix: { $ne: '' } } },
          { $group: { _id: '$postcodePrefix', orders: { $sum: 1 } } },
          { $sort: { orders: -1, _id: 1 } },
          { $limit: limit },
          { $project: { _id: 0, postcode: '$_id', orders: 1 } },
        ],
        totalOrders: [{ $count: 'count' }],
        withValidPostcode: [
          { $match: { postcodePrefix: { $ne: '' } } },
          { $count: 'count' },
        ],
        invalidPostcodes: [
          { $match: { postcodePrefix: { $eq: '' } } },
          { $count: 'count' },
        ],
        uniquePostcodeAreas: [
          { $match: { postcodePrefix: { $ne: '' } } },
          { $group: { _id: '$postcodePrefix' } },
          { $count: 'count' },
        ],
      },
    },
  ]);

  return {
    topRows: result?.topByOrders || [],
    totalOrders: facetCount(result?.totalOrders, 'count'),
    withValidPostcode: facetCount(result?.withValidPostcode, 'count'),
    invalidPostcodes: facetCount(result?.invalidPostcodes, 'count'),
    uniquePostcodeAreas: facetCount(result?.uniquePostcodeAreas, 'count'),
  };
}

async function aggregateQuoteBreakdown(start, end, postcodes) {
  const prefixList = [...new Set(postcodes.filter(Boolean))];

  const [result] = await QuotationRequest.aggregate([
    { $match: QUOTE_MATCH(start, end) },
    { $project: POSTCODE_PREFIX_PROJECT },
    {
      $facet: {
        countsForPrefixes: [
          { $match: { postcodePrefix: { $in: prefixList } } },
          { $group: { _id: '$postcodePrefix', quotes: { $sum: 1 } } },
        ],
        totalQuotes: [{ $count: 'count' }],
        withValidPostcode: [
          { $match: { postcodePrefix: { $ne: '' } } },
          { $count: 'count' },
        ],
        invalidPostcodes: [
          { $match: { postcodePrefix: { $eq: '' } } },
          { $count: 'count' },
        ],
        uniquePostcodeAreas: [
          { $match: { postcodePrefix: { $ne: '' } } },
          { $group: { _id: '$postcodePrefix' } },
          { $count: 'count' },
        ],
      },
    },
  ]);

  const quoteCounts = {};
  for (const row of result?.countsForPrefixes || []) {
    quoteCounts[row._id] = row.quotes;
  }

  return {
    quoteCounts,
    totalQuotes: facetCount(result?.totalQuotes, 'count'),
    withValidPostcode: facetCount(result?.withValidPostcode, 'count'),
    invalidPostcodes: facetCount(result?.invalidPostcodes, 'count'),
    uniquePostcodeAreas: facetCount(result?.uniquePostcodeAreas, 'count'),
  };
}

function buildPostcodeRows(topOrderRows, quoteCounts) {
  const maxOrders = topOrderRows[0]?.orders || 0;

  return topOrderRows.map((row, index) => ({
    rank: index + 1,
    postcode: row.postcode,
    orders: row.orders,
    quotes: quoteCounts[row.postcode] || 0,
    sharePercent: maxOrders > 0 ? roundPercent((row.orders / maxOrders) * 100) : 0,
    color: BAR_COLORS[index % BAR_COLORS.length],
  }));
}

async function getTopPostcodes({ preset, startDate, endDate, limit = DEFAULT_LIMIT } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });
  const rowLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const orderBreakdown = await aggregateOrderBreakdown(period.start, period.end, rowLimit);
  const quoteBreakdown = await aggregateQuoteBreakdown(
    period.start,
    period.end,
    orderBreakdown.topRows.map((row) => row.postcode),
  );

  const postcodes = buildPostcodeRows(orderBreakdown.topRows, quoteBreakdown.quoteCounts);

  const totals = postcodes.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orders,
      quotes: acc.quotes + row.quotes,
    }),
    { orders: 0, quotes: 0 },
  );

  return {
    period: {
      preset: period.preset,
      startDate: toDateString(period.start),
      endDate: toDateString(period.end),
    },
    badge: {
      label: 'Postcode areas',
      icon: 'location',
    },
    grouping: {
      level: 'outward',
      description: 'Postcodes grouped by outward code (e.g. SW1A from SW1A 2AA)',
    },
    orderAttribution: {
      totalOrders: orderBreakdown.totalOrders,
      withValidPostcode: orderBreakdown.withValidPostcode,
      invalidPostcodes: orderBreakdown.invalidPostcodes,
      uniquePostcodeAreas: orderBreakdown.uniquePostcodeAreas,
    },
    quoteAttribution: {
      totalQuotes: quoteBreakdown.totalQuotes,
      withValidPostcode: quoteBreakdown.withValidPostcode,
      invalidPostcodes: quoteBreakdown.invalidPostcodes,
      uniquePostcodeAreas: quoteBreakdown.uniquePostcodeAreas,
    },
    postcodes,
    totals,
    limit: rowLimit,
    dataSources: {
      orders: 'Task collection — paid orders aggregated by postcode outward code in MongoDB',
      quotes: 'QuotationRequest collection — quote counts for the returned postcode areas only',
      ranking: 'Postcode areas ranked by order count; only top N rows returned from the database',
    },
  };
}

module.exports = {
  getTopPostcodes,
};
