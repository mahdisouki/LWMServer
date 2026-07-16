const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const { isGscEnabled, getGscSiteUrl } = require('../config/seoConfig');
const { resolvePeriod, getPeriodLabels } = require('../utils/analyticsDateRange');

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

/**
 * Live Top Search Keywords from Google Search Console.
 * keyword + impressions + clicks + ctr + position.
 */
async function getTopSearchKeywords({
  preset,
  startDate,
  endDate,
  limit = 10,
} = {}) {
  if (!isGscEnabled()) {
    throw new Error('Google Search Console is not enabled (set SEO_GSC_ENABLED=true)');
  }

  const rowLimit = Number(limit);
  if (!Number.isFinite(rowLimit) || rowLimit <= 0) {
    throw new Error('limit must be a positive number');
  }

  const period = resolvePeriod({ preset, startDate, endDate });
  const labels = getPeriodLabels(period);
  const siteUrl = getGscSiteUrl();

  const searchconsole = await getSearchConsoleClient();
  const { data } = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: labels.startDate,
      endDate: labels.endDate,
      dimensions: ['query'],
      rowLimit: Math.min(rowLimit, 25000),
    },
  });

  const keywords = (data.rows || [])
    .map((row) => ({
      keyword: row.keys[0],
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: Math.round(row.ctr * 10000) / 100,
      position: Math.round(row.position * 10) / 10,
    }))
    .sort((a, b) => b.impressions - a.impressions);

  return {
    keywords,
    meta: {
      limit: rowLimit,
      count: keywords.length,
      periodDays: Math.round(
        (new Date(labels.endDate) - new Date(labels.startDate)) / 86400000,
      ) + 1,
      source: 'gsc',
      preset: period.preset,
      startDate: labels.startDate,
      endDate: labels.endDate,
    },
  };
}

module.exports = {
  getTopSearchKeywords,
};
