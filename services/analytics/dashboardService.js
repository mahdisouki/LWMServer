const ClaritySnapshot = require('../../models/ClaritySnapshot');
const QuotationRequest = require('../../models/QuotationRequest');
const { getPageFilterById, pageFilterTracksQuotes } = require('../../config/analyticsPageMap');
const {
  extractOverviewDayMetrics,
  extractTopPagesDayMetrics,
  aggregateDayMetrics,
  formatDuration,
  percentChange,
} = require('../../utils/clarityMetricsParser');
const {
  toDateString,
  resolvePeriod,
  getPreviousPeriod,
  getPeriodLabels,
} = require('../../utils/analyticsDateRange');

async function countQuoteRequests(start, end) {
  return QuotationRequest.countDocuments({
    createdAt: { $gte: start, $lte: end },
  });
}

async function loadClarityMetricsForPeriod(start, end, pageFilter) {
  const [overviewSnapshots, topPagesSnapshots] = await Promise.all([
    ClaritySnapshot.find({
      snapshotType: 'overview',
      snapshotDate: { $gte: start, $lte: end },
    }).sort({ snapshotDate: 1 }).lean(),
    pageFilter.id === 'all'
      ? Promise.resolve([])
      : ClaritySnapshot.find({
        snapshotType: 'top_pages',
        snapshotDate: { $gte: start, $lte: end },
      }).sort({ snapshotDate: 1 }).lean(),
  ]);

  const dailyMetrics = [];
  const sessionsTrend = [];

  if (pageFilter.id === 'all') {
    for (const snapshot of overviewSnapshots) {
      const day = extractOverviewDayMetrics(snapshot.data, pageFilter);
      dailyMetrics.push(day);
      sessionsTrend.push({
        date: toDateString(snapshot.snapshotDate),
        sessions: day.sessions,
        pageViews: day.pageViews,
      });
    }
  } else {
    const topByDate = new Map(
      topPagesSnapshots.map((s) => [toDateString(s.snapshotDate), s]),
    );

    for (const snapshot of overviewSnapshots) {
      const dateKey = toDateString(snapshot.snapshotDate);
      const topSnapshot = topByDate.get(dateKey);
      const overviewDay = extractOverviewDayMetrics(snapshot.data, pageFilter);
      const topDay = topSnapshot
        ? extractTopPagesDayMetrics(topSnapshot.data, pageFilter)
        : {
          sessions: 0,
          pageViews: overviewDay.pageViews,
          activeTimeSeconds: 0,
          totalTimeSeconds: 0,
          botSessions: 0,
          pagesPerSession: 0,
          scrollDepth: 0,
          popularPages: overviewDay.popularPages,
        };

      const merged = {
        sessions: topDay.sessions,
        botSessions: 0,
        pageViews: topDay.pageViews || overviewDay.pageViews,
        activeTimeSeconds: topDay.activeTimeSeconds,
        totalTimeSeconds: topDay.totalTimeSeconds,
        scrollDepth: 0,
        pagesPerSession: topDay.pagesPerSession || overviewDay.pagesPerSession,
        popularPages: overviewDay.popularPages,
      };

      dailyMetrics.push(merged);
      sessionsTrend.push({
        date: dateKey,
        sessions: merged.sessions,
        pageViews: merged.pageViews,
      });
    }
  }

  return {
    aggregated: aggregateDayMetrics(dailyMetrics),
    sessionsTrend,
    snapshotDaysAvailable: overviewSnapshots.length,
  };
}

function buildMetricBlock(current, previous, { formatter = (v) => v, applicable = true } = {}) {
  if (!applicable) {
    return {
      value: null,
      formatted: null,
      changePercent: null,
      applicable: false,
    };
  }

  return {
    value: current,
    formatted: formatter(current),
    changePercent: percentChange(current, previous),
    applicable: true,
  };
}

function buildDataSources(pageFilter) {
  const claritySource = 'Clarity daily snapshots (MongoDB)';
  const quotesSource = 'QuotationRequest collection (MongoDB)';

  if (pageFilter.id === 'all') {
    return {
      totalPageViews: { source: claritySource, detail: 'Sum of PopularPages visits across all site URLs per day' },
      quoteRequests: { source: quotesSource, detail: 'All quote form submissions in the selected period' },
      avgTimeOnSite: { source: claritySource, detail: 'Site-wide average active engagement time per session' },
      conversionRate: {
        source: 'Calculated',
        detail: 'All quote requests ÷ all page views in the period',
      },
      sessionsTrend: { source: claritySource, detail: 'Daily session counts from overview snapshots' },
    };
  }

  if (pageFilterTracksQuotes(pageFilter)) {
    return {
      totalPageViews: {
        source: claritySource,
        detail: `Visits to URLs matching: ${pageFilter.label}`,
      },
      quoteRequests: { source: quotesSource, detail: 'All quote form submissions in the selected period' },
      avgTimeOnSite: {
        source: claritySource,
        detail: `Average active time on URLs matching: ${pageFilter.label}`,
      },
      conversionRate: {
        source: 'Calculated',
        detail: `Quote requests ÷ page views on ${pageFilter.label} URLs only`,
      },
      sessionsTrend: { source: claritySource, detail: 'Daily sessions for filtered URLs from top_pages snapshots' },
    };
  }

  return {
    totalPageViews: {
      source: claritySource,
      detail: `Visits to URLs matching: ${pageFilter.label}`,
    },
    quoteRequests: {
      source: null,
      detail: 'Not applicable — quote requests are only shown for All Pages or Request A Quote',
    },
    avgTimeOnSite: {
      source: claritySource,
      detail: `Average active time on URLs matching: ${pageFilter.label}`,
    },
    conversionRate: {
      source: null,
      detail: 'Not applicable — conversion is only calculated for All Pages or Request A Quote',
    },
    sessionsTrend: { source: claritySource, detail: 'Daily sessions for filtered URLs from top_pages snapshots' },
  };
}

async function getDashboard({ preset, startDate, endDate, page = 'all' } = {}) {
  const pageFilter = getPageFilterById(page);
  if (!pageFilter) {
    throw new Error(`Unknown page filter: ${page}`);
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
    currentClarity,
    previousClarity,
    currentQuotes,
    previousQuotes,
  ] = await Promise.all([
    loadClarityMetricsForPeriod(period.start, period.end, pageFilter),
    loadClarityMetricsForPeriod(previousPeriod.start, previousPeriod.end, pageFilter),
    ...quoteQueries,
  ]);

  const current = currentClarity.aggregated;
  const previous = previousClarity.aggregated;

  let conversionRate = null;
  let previousConversionRate = null;
  if (quotesApplicable && current.pageViews > 0) {
    conversionRate = Math.round((currentQuotes / current.pageViews) * 10000) / 100;
  } else if (quotesApplicable) {
    conversionRate = 0;
  }
  if (quotesApplicable && previous.pageViews > 0) {
    previousConversionRate = Math.round((previousQuotes / previous.pageViews) * 10000) / 100;
  } else if (quotesApplicable) {
    previousConversionRate = 0;
  }

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    previousPeriod: getPeriodLabels(previousPeriod),
    page: {
      id: pageFilter.id,
      label: pageFilter.label,
    },
    snapshotCoverage: {
      daysInPeriod: currentClarity.snapshotDaysAvailable,
      note: currentClarity.snapshotDaysAvailable === 0
        ? 'No Clarity snapshots for this period. Data will improve as daily sync runs.'
        : undefined,
    },
    metrics: {
      totalPageViews: buildMetricBlock(current.pageViews, previous.pageViews),
      quoteRequests: buildMetricBlock(currentQuotes, previousQuotes, { applicable: quotesApplicable }),
      avgTimeOnSite: buildMetricBlock(
        current.avgTimeOnSiteSeconds,
        previous.avgTimeOnSiteSeconds,
        { formatter: formatDuration },
      ),
      conversionRate: quotesApplicable
        ? {
          value: conversionRate,
          formatted: `${conversionRate}%`,
          changePercent: percentChange(conversionRate, previousConversionRate),
          applicable: true,
        }
        : {
          value: null,
          formatted: null,
          changePercent: null,
          applicable: false,
        },
      sessions: buildMetricBlock(current.sessions, previous.sessions),
    },
    dataSources: buildDataSources(pageFilter),
    details: {
      botSessionsExcluded: current.botSessionsExcluded,
      scrollDepthAverage: current.scrollDepthAverage,
      pagesPerSession: current.pagesPerSession,
      avgTimeOnSiteSeconds: current.avgTimeOnSiteSeconds,
      totalTimeSeconds: current.totalTimeSeconds,
    },
    sessionsTrend: currentClarity.sessionsTrend,
    topPages: current.topPages,
  };
}

module.exports = {
  getDashboard,
  resolvePeriod,
};
