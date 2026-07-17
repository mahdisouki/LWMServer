const ClaritySnapshot = require('../../models/ClaritySnapshot');
const QuotationRequest = require('../../models/QuotationRequest');
const { getPageFilterById, pageFilterTracksQuotes, getPageViewFilter } = require('../../config/analyticsPageMap');
const { isGa4Enabled } = require('../../config/ga4Config');
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
const {
  fetchPeriodTrafficForPageFilter,
  fetchSessionsTrend,
} = require('./ga4Service');

async function countQuoteRequests(start, end) {
  return QuotationRequest.countDocuments({
    createdAt: { $gte: start, $lte: end },
  });
}

async function loadClarityMetricsForPeriod(start, end, pageFilter) {
  const pageViewFilter = getPageViewFilter(pageFilter);
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
        ? extractTopPagesDayMetrics(topSnapshot.data, pageViewFilter)
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

function buildDataSources(pageFilter, { trafficFromGa4 = false } = {}) {
  const claritySource = 'Clarity daily snapshots (MongoDB)';
  const ga4Source = 'Google Analytics 4 Data API';
  const quotesSource = 'QuotationRequest collection (MongoDB)';
  const trafficSource = trafficFromGa4 ? ga4Source : claritySource;

  if (pageFilter.id === 'all') {
    return {
      totalPageViews: {
        source: trafficSource,
        detail: trafficFromGa4
          ? 'GA4 screenPageViews (site-wide)'
          : 'Sessions × pages per session from Clarity overview Traffic metric',
      },
      quoteRequests: { source: quotesSource, detail: 'All quote form submissions in the selected period' },
      avgTimeOnSite: { source: claritySource, detail: 'Site-wide average active engagement time per session' },
      conversionRate: {
        source: 'Calculated',
        detail: 'All quote requests ÷ page views in the period',
      },
      sessionsTrend: {
        source: trafficSource,
        detail: trafficFromGa4
          ? 'GA4 daily sessions and screenPageViews'
          : 'Daily session counts from Clarity overview snapshots',
      },
      sessions: {
        source: trafficSource,
        detail: trafficFromGa4 ? 'GA4 sessions' : 'Clarity totalSessionCount',
      },
    };
  }

  if (pageFilterTracksQuotes(pageFilter)) {
    return {
      totalPageViews: {
        source: trafficSource,
        detail: trafficFromGa4
          ? `GA4 screenPageViews on ${pageFilter.pathLabel}`
          : `Visits to URLs matching: ${pageFilter.label}`,
      },
      quoteRequests: {
        source: quotesSource,
        detail: 'All quote form submissions in the selected period',
      },
      avgTimeOnSite: {
        source: claritySource,
        detail: `Average active time on URLs matching: ${pageFilter.label}`,
      },
      conversionRate: {
        source: 'Calculated',
        detail: `All quote requests ÷ page views on ${pageFilter.pathLabel}`,
      },
      sessionsTrend: {
        source: trafficSource,
        detail: trafficFromGa4
          ? `GA4 daily traffic for ${pageFilter.pathLabel}`
          : 'Daily sessions for filtered URLs from Clarity top_pages snapshots',
      },
      sessions: {
        source: trafficSource,
        detail: trafficFromGa4
          ? `GA4 sessions on ${pageFilter.pathLabel}`
          : 'Clarity sessions for filtered URLs',
      },
    };
  }

  return {
    totalPageViews: {
      source: trafficSource,
      detail: trafficFromGa4
        ? `GA4 screenPageViews on ${pageFilter.pathLabel}`
        : `Visits to URLs matching: ${pageFilter.label}`,
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
    sessionsTrend: {
      source: trafficSource,
      detail: trafficFromGa4
        ? `GA4 daily traffic for ${pageFilter.pathLabel}`
        : 'Daily sessions for filtered URLs from Clarity top_pages snapshots',
    },
    sessions: {
      source: trafficSource,
      detail: trafficFromGa4
        ? `GA4 sessions on ${pageFilter.pathLabel}`
        : 'Clarity sessions for filtered URLs',
    },
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
    currentGa4,
    previousGa4,
    currentGa4Trend,
  ] = await Promise.all([
    loadClarityMetricsForPeriod(period.start, period.end, pageFilter),
    loadClarityMetricsForPeriod(previousPeriod.start, previousPeriod.end, pageFilter),
    ...quoteQueries,
    isGa4Enabled()
      ? fetchPeriodTrafficForPageFilter({
        startKey: period.startKey,
        endKey: period.endKey,
        pageFilter,
      })
      : Promise.resolve(null),
    isGa4Enabled()
      ? fetchPeriodTrafficForPageFilter({
        startKey: previousPeriod.startKey,
        endKey: previousPeriod.endKey,
        pageFilter,
      })
      : Promise.resolve(null),
    isGa4Enabled()
      ? fetchSessionsTrend({
        startKey: period.startKey,
        endKey: period.endKey,
        pageFilter,
      })
      : Promise.resolve(null),
  ]);

  const trafficFromGa4 = Boolean(currentGa4?.available);
  const currentPageViews = trafficFromGa4 ? currentGa4.pageViews : currentClarity.aggregated.pageViews;
  const previousPageViews = previousGa4?.available
    ? previousGa4.pageViews
    : previousClarity.aggregated.pageViews;
  const currentSessions = trafficFromGa4 ? currentGa4.sessions : currentClarity.aggregated.sessions;
  const previousSessions = previousGa4?.available
    ? previousGa4.sessions
    : previousClarity.aggregated.sessions;

  const current = currentClarity.aggregated;
  const previous = previousClarity.aggregated;

  let conversionRate = null;
  let previousConversionRate = null;
  if (quotesApplicable && currentPageViews > 0) {
    conversionRate = Math.round((currentQuotes / currentPageViews) * 10000) / 100;
  } else if (quotesApplicable) {
    conversionRate = 0;
  }
  if (quotesApplicable && previousPageViews > 0) {
    previousConversionRate = Math.round((previousQuotes / previousPageViews) * 10000) / 100;
  } else if (quotesApplicable) {
    previousConversionRate = 0;
  }

  const coverageDays = trafficFromGa4
    ? (currentGa4Trend?.trend?.length || 0)
    : currentClarity.snapshotDaysAvailable;

  let coverageNote;
  if (trafficFromGa4) {
    coverageNote = undefined;
  } else if (isGa4Enabled()) {
    coverageNote = 'GA4 is configured but unavailable for this request; showing Clarity fallback for traffic metrics.';
  } else if (currentClarity.snapshotDaysAvailable === 0) {
    coverageNote = 'No Clarity snapshots for this period. Set GA4_ENABLED=true and GA4_PROPERTY_ID for trusted page views / sessions / users.';
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
      daysInPeriod: coverageDays,
      note: coverageNote,
      trafficSource: trafficFromGa4 ? 'ga4' : 'clarity',
    },
    metrics: {
      totalPageViews: buildMetricBlock(currentPageViews, previousPageViews),
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
      sessions: buildMetricBlock(currentSessions, previousSessions),
      users: trafficFromGa4
        ? buildMetricBlock(
          currentGa4.users,
          previousGa4?.available ? previousGa4.users : null,
        )
        : buildMetricBlock(null, null, { applicable: false }),
    },
    dataSources: buildDataSources(pageFilter, { trafficFromGa4 }),
    details: {
      botSessionsExcluded: current.botSessionsExcluded,
      scrollDepthAverage: current.scrollDepthAverage,
      pagesPerSession: current.pagesPerSession,
      avgTimeOnSiteSeconds: current.avgTimeOnSiteSeconds,
      totalTimeSeconds: current.totalTimeSeconds,
    },
    sessionsTrend: currentGa4Trend?.available
      ? currentGa4Trend.trend
      : currentClarity.sessionsTrend,
    topPages: current.topPages,
  };
}

module.exports = {
  getDashboard,
  resolvePeriod,
};
