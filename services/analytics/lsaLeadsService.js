/**
 * Fetch Google Ads Local Services leads for LSA → order attribution.
 *
 * Uses the same GOOGLE_ADS_* env vars as spend / paid-search reporting.
 */
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const {
  dayKeyInTimeZone,
  addDaysToDayKey,
  startOfLabeledDay,
  ANALYTICS_TIMEZONE,
} = require('../../utils/analyticsDateRange');

const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23';

const DEFAULT_LOOKBACK_DAYS = Math.min(
  Math.max(parseInt(process.env.LSA_LEADS_LOOKBACK_DAYS, 10) || 21, 7),
  90,
);

function getCustomerId() {
  return String(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
}

function isGoogleAdsConfigured() {
  return Boolean(
    process.env.GOOGLE_ADS_CLIENT_ID
    && process.env.GOOGLE_ADS_CLIENT_SECRET
    && process.env.GOOGLE_ADS_REFRESH_TOKEN
    && process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    && getCustomerId(),
  );
}

function assertGoogleAdsConfig() {
  const missing = [];
  if (!process.env.GOOGLE_ADS_CLIENT_ID) missing.push('GOOGLE_ADS_CLIENT_ID');
  if (!process.env.GOOGLE_ADS_CLIENT_SECRET) missing.push('GOOGLE_ADS_CLIENT_SECRET');
  if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) missing.push('GOOGLE_ADS_REFRESH_TOKEN');
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) missing.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!getCustomerId()) missing.push('GOOGLE_ADS_CUSTOMER_ID');
  if (missing.length) {
    throw new Error(`Google Ads LSA leads not configured: ${missing.join(', ')}`);
  }
}

async function getAccessToken() {
  assertGoogleAdsConfig();
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

function resolveLookbackRange(lookbackDays = DEFAULT_LOOKBACK_DAYS) {
  const todayKey = dayKeyInTimeZone(new Date(), ANALYTICS_TIMEZONE);
  const endKey = todayKey;
  const startKey = addDaysToDayKey(todayKey, -(lookbackDays - 1));
  return { startKey, endKey, lookbackDays };
}

/**
 * Parse LSA creation_date_time ("YYYY-MM-DD HH:MM:SS" in Ads account TZ)
 * as Europe/London wall clock → UTC Date.
 */
function parseLsaCreationDateTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const dayKey = match[1];
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  const dayStart = startOfLabeledDay(dayKey);
  return new Date(dayStart.getTime() + (((hours * 60) + minutes) * 60 + seconds) * 1000);
}

function pickContactDetails(lead) {
  const details =
    lead?.contactDetails
    || lead?.contact_details
    || {};
  return {
    phone:
      details.phoneNumber
      || details.phone_number
      || null,
    email:
      details.email
      || null,
  };
}

function normalizeLeadRow(result) {
  const lead = result?.localServicesLead || result?.local_services_lead || {};
  const id = lead.id != null ? String(lead.id) : null;
  const createdAt = parseLsaCreationDateTime(
    lead.creationDateTime || lead.creation_date_time,
  );
  const { phone, email } = pickContactDetails(lead);
  const status = lead.leadStatus || lead.lead_status || null;
  const leadType = lead.leadType || lead.lead_type || null;

  return {
    id,
    createdAt,
    phone: phone ? String(phone).trim() : null,
    email: email ? String(email).trim() : null,
    status,
    leadType,
  };
}

function buildLeadsQuery({ startKey, endKey }) {
  return `
SELECT
  local_services_lead.id,
  local_services_lead.lead_type,
  local_services_lead.lead_status,
  local_services_lead.creation_date_time,
  local_services_lead.contact_details
FROM local_services_lead
WHERE local_services_lead.creation_date_time >= '${startKey} 00:00:00'
  AND local_services_lead.creation_date_time <= '${endKey} 23:59:59'
  AND local_services_lead.lead_status != 'WIPED_OUT'
`.trim();
}

/**
 * @returns {{ available: boolean, reason?: string, startKey: string, endKey: string, lookbackDays: number, leads: Array }}
 */
async function fetchLsaLeads({ lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const { startKey, endKey, lookbackDays: days } = resolveLookbackRange(lookbackDays);

  if (!isGoogleAdsConfigured()) {
    return {
      available: false,
      reason: 'GOOGLE_ADS_NOT_CONFIGURED',
      startKey,
      endKey,
      lookbackDays: days,
      leads: [],
    };
  }

  try {
    const accessToken = await getAccessToken();
    const customerId = getCustomerId();
    const query = buildLeadsQuery({ startKey, endKey });
    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`;

    const leads = [];
    let pageToken;

    do {
      const body = { query };
      if (pageToken) body.pageToken = pageToken;

      const { data } = await axios.post(url, body, {
        headers: buildSearchHeaders(accessToken),
      });

      for (const result of data.results || []) {
        const normalized = normalizeLeadRow(result);
        if (!normalized.id || !normalized.createdAt) continue;
        if (!normalized.phone && !normalized.email) continue;
        leads.push(normalized);
      }

      pageToken = data.nextPageToken || null;
    } while (pageToken);

    leads.sort((a, b) => a.createdAt - b.createdAt);

    return {
      available: true,
      startKey,
      endKey,
      lookbackDays: days,
      leads,
    };
  } catch (error) {
    const message =
      error?.response?.data?.error?.message
      || error?.message
      || 'Unknown Google Ads error';
    console.error('[LSA Leads] Fetch failed:', message);
    return {
      available: false,
      reason: 'GOOGLE_ADS_UNAVAILABLE',
      error: message,
      startKey,
      endKey,
      lookbackDays: days,
      leads: [],
    };
  }
}

module.exports = {
  DEFAULT_LOOKBACK_DAYS,
  isGoogleAdsConfigured,
  resolveLookbackRange,
  parseLsaCreationDateTime,
  fetchLsaLeads,
};
