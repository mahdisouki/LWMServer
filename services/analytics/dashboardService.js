const QuotationRequest = require('../../models/QuotationRequest');
const Task = require('../../models/Task');
const { getPageFilterById, pageFilterTracksQuotes } = require('../../config/analyticsPageMap');
const { isGa4Enabled } = require('../../config/ga4Config');
const { formatDuration, percentChange } = require('../../utils/analyticsFormatters');
const {
  resolvePeriod,
  getPreviousPeriod,
  getPeriodLabels,
} = require('../../utils/analyticsDateRange');
const { fetchPeriodTrafficForPageFilter } = require('./ga4Service');
const { excludeMigratedOrdersFilter } = require('./taskFilters');

async function countQuoteRequests(start, end) {
  return QuotationRequest.countDocuments({
    createdAt: { $gte: start, $lte: end },
  });
}

/** All orders (public, Admin, broker) — excludes Failed payments and MigrationScript. */
async function countTotalOrders(start, end) {
  return Task.countDocuments({
    createdAt: { $gte: start, $lte: end },
    paymentStatus: { $ne: 'Failed' },
    ...excludeMigratedOrdersFilter,
  });
}

function buildMetricBlock(current, previous, { formatter = (v) => v, applicable = true, label } = {}) {
  if (!applicable) {
    const block = {
      value: null,
      formatted: null,
      changePercent: null,
      applicable: false,
    };
    if (label) block.label = label;
    return block;
  }

  const block = {
    value: current,
    formatted: formatter(current),
    changePercent: percentChange(current, previous),
    applicable: true,
  };
  if (label) block.label = label;
  return block;
}

async function getDashboard({ preset, startDate, endDate, page = 'all' } = {}) {
  const pageFilter = getPageFilterById(page);
  if (!pageFilter) {
    throw new Error(`Unknown page filter: ${page}`);
  }

  if (!isGa4Enabled()) {
    throw new Error('GA4 is not configured — Website Analytics dashboard requires Google Analytics 4');
  }

  const period = resolvePeriod({ preset, startDate, endDate });
  const previousPeriod = getPreviousPeriod(period.start, period.end, {
    startKey: period.startKey,
    endKey: period.endKey,
  });
  const quotesApplicable = pageFilterTracksQuotes(pageFilter);

  const quoteQueries = quotesApplicable
    ? [
      countQuoteRequests(period.start, period.end),
      countQuoteRequests(previousPeriod.start, previousPeriod.end),
    ]
    : [Promise.resolve(null), Promise.resolve(null)];

  const [
    currentQuotes,
    previousQuotes,
    currentOrders,
    previousOrders,
    currentGa4,
    previousGa4,
  ] = await Promise.all([
    ...quoteQueries,
    countTotalOrders(period.start, period.end),
    countTotalOrders(previousPeriod.start, previousPeriod.end),
    fetchPeriodTrafficForPageFilter({
      startKey: period.startKey,
      endKey: period.endKey,
      pageFilter,
    }),
    fetchPeriodTrafficForPageFilter({
      startKey: previousPeriod.startKey,
      endKey: previousPeriod.endKey,
      pageFilter,
    }),
  ]);

  if (!currentGa4?.available) {
    throw new Error('Failed to load traffic metrics from Google Analytics 4');
  }

  const currentAvgTime = currentGa4.avgEngagementSeconds;
  const previousAvgTime = previousGa4?.available ? previousGa4.avgEngagementSeconds : null;

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    page: {
      id: pageFilter.id,
      label: pageFilter.label,
    },
    metrics: {
      users: buildMetricBlock(
        currentGa4.users,
        previousGa4?.available ? previousGa4.users : null,
        { label: 'Unique Visitors' },
      ),
      quoteRequests: buildMetricBlock(currentQuotes, previousQuotes, { applicable: quotesApplicable }),
      totalOrders: buildMetricBlock(currentOrders, previousOrders),
      avgTimeOnSite: buildMetricBlock(
        currentAvgTime,
        previousAvgTime,
        { formatter: formatDuration },
      ),
    },
  };
}

module.exports = {
  getDashboard,
  resolvePeriod,
};
