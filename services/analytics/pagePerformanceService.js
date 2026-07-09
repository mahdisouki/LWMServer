const ClaritySnapshot = require('../../models/ClaritySnapshot');
const { PAGE_FILTERS } = require('../../config/analyticsPageMap');
const { resolvePeriod } = require('./dashboardService');
const { toDateString, getPeriodLabels } = require('../../utils/analyticsDateRange');
const {
  findMetric,
  parseIntSafe,
  parseFloatSafe,
  normalizeUrl,
  urlMatchesPageFilter,
  formatDuration,
} = require('../../utils/clarityMetricsParser');

const TABLE_PAGES = PAGE_FILTERS.filter((page) => page.id !== 'all');

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function createAccumulator() {
  return TABLE_PAGES.reduce((acc, page) => {
    acc[page.id] = {
      views: 0,
      sessions: 0,
      weightedActiveTime: 0,
      weightedQuickExit: 0,
    };
    return acc;
  }, {});
}

function accumulateTopPagesSnapshot(accumulator, data) {
  const traffic = findMetric(data, 'Traffic');
  const engagement = findMetric(data, 'EngagementTime');
  const quickback = findMetric(data, 'QuickbackClick');

  const engagementByUrl = new Map();
  for (const row of engagement?.information || []) {
    engagementByUrl.set(normalizeUrl(row.Url || row.url), row);
  }

  const quickbackByUrl = new Map();
  for (const row of quickback?.information || []) {
    quickbackByUrl.set(normalizeUrl(row.Url || row.url), row);
  }

  for (const row of traffic?.information || []) {
    const url = normalizeUrl(row.Url || row.url);
    if (!url) {
      continue;
    }

    const sessions = parseIntSafe(row.totalSessionCount);
    const views = Math.round(sessions * parseFloatSafe(row.pagesPerSessionPercentage || 1));
    const engagementRow = engagementByUrl.get(url);
    const quickbackRow = quickbackByUrl.get(url);

    for (const pageFilter of TABLE_PAGES) {
      if (!urlMatchesPageFilter(url, pageFilter)) {
        continue;
      }

      const bucket = accumulator[pageFilter.id];
      bucket.views += views;
      bucket.sessions += sessions;
      bucket.weightedActiveTime += parseIntSafe(engagementRow?.activeTime) * sessions;
      bucket.weightedQuickExit += parseFloatSafe(quickbackRow?.sessionsWithMetricPercentage) * sessions;
    }
  }
}

function buildRows(accumulator) {
  return TABLE_PAGES.map((pageFilter) => {
    const bucket = accumulator[pageFilter.id];
    const avgTimeSeconds = bucket.sessions > 0
      ? Math.round(bucket.weightedActiveTime / bucket.sessions)
      : 0;
    const quickExitPercent = bucket.sessions > 0
      ? roundPercent(bucket.weightedQuickExit / bucket.sessions)
      : 0;

    return {
      id: pageFilter.id,
      label: pageFilter.label,
      path: pageFilter.pathLabel || '/',
      views: bucket.views,
      avgTimeSeconds,
      avgTimeFormatted: formatDuration(avgTimeSeconds),
      quickExitPercent,
    };
  }).sort((a, b) => b.views - a.views);
}

async function getPagePerformance({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  const snapshots = await ClaritySnapshot.find({
    snapshotType: 'top_pages',
    snapshotDate: { $gte: period.start, $lte: period.end },
  }).sort({ snapshotDate: 1 }).lean();

  const accumulator = createAccumulator();
  for (const snapshot of snapshots) {
    accumulateTopPagesSnapshot(accumulator, snapshot.data);
  }

  const rows = buildRows(accumulator);

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: snapshots.length,
      note: snapshots.length === 0
        ? 'No page snapshots for this period. Data appears as daily Clarity sync runs.'
        : undefined,
    },
    columns: ['page', 'views', 'avgTime', 'quickExitPercent'],
    rows,
    dataSources: {
      views: 'Clarity top_pages snapshots — visits per URL grouped by site section',
      avgTime: 'Clarity top_pages snapshots — active time per URL',
      quickExitPercent: 'Clarity top_pages snapshots — quick-back % (proxy for bounce)',
    },
    omittedColumns: {
      quotes: 'Not available per page until landingPage is stored on quote submissions',
      conversionRate: 'Requires per-page quote attribution',
    },
  };
}

module.exports = {
  getPagePerformance,
};
