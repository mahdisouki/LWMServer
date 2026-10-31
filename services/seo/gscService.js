const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const { isGscEnabled, getGscSiteUrl } = require('../../config/seoConfig');

function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.SEO_GSC_REFRESH_TOKEN
    || process.env.GOOGLE_ADS_REFRESH_TOKEN
    || process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth credentials not configured for Search Console');
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

async function getSearchConsoleClient() {
  return google.searchconsole({ version: 'v1', auth: getGoogleOAuthClient() });
}

async function fetchTopQueries(days = 28, rowLimit = 1000) {
  if (!isGscEnabled()) {
    return [];
  }

  const siteUrl = getGscSiteUrl();
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const searchconsole = await getSearchConsoleClient();
  const { data } = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      dimensions: ['query'],
      rowLimit: Math.min(rowLimit, 25000),
    },
  });

  return (data.rows || []).map((row) => ({
    keyword: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    position: Math.round(row.position * 10) / 10,
    ctr: Math.round(row.ctr * 10000) / 100,
    volume: row.impressions,
    keywordDifficulty: null,
    intent: 'unknown',
    isSuggestion: true,
    source: 'gsc',
  }));
}

async function fetchSiteSummary(days = 28) {
  if (!isGscEnabled()) {
    return null;
  }

  const siteUrl = getGscSiteUrl();
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const searchconsole = await getSearchConsoleClient();
  const { data } = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    },
  });

  const row = data.rows?.[0];
  if (!row) {
    return {
      clicks28d: 0,
      impressions28d: 0,
      avgPosition: null,
      ctr: null,
      periodDays: days,
    };
  }

  return {
    clicks28d: row.clicks ?? 0,
    impressions28d: row.impressions ?? 0,
    avgPosition: row.position != null ? Math.round(row.position * 10) / 10 : null,
    ctr: row.ctr != null ? Math.round(row.ctr * 10000) / 100 : null,
    periodDays: days,
  };
}

async function fetchTopPages(days = 28, rowLimit = 5000) {
  if (!isGscEnabled()) {
    return [];
  }

  const siteUrl = getGscSiteUrl();
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const searchconsole = await getSearchConsoleClient();
  const { data } = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      dimensions: ['page'],
      rowLimit: Math.min(rowLimit, 25000),
    },
  });

  return (data.rows || []).map((row) => ({
    url: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    position: Math.round(row.position * 10) / 10,
    ctr: Math.round(row.ctr * 10000) / 100,
  }));
}

async function inspectUrl(inspectionUrl) {
  if (!isGscEnabled()) {
    const err = new Error('Google Search Console is not enabled (set SEO_GSC_ENABLED=true)');
    err.statusCode = 503;
    throw err;
  }

  const searchconsole = await getSearchConsoleClient();
  const { data } = await searchconsole.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl,
      siteUrl: getGscSiteUrl(),
      languageCode: 'en-GB',
    },
  });

  const indexStatus = data.inspectionResult?.indexStatusResult;
  if (!indexStatus) {
    const err = new Error('URL Inspection returned no indexStatusResult');
    err.statusCode = 502;
    throw err;
  }

  return {
    verdict: indexStatus.verdict || null,
    coverageState: indexStatus.coverageState || null,
    indexingState: indexStatus.indexingState || null,
    robotsTxtState: indexStatus.robotsTxtState || null,
    pageFetchState: indexStatus.pageFetchState || null,
    lastCrawlTime: indexStatus.lastCrawlTime || null,
    googleCanonical: indexStatus.googleCanonical || null,
    userCanonical: indexStatus.userCanonical || null,
    inspectionResultLink: data.inspectionResult?.inspectionResultLink || null,
  };
}

function googleApiErrorMessage(error) {
  return error?.response?.data?.error?.message
    || error?.errors?.[0]?.message
    || error?.message
    || 'Google request failed';
}

/**
 * Ask Google to crawl a URL via the Indexing API.
 * Google only accepts this for pages with JobPosting or BroadcastEvent markup.
 */
async function requestIndexing(url) {
  if (!isGscEnabled()) {
    const err = new Error('Google Search Console is not enabled (set SEO_GSC_ENABLED=true)');
    err.statusCode = 503;
    throw err;
  }

  const indexing = google.indexing({ version: 'v3', auth: getGoogleOAuthClient() });
  try {
    const { data } = await indexing.urlNotifications.publish({
      requestBody: {
        url,
        type: 'URL_UPDATED',
      },
    });
    return {
      url: data?.urlNotificationMetadata?.url || url,
      notifyTime: data?.urlNotificationMetadata?.latestUpdate?.notifyTime || new Date().toISOString(),
    };
  } catch (error) {
    const err = new Error(googleApiErrorMessage(error));
    const status = Number(error?.response?.status || error?.code);
    err.statusCode = Number.isFinite(status) && status >= 400 && status < 600 ? status : 502;
    if (err.statusCode === 403) {
      err.message = `${err.message}. The Indexing API only accepts job-posting and livestream pages, and the Google account needs the indexing scope.`;
    }
    throw err;
  }
}

module.exports = {
  fetchTopQueries,
  fetchTopPages,
  fetchSiteSummary,
  inspectUrl,
  requestIndexing,
};
