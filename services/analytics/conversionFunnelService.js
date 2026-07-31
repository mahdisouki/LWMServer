const ClaritySnapshot = require('../../models/ClaritySnapshot');
const Task = require('../../models/Task');
const QuotationRequest = require('../../models/QuotationRequest');
const ContactRequest = require('../../models/ContactRequest');
const MovingServiceRequest = require('../../models/MovingServiceRequest');
const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels } = require('../../utils/analyticsDateRange');
const { isGa4Enabled } = require('../../config/ga4Config');
const { findMetric, parseIntSafe, parseDistinctUserCount } = require('../../utils/clarityMetricsParser');
const { fetchPeriodTraffic } = require('./ga4Service');
const { excludeMigratedOrdersFilter } = require('./taskFilters');

const FUNNEL_STAGES = [
  { id: 'visitors', label: 'Website Visitors' },
  { id: 'pageEngagements', label: 'Page Engagements' },
  { id: 'leadRequests', label: 'Requests', expandable: true, showPercentOfTop: false },
  { id: 'confirmedOrders', label: 'Confirmed Orders (public)' },
  { id: 'revenue', label: 'Revenue (public)', valueType: 'currency', showPercentOfTop: false },
];

const LEAD_BREAKDOWN_LABELS = {
  quoteRequests: 'Quote Requests',
  contactRequests: 'Contact Requests',
  movingServiceRequests: 'Moving Service Requests',
};

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function statusStat(count, total) {
  return {
    count,
    percent: total > 0 ? roundPercent((count / total) * 100) : 0,
  };
}

function extractEngagedSessions(overviewData) {
  const traffic = findMetric(overviewData, 'Traffic');
  const engagement = findMetric(overviewData, 'EngagementTime');
  const quickback = findMetric(overviewData, 'QuickbackClick');

  const trafficInfo = traffic?.information?.[0] || {};
  const engagementInfo = engagement?.information?.[0] || {};
  const quickbackInfo = quickback?.information?.[0] || {};

  const visitors = parseDistinctUserCount(trafficInfo);
  const sessions = parseIntSafe(trafficInfo.totalSessionCount);
  const activeTimeSeconds = parseIntSafe(engagementInfo.activeTime);
  const quickbackSessions = Math.round(
    sessions * (parseFloat(quickbackInfo.sessionsWithMetricPercentage || 0) / 100),
  );

  let engaged = sessions - quickbackSessions;
  if (activeTimeSeconds <= 0) {
    engaged = 0;
  }
  engaged = Math.max(0, Math.min(engaged, visitors || sessions));

  return { visitors, pageEngagements: engaged };
}

async function countContactRequests(start, end) {
  return ContactRequest.countDocuments({
    createdAt: { $gte: start, $lte: end },
  });
}

async function countMovingServiceRequests(start, end) {
  return MovingServiceRequest.countDocuments({
    createdAt: { $gte: start, $lte: end },
  });
}

/**
 * Quotation status matches QuotationRequest.getStatusSync:
 * accepted = reason === 'task created'
 * rejected = any other non-empty reason
 * pending = no reason
 */
async function loadQuotationStats(start, end) {
  const rows = await QuotationRequest.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$reason', 'task created'] },
                then: 'accepted',
              },
              {
                case: {
                  $and: [
                    { $ne: [{ $ifNull: ['$reason', ''] }, ''] },
                    { $ne: [{ $trim: { input: { $ifNull: ['$reason', ''] } } }, ''] },
                  ],
                },
                then: 'rejected',
              },
            ],
            default: 'pending',
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const counts = { accepted: 0, rejected: 0, pending: 0 };
  for (const row of rows) {
    if (row._id && Object.prototype.hasOwnProperty.call(counts, row._id)) {
      counts[row._id] = row.count || 0;
    }
  }

  const total = counts.accepted + counts.rejected + counts.pending;

  return {
    total,
    accepted: statusStat(counts.accepted, total),
    rejected: statusStat(counts.rejected, total),
    pending: statusStat(counts.pending, total),
  };
}

async function loadConfirmedOrdersAndRevenue(start, end) {
  const [row] = await Task.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        paymentStatus: { $ne: 'Failed' },
        createdByType: 'public',
        ...excludeMigratedOrdersFilter,
      },
    },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$totalPrice', 0] } },
      },
    },
  ]);

  return {
    confirmedOrders: row?.orders || 0,
    revenue: roundMoney(row?.revenue || 0),
  };
}

function buildLeadBreakdown(counts) {
  return ['quoteRequests', 'contactRequests', 'movingServiceRequests'].map((id) => ({
    id,
    label: LEAD_BREAKDOWN_LABELS[id],
    count: counts[id] || 0,
  }));
}

function buildFunnelSteps(counts, quotationStats) {
  const top = counts.visitors || 0;

  const steps = FUNNEL_STAGES.map((stage, index) => {
    const count = counts[stage.id] || 0;
    const showPercentOfTop = stage.showPercentOfTop !== false;
    const percentOfTop = showPercentOfTop && top > 0
      ? roundPercent((count / top) * 100)
      : null;
    const previousCount = index > 0 ? counts[FUNNEL_STAGES[index - 1].id] || 0 : null;
    const dropOffFromPrevious = previousCount && previousCount > 0 && showPercentOfTop
      ? roundPercent(((previousCount - count) / previousCount) * 100)
      : null;

    const step = {
      id: stage.id,
      label: stage.label,
      count,
      valueType: stage.valueType || 'count',
      percentOfTop,
      dropOffFromPrevious,
    };

    if (stage.expandable) {
      step.expandable = true;
      step.breakdown = buildLeadBreakdown(counts);
      step.quotationStats = quotationStats;
    }

    return step;
  });

  const overallConversion = top > 0
    ? roundPercent((counts.confirmedOrders / top) * 100)
    : 0;

  return { steps, overallConversion };
}

async function getConversionFunnel({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  const [
    overviewSnapshots,
    quotationStats,
    contactRequests,
    movingServiceRequests,
    orderStats,
    ga4Period,
  ] = await Promise.all([
    ClaritySnapshot.find({
      snapshotType: 'overview',
      snapshotDate: { $gte: period.start, $lte: period.end },
    }).sort({ snapshotDate: 1 }).lean(),
    loadQuotationStats(period.start, period.end),
    countContactRequests(period.start, period.end),
    countMovingServiceRequests(period.start, period.end),
    loadConfirmedOrdersAndRevenue(period.start, period.end),
    isGa4Enabled()
      ? fetchPeriodTraffic({ startKey: period.startKey, endKey: period.endKey })
      : Promise.resolve(null),
  ]);

  const quoteRequests = quotationStats.total;

  const counts = {
    visitors: 0,
    pageEngagements: 0,
    quoteRequests,
    contactRequests,
    movingServiceRequests,
    leadRequests: quoteRequests + contactRequests + movingServiceRequests,
    confirmedOrders: orderStats.confirmedOrders,
    revenue: orderStats.revenue,
  };

  for (const snapshot of overviewSnapshots) {
    const day = extractEngagedSessions(snapshot.data);
    counts.visitors += day.visitors;
    counts.pageEngagements += day.pageEngagements;
  }

  const visitorsFromGa4 = Boolean(ga4Period?.available);
  if (visitorsFromGa4) {
    counts.visitors = ga4Period.users;
    counts.pageEngagements = ga4Period.engagedSessions ?? 0;
  }

  const { steps, overallConversion } = buildFunnelSteps(counts, quotationStats);

  let coverageNote;
  if (!visitorsFromGa4 && overviewSnapshots.length === 0) {
    coverageNote = 'Visitor & engagement stages need GA4 or Clarity data for this period.';
  } else if (!visitorsFromGa4 && isGa4Enabled()) {
    coverageNote = 'GA4 unavailable; visitor/engagement stages use Clarity fallback.';
  }

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: overviewSnapshots.length,
      note: coverageNote,
      trafficSource: visitorsFromGa4 ? 'ga4' : 'clarity',
    },
    funnel: steps,
    overallConversion,
    dataSources: {
      visitors: visitorsFromGa4
        ? 'Google Analytics 4 — totalUsers for the selected period'
        : 'Clarity overview snapshots — distinctUserCount (summed per day)',
      pageEngagements: visitorsFromGa4
        ? 'Google Analytics 4 — engagedSessions'
        : 'Clarity overview snapshots — sessions minus quick-back sessions with active time',
      leadRequests:
        'Sum of QuotationRequest + ContactRequest + MovingServiceRequest submissions in period',
      quoteRequests: 'QuotationRequest collection',
      contactRequests: 'ContactRequest collection — contact form submissions in period',
      movingServiceRequests: 'MovingServiceRequest collection — moving service form submissions in period',
      quotationStats:
        'QuotationRequest status derived from reason (task created = accepted, other reason = rejected, empty = pending)',
      confirmedOrders: 'Task collection — public bookings with paymentStatus not Failed, excluding createdBy MigrationScript, created in period',
      revenue: 'Task collection — sum of totalPrice for the same confirmed orders (public, not Failed)',
    },
  };
}

module.exports = {
  getConversionFunnel,
};
