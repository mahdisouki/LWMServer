const ClaritySnapshot = require('../../models/ClaritySnapshot');
const { PAGE_FILTERS } = require('../../config/analyticsPageMap');
const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels } = require('../../utils/analyticsDateRange');
const { isGa4Enabled } = require('../../config/ga4Config');
const {
  findMetric,
  parseIntSafe,
  parseFloatSafe,
  normalizeUrl,
  urlMatchesPageFilter,
  formatDuration,
  estimatePageViews,
  parsePagesPerSession,
} = require('../../utils/clarityMetricsParser');
const { fetchPagePerformanceViews } = require('./ga4Service');

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
    const rowViews = estimatePageViews(sessions, parsePagesPerSession(row));
    const engagementRow = engagementByUrl.get(url);
    const quickbackRow = quickbackByUrl.get(url);

    for (const pageFilter of TABLE_PAGES) {
      if (!urlMatchesPageFilter(url, pageFilter)) {
        continue;
      }

      const bucket = accumulator[pageFilter.id];
      bucket.views += rowViews;
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

  const [snapshots, ga4Views] = await Promise.all([
    ClaritySnapshot.find({
      snapshotType: 'top_pages',
      snapshotDate: { $gte: period.start, $lte: period.end },
    }).sort({ snapshotDate: 1 }).lean(),
    isGa4Enabled()
      ? fetchPagePerformanceViews({
        startKey: period.startKey,
        endKey: period.endKey,
        pageFilters: TABLE_PAGES,
      })
      : Promise.resolve(null),
  ]);

  const accumulator = createAccumulator();
  for (const snapshot of snapshots) {
    accumulateTopPagesSnapshot(accumulator, snapshot.data);
  }

  const viewsFromGa4 = Boolean(ga4Views?.available);
  if (viewsFromGa4) {
    for (const pageFilter of TABLE_PAGES) {
      const ga4 = ga4Views.byPageId[pageFilter.id];
      if (!ga4) {
        continue;
      }
      accumulator[pageFilter.id].views = ga4.views;
      // Keep Clarity sessions for weighting avg time / quick exit when available;
      // if Clarity has no sessions, fall back to GA4 sessions for weighting.
      if (!accumulator[pageFilter.id].sessions && ga4.sessions) {
        accumulator[pageFilter.id].sessions = ga4.sessions;
      }
    }
  }

  const rows = buildRows(accumulator);

  let coverageNote;
  if (viewsFromGa4) {
    coverageNote = undefined;
  } else if (snapshots.length === 0) {
    coverageNote = 'No page snapshots for this period. Enable GA4 for trusted page views.';
  } else if (isGa4Enabled()) {
    coverageNote = 'GA4 unavailable; page views use Clarity fallback.';
  }

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: snapshots.length,
      note: coverageNote,
      trafficSource: viewsFromGa4 ? 'ga4' : 'clarity',
    },
    columns: ['page', 'views', 'avgTime', 'quickExitPercent'],
    rows,
    dataSources: {
      views: viewsFromGa4
        ? 'Google Analytics 4 — screenPageViews on landing page paths'
        : 'Clarity top_pages snapshots — landing-page views only (sessions × pages per session), summed for the period',
      avgTime: 'Clarity top_pages snapshots — active time per URL',
      quickExitPercent: 'Clarity top_pages snapshots — quick-back % (proxy for bounce)',
    },
    omittedColumns: {
      quotes: 'Not available per page — quote submissions are not attributed to individual URLs',
      conversionRate: 'Requires per-page quote attribution',
    },
  };
}

module.exports = {
  getPagePerformance,
};
