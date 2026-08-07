const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const { isGscEnabled, getGscSiteUrl } = require('../../config/seoConfig');

async function getSearchConsoleClient() {
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
  return google.searchconsole({ version: 'v1', auth: oauth2Client });
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

module.exports = {
  fetchTopQueries,
  fetchTopPages,
  fetchSiteSummary,
};
