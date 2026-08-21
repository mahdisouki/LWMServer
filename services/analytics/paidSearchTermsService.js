/**
 * Paid Google Ads search terms with attributed conversion value (revenue).
 *
 * Reads Google Ads `search_term_view` for the selected period.
 * Relies on existing click conversion uploads (gclid + GBP value) already
 * attributed by Google Ads — this service only reports them.
 */
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { resolvePeriod, getPeriodLabels } = require('../../utils/analyticsDateRange');

const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clampLimit(limit) {
  return Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function getCustomerId() {
  return String(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
}

function assertGoogleAdsReportingConfig() {
  const missing = [];
  if (!process.env.GOOGLE_ADS_CLIENT_ID) missing.push('GOOGLE_ADS_CLIENT_ID');
  if (!process.env.GOOGLE_ADS_CLIENT_SECRET) missing.push('GOOGLE_ADS_CLIENT_SECRET');
  if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) missing.push('GOOGLE_ADS_REFRESH_TOKEN');
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) missing.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!getCustomerId()) missing.push('GOOGLE_ADS_CUSTOMER_ID');
  if (missing.length) {
    throw new Error(`Google Ads reporting not configured: ${missing.join(', ')}`);
  }
}

async function getAccessToken() {
  assertGoogleAdsReportingConfig();

  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_ADS_CLIENT_ID,
    process.env.GOOGLE_ADS_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN });
  const response = await oauth2Client.getAccessToken();
  if (!response?.token) {
    throw new Error('Failed to obtain Google Ads access token');
  }
  return response.token;
}

function buildSearchHeaders(accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };

  const loginCustomerId = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  return headers;
}

function escapeGaqlDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid Google Ads date: ${value}`);
  }
  return value;
}

function buildSearchTermQuery({ startDate, endDate, limit }) {
  const start = escapeGaqlDate(startDate);
  const end = escapeGaqlDate(endDate);
  const rowLimit = clampLimit(limit);

  // Filter by segments.date without selecting it so metrics aggregate over the period.
  return `
SELECT
  search_term_view.search_term,
  metrics.clicks,
  metrics.impressions,
  metrics.conversions,
  metrics.conversions_value,
  metrics.cost_micros
FROM search_term_view
WHERE segments.date BETWEEN '${start}' AND '${end}'
  AND metrics.conversions_value > 0
ORDER BY metrics.clicks DESC
LIMIT ${rowLimit}
`.trim();
}

function mapSearchTermRow(result) {
  const searchTerm = result?.searchTermView?.searchTerm
    || result?.search_term_view?.search_term
    || '';
  const metrics = result?.metrics || {};

  const clicks = Number(metrics.clicks || 0);
  const impressions = Number(metrics.impressions || 0);
  const conversions = Number(metrics.conversions || 0);
  const revenue = roundMoney(metrics.conversionsValue ?? metrics.conversions_value ?? 0);
  const costMicros = Number(metrics.costMicros ?? metrics.cost_micros ?? 0);

  return {
    keyword: String(searchTerm).trim(),
    impressions,
    clicks,
    conversions: Math.round(conversions * 100) / 100,
    revenue,
    spend: roundMoney(costMicros / 1e6),
    attribution: 'paid',
  };
}

async function searchGoogleAds(query) {
  const customerId = getCustomerId();
  const accessToken = await getAccessToken();
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`;

  const rows = [];
  let pageToken;

  do {
    const body = { query };
    if (pageToken) {
      body.pageToken = pageToken;
    }

    let data;
    try {
      const response = await axios.post(url, body, {
        headers: buildSearchHeaders(accessToken),
      });
      data = response.data;
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      throw new Error(
        `Google Ads search_term_view failed (${GOOGLE_ADS_API_VERSION}, HTTP ${status || 'n/a'}): ${detail}`,
      );
    }

    for (const result of data.results || []) {
      const mapped = mapSearchTermRow(result);
      if (mapped.keyword) {
        rows.push(mapped);
      }
    }

    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return rows;
}

/**
 * Top paid search terms by attributed conversion value for the period.
 */
async function getPaidSearchTerms({
  preset,
  startDate,
  endDate,
  limit = DEFAULT_LIMIT,
} = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });
  const labels = getPeriodLabels(period);
  const rowLimit = clampLimit(limit);

  const query = buildSearchTermQuery({
    startDate: labels.startDate,
    endDate: labels.endDate,
    limit: rowLimit,
  });

  const keywords = await searchGoogleAds(query);

  const totals = keywords.reduce(
    (acc, row) => {
      acc.clicks += row.clicks;
      acc.conversions += row.conversions;
      acc.revenue += row.revenue;
      acc.spend += row.spend;
      return acc;
    },
    { clicks: 0, conversions: 0, revenue: 0, spend: 0 },
  );

  return {
    period: {
      preset: period.preset,
      ...labels,
    },
    keywords,
    totals: {
      clicks: totals.clicks,
      conversions: Math.round(totals.conversions * 100) / 100,
      revenue: roundMoney(totals.revenue),
      spend: roundMoney(totals.spend),
      uniqueTerms: keywords.length,
    },
    meta: {
      limit: rowLimit,
      count: keywords.length,
      source: 'google_ads_search_term_view',
      attribution: 'paid',
    },
    dataSources: {
      keywords:
        'Google Ads search_term_view — search terms with conversions_value > 0 for the selected period',
      revenue:
        'metrics.conversions_value (GBP) attributed by Google Ads from uploaded purchase conversions (gclid)',
    },
  };
}

module.exports = {
  getPaidSearchTerms,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
