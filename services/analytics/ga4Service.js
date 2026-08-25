const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const { isGa4Enabled, getGa4PropertyId } = require('../../config/ga4Config');
const { eachDayKeyInPeriod } = require('../../utils/analyticsDateRange');

function parseMetricInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseMetricNumber(value) {
  const n = parseFloat(value);
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
  return {
    pageViews: 0,
    sessions: 0,
    users: 0,
    engagementDuration: 0,
    avgEngagementSeconds: 0,
    engagedSessions: 0,
  };
}

function withAvgEngagement(totals) {
  const engagementDuration = totals.engagementDuration || 0;
  const sessions = totals.sessions || 0;
  return {
    ...totals,
    engagementDuration,
    avgEngagementSeconds: sessions > 0 ? engagementDuration / sessions : 0,
  };
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
    if (metricIndexes.engagementDuration != null) {
      totals.engagementDuration += parseMetricNumber(
        values[metricIndexes.engagementDuration]?.value,
      );
    }
  }
  return withAvgEngagement(totals);
}

/**
 * Site-wide totals for a period.
 * `users` is GA4 totalUsers for the whole range (true unique users, not summed daily).
 * `avgEngagementSeconds` is userEngagementDuration / sessions (avg engagement time per session).
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
        { name: 'userEngagementDuration' },
        { name: 'engagedSessions' },
      ],
    });

    const row = data?.rows?.[0];
    if (!row) {
      return { ...emptyTraffic(), available: true };
    }

    const values = row.metricValues || [];
    return {
      ...withAvgEngagement({
        pageViews: parseMetricInt(values[0]?.value),
        sessions: parseMetricInt(values[1]?.value),
        users: parseMetricInt(values[2]?.value),
        engagementDuration: parseMetricNumber(values[3]?.value),
        engagedSessions: parseMetricInt(values[4]?.value),
      }),
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
        { name: 'userEngagementDuration' },
      ],
    });

    const matchingRows = (data?.rows || []).filter((row) => {
      const pathname = getUrlPathname(row.dimensionValues?.[0]?.value || '');
      return pathMatchesPatterns(pathname, patterns);
    });

    return {
      ...sumMetricRows(matchingRows, {
        pageViews: 0,
        sessions: 1,
        users: 2,
        engagementDuration: 3,
      }),
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
 * Page Performance rows: views, engagement duration, bounce rate per configured page filter.
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
        { name: 'userEngagementDuration' },
        { name: 'bounceRate' },
      ],
    });

    const byPageId = {};
    for (const pageFilter of pageFilters) {
      byPageId[pageFilter.id] = {
        views: 0,
        sessions: 0,
        engagementDuration: 0,
        weightedBounceRate: 0,
      };
    }

    for (const row of data?.rows || []) {
      const pathname = getUrlPathname(row.dimensionValues?.[0]?.value || '');
      const views = parseMetricInt(row.metricValues?.[0]?.value);
      const sessions = parseMetricInt(row.metricValues?.[1]?.value);
      const engagementDuration = parseMetricNumber(row.metricValues?.[2]?.value);
      let bounceRate = parseMetricNumber(row.metricValues?.[3]?.value);
      // GA4 API returns bounceRate as a ratio (0–1)
      if (bounceRate > 0 && bounceRate <= 1) {
        bounceRate *= 100;
      }

      for (const pageFilter of pageFilters) {
        const patterns = pageFilter.pageViewPatterns?.length
          ? pageFilter.pageViewPatterns
          : pageFilter.pathPatterns;
        if (!pathMatchesPatterns(pathname, patterns)) {
          continue;
        }
        const bucket = byPageId[pageFilter.id];
        bucket.views += views;
        bucket.sessions += sessions;
        bucket.engagementDuration += engagementDuration;
        bucket.weightedBounceRate += bounceRate * sessions;
      }
    }

    for (const pageFilter of pageFilters) {
      const bucket = byPageId[pageFilter.id];
      const sessions = bucket.sessions || 0;
      bucket.avgEngagementSeconds = sessions > 0
        ? bucket.engagementDuration / sessions
        : 0;
      bucket.bounceRate = sessions > 0
        ? bucket.weightedBounceRate / sessions
        : 0;
    }

    return { byPageId, available: true };
  } catch (error) {
    console.error('[GA4] fetchPagePerformanceViews failed:', error.message);
    return null;
  }
}

/**
 * Every GA4 pagePath with views / engagement / bounce for Page Performance "all URLs" table.
 */
async function fetchAllPagePerformance({ startKey, endKey }) {
  if (!isGa4Enabled()) {
    return null;
  }

  try {
    const analyticsdata = await getAnalyticsDataClient();
    const propertyId = getGa4PropertyId();
    const { data } = await analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: startKey, endDate: endKey }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'sessions' },
          { name: 'userEngagementDuration' },
          { name: 'bounceRate' },
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10000,
        keepEmptyRows: false,
      },
    });

    const pages = [];
    let totalViews = 0;

    for (const row of data?.rows || []) {
      const rawPath = String(row.dimensionValues?.[0]?.value || '').trim() || '/';
      const path = getUrlPathname(rawPath) || rawPath;
      const views = parseMetricInt(row.metricValues?.[0]?.value);
      const sessions = parseMetricInt(row.metricValues?.[1]?.value);
      const engagementDuration = parseMetricNumber(row.metricValues?.[2]?.value);
      let bounceRate = parseMetricNumber(row.metricValues?.[3]?.value);
      if (bounceRate > 0 && bounceRate <= 1) {
        bounceRate *= 100;
      }

      totalViews += views;
      pages.push({
        path,
        views,
        sessions,
        avgEngagementSeconds: sessions > 0 ? engagementDuration / sessions : 0,
        bounceRate,
      });
    }

    return { pages, totalViews, available: true };
  } catch (error) {
    console.error('[GA4] fetchAllPagePerformance failed:', error.message);
    return null;
  }
}

/**
 * Sessions by GA4 deviceCategory (mobile / desktop / tablet) for a period.
 */
async function fetchSessionsByDeviceCategory({ startKey, endKey }) {
  if (!isGa4Enabled()) {
    return null;
  }

  try {
    const data = await runReport({
      startKey,
      endKey,
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }],
    });

    const sessions = {
      mobile: 0,
      desktop: 0,
      tablet: 0,
      other: 0,
    };

    for (const row of data?.rows || []) {
      const category = String(row.dimensionValues?.[0]?.value || '').trim().toLowerCase();
      const count = parseMetricInt(row.metricValues?.[0]?.value);
      if (category === 'mobile' || category === 'desktop' || category === 'tablet') {
        sessions[category] += count;
      } else {
        sessions.other += count;
      }
    }

    return { sessions, available: true };
  } catch (error) {
    console.error('[GA4] fetchSessionsByDeviceCategory failed:', error.message);
    return null;
  }
}

/**
 * Period traffic broken down by GA4 sessionDefaultChannelGroup.
 * Note: summing totalUsers across channels can exceed period unique users
 * (a user may appear in more than one channel).
 */
async function fetchTrafficByChannel({ startKey, endKey, limit = 8 } = {}) {
  if (!isGa4Enabled()) {
    return null;
  }

  const rowLimit = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 25);

  try {
    const data = await runReport({
      startKey,
      endKey,
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'engagedSessions' },
      ],
    });

    const channels = (data?.rows || [])
      .map((row) => {
        const channel = String(row.dimensionValues?.[0]?.value || '').trim() || 'Unassigned';
        const values = row.metricValues || [];
        return {
          channel,
          users: parseMetricInt(values[0]?.value),
          sessions: parseMetricInt(values[1]?.value),
          engagedSessions: parseMetricInt(values[2]?.value),
        };
      })
      .filter((row) => row.users > 0 || row.sessions > 0 || row.engagedSessions > 0)
      .sort((a, b) => b.users - a.users || b.sessions - a.sessions || a.channel.localeCompare(b.channel))
      .slice(0, rowLimit);

    return { channels, available: true };
  } catch (error) {
    console.error('[GA4] fetchTrafficByChannel failed:', error.message);
    return null;
  }
}

/**
 * Ecommerce purchases keyed by transaction_id (= Task.orderNumber) and
 * sessionDefaultChannelGroup — used to stamp Direct onto Organic orders.
 */
async function fetchPurchasesByTransaction({ startKey, endKey } = {}) {
  if (!isGa4Enabled()) {
    return null;
  }

  try {
    const propertyId = getGa4PropertyId();
    const analyticsdata = await getAnalyticsDataClient();
    const { data } = await analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: startKey, endDate: endKey }],
        dimensions: [
          { name: 'transactionId' },
          { name: 'sessionDefaultChannelGroup' },
        ],
        metrics: [
          { name: 'ecommercePurchases' },
          { name: 'purchaseRevenue' },
        ],
        orderBys: [
          { metric: { metricName: 'ecommercePurchases' }, desc: true },
        ],
        limit: 100000,
        keepEmptyRows: false,
      },
    });

    const byTransactionId = new Map();

    for (const row of data?.rows || []) {
      const transactionId = String(row.dimensionValues?.[0]?.value || '').trim();
      const channel = String(row.dimensionValues?.[1]?.value || '').trim() || 'Unassigned';
      if (!transactionId || transactionId === '(not set)') {
        continue;
      }

      const purchases = parseMetricInt(row.metricValues?.[0]?.value);
      const revenue = parseMetricNumber(row.metricValues?.[1]?.value);
      const existing = byTransactionId.get(transactionId);

      // Prefer the row with the most purchases; ties keep the first seen.
      if (!existing || purchases > existing.purchases) {
        byTransactionId.set(transactionId, {
          transactionId,
          channel,
          purchases,
          revenue,
        });
      }
    }

    return {
      available: true,
      byTransactionId,
      rows: Array.from(byTransactionId.values()),
    };
  } catch (error) {
    console.error('[GA4] fetchPurchasesByTransaction failed:', error.message);
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
  fetchAllPagePerformance,
  fetchSessionsByDeviceCategory,
  fetchTrafficByChannel,
  fetchPurchasesByTransaction,
};
