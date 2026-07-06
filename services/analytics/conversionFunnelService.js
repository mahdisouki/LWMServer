const ClaritySnapshot = require('../../models/ClaritySnapshot');
const Task = require('../../models/Task');
const QuotationRequest = require('../../models/QuotationRequest');
const { resolvePeriod } = require('./dashboardService');
const { findMetric, parseIntSafe } = require('../../utils/clarityMetricsParser');

const PAID_TASK_STATUSES = ['Paid', 'partial_Paid', 'partial_Refunded', 'refunded', 'On_Hold'];

const FUNNEL_STAGES = [
  { id: 'visitors', label: 'Website Visitors' },
  { id: 'pageEngagements', label: 'Page Engagements' },
  { id: 'quoteRequests', label: 'Quote Requests' },
  { id: 'confirmedOrders', label: 'Confirmed Orders' },
];

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

function extractEngagedSessions(overviewData) {
  const traffic = findMetric(overviewData, 'Traffic');
  const engagement = findMetric(overviewData, 'EngagementTime');
  const quickback = findMetric(overviewData, 'QuickbackClick');

  const trafficInfo = traffic?.information?.[0] || {};
  const engagementInfo = engagement?.information?.[0] || {};
  const quickbackInfo = quickback?.information?.[0] || {};

  const visitors = parseIntSafe(trafficInfo.distinctUserCount);
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

async function countQuoteRequests(start, end) {
  return QuotationRequest.countDocuments({
    createdAt: { $gte: start, $lte: end },
  });
}

function buildFunnelSteps(counts) {
  const top = counts.visitors || 0;

  const steps = FUNNEL_STAGES.map((stage, index) => {
    const count = counts[stage.id] || 0;
    const percentOfTop = top > 0 ? roundPercent((count / top) * 100) : 0;
    const previousCount = index > 0 ? counts[FUNNEL_STAGES[index - 1].id] || 0 : null;
    const dropOffFromPrevious = previousCount && previousCount > 0
      ? roundPercent(((previousCount - count) / previousCount) * 100)
      : null;

    return {
      id: stage.id,
      label: stage.label,
      count,
      percentOfTop,
      dropOffFromPrevious,
    };
  });

  const overallConversion = top > 0
    ? roundPercent((counts.confirmedOrders / top) * 100)
    : 0;

  return { steps, overallConversion };
}

async function getConversionFunnel({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  const [overviewSnapshots, quoteRequests, confirmedOrders] = await Promise.all([
    ClaritySnapshot.find({
      snapshotType: 'overview',
      snapshotDate: { $gte: period.start, $lte: period.end },
    }).sort({ snapshotDate: 1 }).lean(),
    countQuoteRequests(period.start, period.end),
    Task.countDocuments({
      createdAt: { $gte: period.start, $lte: period.end },
      paymentStatus: { $in: PAID_TASK_STATUSES },
      taskStatus: { $ne: 'Cancelled' },
    }),
  ]);

  const counts = {
    visitors: 0,
    pageEngagements: 0,
    quoteRequests,
    confirmedOrders,
  };

  for (const snapshot of overviewSnapshots) {
    const day = extractEngagedSessions(snapshot.data);
    counts.visitors += day.visitors;
    counts.pageEngagements += day.pageEngagements;
  }

  const { steps, overallConversion } = buildFunnelSteps(counts);

  return {
    period: {
      preset: period.preset,
      startDate: toDateString(period.start),
      endDate: toDateString(period.end),
    },
    snapshotCoverage: {
      daysInPeriod: overviewSnapshots.length,
      note: overviewSnapshots.length === 0
        ? 'Visitor and engagement stages need Clarity snapshots for this period.'
        : undefined,
    },
    funnel: steps,
    overallConversion,
    dataSources: {
      visitors: 'Clarity overview snapshots — distinctUserCount (summed per day)',
      pageEngagements: 'Clarity overview snapshots — sessions minus quick-back sessions with active time',
      quoteRequests: 'QuotationRequest collection',
      confirmedOrders: 'Task collection — paid bookings created in period',
    },
  };
}

module.exports = {
  getConversionFunnel,
};
