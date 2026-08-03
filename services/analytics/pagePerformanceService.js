const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels } = require('../../utils/analyticsDateRange');
const { isGa4Enabled } = require('../../config/ga4Config');
const { formatDuration } = require('../../utils/analyticsFormatters');
const { fetchAllPagePerformance } = require('./ga4Service');

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function pathLabel(path) {
  if (!path || path === '/') return 'Home';
  const cleaned = path.replace(/\/+$/, '') || '/';
  const segment = cleaned.split('/').filter(Boolean).pop() || cleaned;
  return segment
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildRows(pages) {
  return pages.map((page) => {
    const avgTimeSeconds = Math.round(page.avgEngagementSeconds || 0);
    return {
      id: page.path,
      label: pathLabel(page.path),
      path: page.path,
      views: page.views || 0,
      avgTimeSeconds,
      avgTimeFormatted: formatDuration(avgTimeSeconds),
      quickExitPercent: roundPercent(page.bounceRate || 0),
    };
  });
}

async function getPagePerformance({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  if (!isGa4Enabled()) {
    throw new Error('GA4 is not configured — Page Performance requires Google Analytics 4');
  }

  const ga4Pages = await fetchAllPagePerformance({
    startKey: period.startKey,
    endKey: period.endKey,
  });

  if (!ga4Pages?.available) {
    throw new Error('Failed to load page performance from Google Analytics 4');
  }

  const rows = buildRows(ga4Pages.pages || []);

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: null,
      note: undefined,
      trafficSource: 'ga4',
    },
    columns: ['page', 'views', 'avgTime', 'quickExitPercent'],
    rows,
    totals: {
      pages: rows.length,
      views: ga4Pages.totalViews || 0,
    },
    dataSources: {
      views: 'Google Analytics 4 — screenPageViews for every pagePath',
      avgTime: 'Google Analytics 4 — userEngagementDuration ÷ sessions by pagePath',
      quickExitPercent: 'Google Analytics 4 — bounceRate by pagePath',
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
