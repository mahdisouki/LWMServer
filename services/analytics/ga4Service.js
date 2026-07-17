const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const { isGa4Enabled, getGa4PropertyId } = require('../../config/ga4Config');
const { eachDayKeyInPeriod } = require('../../utils/analyticsDateRange');

function parseMetricInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function formatGa4Date(yyyymmdd) {
  if (!yyyymmdd || String(yyyymmdd).length !== 8) {
    return '';
  }
  const raw = String(yyyymmdd);
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function getUrlPathname(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== 'string') {
    return '';
  }
  try {
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      return new URL(urlOrPath).pathname;
    }
  } catch {
    // fall through
  }
  return urlOrPath.split('?')[0] || '';
}

function pathMatchesPatterns(pathname, patterns = []) {
  if (!patterns?.length) {
    return true;
  }
  return patterns.some((pattern) => new RegExp(pattern, 'i').test(pathname));
}

function emptyTraffic() {
  return { pageViews: 0, sessions: 0, users: 0 };
}

async function getGa4AuthClient() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GA4_REFRESH_TOKEN
    || process.env.SEO_GSC_REFRESH_TOKEN
    || process.env.GOOGLE_ADS_REFRESH_TOKEN
    || process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth credentials not configured for GA4');
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

async function getAnalyticsDataClient() {
  const auth = await getGa4AuthClient();
  return google.analyticsdata({ version: 'v1beta', auth });
}

async function runReport({ startKey, endKey, dimensions = [], metrics = [] }) {
  if (!isGa4Enabled()) {
    return null;
  }

  const propertyId = getGa4PropertyId();
  const analyticsdata = await getAnalyticsDataClient();
  const { data } = await analyticsdata.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: startKey, endDate: endKey }],
      dimensions,
      metrics,
      keepEmptyRows: false,
    },
  });

  return data;
}

function sumMetricRows(rows = [], metricIndexes) {
  const totals = emptyTraffic();
  for (const row of rows) {
    const values = row.metricValues || [];
    totals.pageViews += parseMetricInt(values[metricIndexes.pageViews]?.value);
    totals.sessions += parseMetricInt(values[metricIndexes.sessions]?.value);
    totals.users += parseMetricInt(values[metricIndexes.users]?.value);
  }
  return totals;
}

/**
 * Site-wide totals for a period.
 * `users` is GA4 totalUsers for the whole range (true unique users, not summed daily).
 */
async function fetchPeriodTraffic({ startKey, endKey }) {
  if (!isGa4Enabled()) {
    return null;
  }

  try {
    const data = await runReport({
      startKey,
      endKey,
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessions' },
        { name: 'totalUsers' },
      ],
    });

    const row = data?.rows?.[0];
    if (!row) {
      return { ...emptyTraffic(), available: true };
    }

    const values = row.metricValues || [];
    return {
      pageViews: parseMetricInt(values[0]?.value),
      sessions: parseMetricInt(values[1]?.value),
      users: parseMetricInt(values[2]?.value),
      available: true,
    };
  } catch (error) {
    console.error('[GA4] fetchPeriodTraffic failed:', error.message);
    return null;
  }
}

/**
 * Daily site-wide traffic keyed by YYYY-MM-DD.
 */
async function fetchDailyTraffic({ startKey, endKey }) {
  if (!isGa4Enabled()) {
    return null;
  }

  try {
    const data = await runReport({
      startKey,
      endKey,
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessions' },
        { name: 'totalUsers' },
      ],
    });

    const byDate = new Map();
    for (const dayKey of eachDayKeyInPeriod(
      new Date(`${startKey}T00:00:00.000Z`),
      new Date(`${endKey}T00:00:00.000Z`),
      { startKey, endKey },
    )) {
      byDate.set(dayKey, emptyTraffic());
    }

    for (const row of data?.rows || []) {
      const dateKey = formatGa4Date(row.dimensionValues?.[0]?.value);
      if (!dateKey || !byDate.has(dateKey)) {
        continue;
      }
      const values = row.metricValues || [];
      byDate.set(dateKey, {
        pageViews: parseMetricInt(values[0]?.value),
        sessions: parseMetricInt(values[1]?.value),
        users: parseMetricInt(values[2]?.value),
      });
    }

    return { byDate, available: true };
  } catch (error) {
    console.error('[GA4] fetchDailyTraffic failed:', error.message);
    return null;
  }
}

/**
 * Period traffic for URLs matching pageViewPatterns / pathPatterns.
 */
async function fetchPeriodTrafficForPageFilter({ startKey, endKey, pageFilter }) {
  if (!isGa4Enabled()) {
    return null;
  }

  if (!pageFilter || pageFilter.id === 'all') {
    return fetchPeriodTraffic({ startKey, endKey });
  }

  const patterns = pageFilter.pageViewPatterns?.length
    ? pageFilter.pageViewPatterns
    : pageFilter.pathPatterns;

  try {
    const data = await runReport({
      startKey,
      endKey,
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessions' },
        { name: 'totalUsers' },
      ],
    });

    const matchingRows = (data?.rows || []).filter((row) => {
      const pathname = getUrlPathname(row.dimensionValues?.[0]?.value || '');
      return pathMatchesPatterns(pathname, patterns);
    });

    return {
      ...sumMetricRows(matchingRows, { pageViews: 0, sessions: 1, users: 2 }),
      available: true,
    };
  } catch (error) {
    console.error('[GA4] fetchPeriodTrafficForPageFilter failed:', error.message);
    return null;
  }
}

/**
 * Daily sessions/pageViews trend for dashboard (site-wide or filtered page).
 */
async function fetchSessionsTrend({ startKey, endKey, pageFilter }) {
  if (!isGa4Enabled()) {
    return null;
  }

  if (!pageFilter || pageFilter.id === 'all') {
    const daily = await fetchDailyTraffic({ startKey, endKey });
    if (!daily) {
      return null;
    }
    return {
      available: true,
      trend: Array.from(daily.byDate.entries()).map(([date, metrics]) => ({
        date,
        sessions: metrics.sessions,
        pageViews: metrics.pageViews,
        users: metrics.users,
      })),
    };
  }

  const patterns = pageFilter.pageViewPatterns?.length
    ? pageFilter.pageViewPatterns
    : pageFilter.pathPatterns;

  try {
    const data = await runReport({
      startKey,
      endKey,
      dimensions: [{ name: 'date' }, { name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessions' },
        { name: 'totalUsers' },
      ],
    });

    const byDate = new Map();
    for (const dayKey of eachDayKeyInPeriod(
      new Date(`${startKey}T00:00:00.000Z`),
      new Date(`${endKey}T00:00:00.000Z`),
      { startKey, endKey },
    )) {
      byDate.set(dayKey, emptyTraffic());
    }

    for (const row of data?.rows || []) {
      const dateKey = formatGa4Date(row.dimensionValues?.[0]?.value);
      const pathname = getUrlPathname(row.dimensionValues?.[1]?.value || '');
      if (!dateKey || !byDate.has(dateKey) || !pathMatchesPatterns(pathname, patterns)) {
        continue;
      }
      const values = row.metricValues || [];
      const existing = byDate.get(dateKey);
      existing.pageViews += parseMetricInt(values[0]?.value);
      existing.sessions += parseMetricInt(values[1]?.value);
      existing.users += parseMetricInt(values[2]?.value);
    }

    return {
      available: true,
      trend: Array.from(byDate.entries()).map(([date, metrics]) => ({
        date,
        sessions: metrics.sessions,
        pageViews: metrics.pageViews,
        users: metrics.users,
      })),
    };
  } catch (error) {
    console.error('[GA4] fetchSessionsTrend failed:', error.message);
    return null;
  }
}

/**
 * Page Performance style rows: views/sessions per configured landing page filter.
 */
async function fetchPagePerformanceViews({ startKey, endKey, pageFilters = [] }) {
  if (!isGa4Enabled()) {
    return null;
  }

  try {
    const data = await runReport({
      startKey,
      endKey,
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessions' },
      ],
    });

    const byPageId = {};
    for (const pageFilter of pageFilters) {
      byPageId[pageFilter.id] = { views: 0, sessions: 0 };
    }

    for (const row of data?.rows || []) {
      const pathname = getUrlPathname(row.dimensionValues?.[0]?.value || '');
      const views = parseMetricInt(row.metricValues?.[0]?.value);
      const sessions = parseMetricInt(row.metricValues?.[1]?.value);

      for (const pageFilter of pageFilters) {
        const patterns = pageFilter.pageViewPatterns?.length
          ? pageFilter.pageViewPatterns
          : pageFilter.pathPatterns;
        if (!pathMatchesPatterns(pathname, patterns)) {
          continue;
        }
        byPageId[pageFilter.id].views += views;
        byPageId[pageFilter.id].sessions += sessions;
      }
    }

    return { byPageId, available: true };
  } catch (error) {
    console.error('[GA4] fetchPagePerformanceViews failed:', error.message);
    return null;
  }
}

module.exports = {
  isGa4Enabled,
  fetchPeriodTraffic,
  fetchDailyTraffic,
  fetchPeriodTrafficForPageFilter,
  fetchSessionsTrend,
  fetchPagePerformanceViews,
};
