/**
 * Daily ads spend by platform for Traffic Overview.
 *
 * Platforms:
 *   - Google Ads — GAQL customer cost_micros by day
 *   - Microsoft Ads — AccountPerformanceReport (Daily Spend)
 *   - Meta — Marketing API ad-account insights (Facebook + Instagram combined)
 *
 * Env (Meta — do not reuse Instagram Graph posting token):
 *   META_ADS_ACCESS_TOKEN
 *   META_ADS_ACCOUNT_ID  (with or without "act_" prefix)
 *
 * Fail-soft: each platform returns an empty map on config/API errors so
 * Traffic Overview still loads when one ads API is unavailable.
 */
const axios = require('axios');
const { inflateRawSync } = require('zlib');
const { OAuth2Client } = require('google-auth-library');
const {
  getAccessToken: getMicrosoftAccessToken,
} = require('../microsoftAdsConversionService');

const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23';
const META_GRAPH_VERSION = process.env.META_ADS_API_VERSION || 'v21.0';
const MS_REPORTING_URL =
  'https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc';
const MS_NS = 'https://bingads.microsoft.com/Reporting/v13';

const PLATFORM_LABELS = {
  google: 'Google Ads',
  microsoft: 'Microsoft Ads',
  meta: 'Meta',
};

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function emptyDailyMap() {
  return new Map();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseIsoDateParts(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  return { year, month, day };
}

/** Minimal ZIP reader for Microsoft report downloads (single deflated CSV). */
function unzipFirstTextFile(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Microsoft Ads report download is not a ZIP archive');
  }

  const compression = buf.readUInt16LE(8);
  let compressedSize = buf.readUInt32LE(18);
  const fileNameLength = buf.readUInt16LE(26);
  const extraLength = buf.readUInt16LE(28);
  const dataStart = 30 + fileNameLength + extraLength;

  if (compressedSize === 0) {
    // Data descriptor / unknown size: take rest of archive before central directory.
    const central = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
    compressedSize = (central === -1 ? buf.length : central) - dataStart;
  }

  const compressed = buf.subarray(dataStart, dataStart + compressedSize);
  if (compression === 0) {
    return compressed.toString('utf8');
  }
  if (compression === 8) {
    return inflateRawSync(compressed).toString('utf8');
  }
  throw new Error(`Unsupported ZIP compression method: ${compression}`);
}

function parseCsvRows(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Skip Microsoft report preamble until the header row with TimePeriod/Spend.
  let headerIndex = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return lower.includes('timeperiod') || lower.includes('time period');
  });
  if (headerIndex < 0) {
    headerIndex = lines.findIndex((line) => line.toLowerCase().includes('spend'));
  }
  if (headerIndex < 0) {
    return [];
  }

  const headers = lines[headerIndex].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^©|^©|microsoft advertising|dynamic column|©/i.test(line)) break;
    if (/^"?AccountName"?$/i.test(line)) break;
    if (line.startsWith('"©') || line.toLowerCase().includes('microsoft corporation')) break;

    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < headers.length) continue;
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx];
    });
    rows.push(row);
  }
  return rows;
}

function normalizeSpendDate(raw) {
  const value = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // Microsoft sometimes returns M/D/YYYY
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const month = String(us[1]).padStart(2, '0');
    const day = String(us[2]).padStart(2, '0');
    return `${us[3]}-${month}-${day}`;
  }
  return null;
}

// ─── Google Ads ─────────────────────────────────────────────────────────────

function getGoogleCustomerId() {
  return String(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
}

function assertGoogleAdsConfig() {
  const missing = [];
  if (!process.env.GOOGLE_ADS_CLIENT_ID) missing.push('GOOGLE_ADS_CLIENT_ID');
  if (!process.env.GOOGLE_ADS_CLIENT_SECRET) missing.push('GOOGLE_ADS_CLIENT_SECRET');
  if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) missing.push('GOOGLE_ADS_REFRESH_TOKEN');
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) missing.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!getGoogleCustomerId()) missing.push('GOOGLE_ADS_CUSTOMER_ID');
  if (missing.length) {
    throw new Error(`Google Ads spend not configured: ${missing.join(', ')}`);
  }
}

async function getGoogleAccessToken() {
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

function buildGoogleSearchHeaders(accessToken) {
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

async function fetchGoogleDailySpend({ startDate, endDate }) {
  assertGoogleAdsConfig();
  const customerId = getGoogleCustomerId();
  const accessToken = await getGoogleAccessToken();
  const query = `
SELECT
  segments.date,
  metrics.cost_micros
FROM customer
WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
`.trim();

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  const byDate = emptyDailyMap();
  let pageToken;

  do {
    const body = { query };
    if (pageToken) body.pageToken = pageToken;

    const { data } = await axios.post(url, body, {
      headers: buildGoogleSearchHeaders(accessToken),
    });

    for (const result of data.results || []) {
      const date =
        result?.segments?.date
        || result?.segments?.Date
        || null;
      const metrics = result?.metrics || {};
      const costMicros = Number(metrics.costMicros ?? metrics.cost_micros ?? 0);
      if (!date) continue;
      const prev = byDate.get(date) || 0;
      byDate.set(date, roundMoney(prev + costMicros / 1e6));
    }

    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return byDate;
}

// ─── Microsoft Ads ──────────────────────────────────────────────────────────

function getMicrosoftAccountId() {
  return String(process.env.MICROSOFT_ADS_ACCOUNT_ID || '').trim();
}

function getMicrosoftCustomerId() {
  return String(process.env.MICROSOFT_ADS_CUSTOMER_ID || '').trim();
}

function getMicrosoftDeveloperToken() {
  return String(process.env.MICROSOFT_ADS_DEVELOPER_TOKEN || '').trim();
}

function assertMicrosoftAdsConfig() {
  const missing = [];
  if (!getMicrosoftDeveloperToken()) missing.push('MICROSOFT_ADS_DEVELOPER_TOKEN');
  if (!getMicrosoftCustomerId()) missing.push('MICROSOFT_ADS_CUSTOMER_ID');
  if (!getMicrosoftAccountId()) missing.push('MICROSOFT_ADS_ACCOUNT_ID');
  if (!process.env.MICROSOFT_ADS_CLIENT_ID) missing.push('MICROSOFT_ADS_CLIENT_ID');
  if (!process.env.MICROSOFT_ADS_CLIENT_SECRET) missing.push('MICROSOFT_ADS_CLIENT_SECRET');
  if (!process.env.MICROSOFT_ADS_REFRESH_TOKEN) missing.push('MICROSOFT_ADS_REFRESH_TOKEN');
  if (missing.length) {
    throw new Error(`Microsoft Ads spend not configured: ${missing.join(', ')}`);
  }
}

function buildMicrosoftSoapEnvelope(action, bodyXml, accessToken) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="${MS_NS}">
    <Action mustUnderstand="1">${action}</Action>
    <AuthenticationToken i:nil="false">${escapeXml(accessToken)}</AuthenticationToken>
    <CustomerAccountId i:nil="false">${escapeXml(getMicrosoftAccountId())}</CustomerAccountId>
    <CustomerId i:nil="false">${escapeXml(getMicrosoftCustomerId())}</CustomerId>
    <DeveloperToken i:nil="false">${escapeXml(getMicrosoftDeveloperToken())}</DeveloperToken>
  </s:Header>
  <s:Body>
    ${bodyXml}
  </s:Body>
</s:Envelope>`;
}

async function microsoftSoapRequest(action, bodyXml, accessToken) {
  const envelope = buildMicrosoftSoapEnvelope(action, bodyXml, accessToken);
  const { data } = await axios.post(MS_REPORTING_URL, envelope, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: action,
    },
    responseType: 'text',
    timeout: 60000,
  });
  return String(data || '');
}

function extractXmlTag(xml, tagName) {
  const re = new RegExp(`<(?:\\w+:)?${tagName}[^>]*>([^<]*)</(?:\\w+:)?${tagName}>`, 'i');
  const match = String(xml).match(re);
  return match ? match[1].trim() : null;
}

function buildMicrosoftSubmitBody({ startDate, endDate }) {
  const start = parseIsoDateParts(startDate);
  const end = parseIsoDateParts(endDate);
  const accountId = getMicrosoftAccountId();

  return `<SubmitGenerateReportRequest xmlns="${MS_NS}">
  <ReportRequest i:nil="false" i:type="AccountPerformanceReportRequest">
    <ExcludeColumnHeaders i:nil="false">false</ExcludeColumnHeaders>
    <ExcludeReportFooter i:nil="false">true</ExcludeReportFooter>
    <ExcludeReportHeader i:nil="false">true</ExcludeReportHeader>
    <Format i:nil="false">Csv</Format>
    <FormatVersion i:nil="false">2.0</FormatVersion>
    <ReportName i:nil="false">TrafficOverviewAdsSpend</ReportName>
    <ReturnOnlyCompleteData i:nil="false">false</ReturnOnlyCompleteData>
    <Aggregation>Daily</Aggregation>
    <Columns i:nil="false">
      <AccountPerformanceReportColumn>TimePeriod</AccountPerformanceReportColumn>
      <AccountPerformanceReportColumn>Spend</AccountPerformanceReportColumn>
    </Columns>
    <Scope i:nil="false">
      <AccountIds i:nil="false" xmlns:a1="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
        <a1:long>${escapeXml(accountId)}</a1:long>
      </AccountIds>
    </Scope>
    <Time i:nil="false">
      <CustomDateRangeEnd i:nil="false">
        <Day>${end.day}</Day>
        <Month>${end.month}</Month>
        <Year>${end.year}</Year>
      </CustomDateRangeEnd>
      <CustomDateRangeStart i:nil="false">
        <Day>${start.day}</Day>
        <Month>${start.month}</Month>
        <Year>${start.year}</Year>
      </CustomDateRangeStart>
      <ReportTimeZone i:nil="false">GreenwichMeanTimeDublinEdinburghLisbonLondon</ReportTimeZone>
    </Time>
  </ReportRequest>
</SubmitGenerateReportRequest>`;
}

async function fetchMicrosoftDailySpend({ startDate, endDate }) {
  assertMicrosoftAdsConfig();
  const accessToken = await getMicrosoftAccessToken();

  const submitXml = await microsoftSoapRequest(
    'SubmitGenerateReport',
    buildMicrosoftSubmitBody({ startDate, endDate }),
    accessToken,
  );
  const reportRequestId = extractXmlTag(submitXml, 'ReportRequestId');
  if (!reportRequestId) {
    throw new Error(`Microsoft Ads SubmitGenerateReport failed: ${submitXml.slice(0, 500)}`);
  }

  let downloadUrl = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await sleep(attempt === 0 ? 2000 : 5000);
    const pollBody = `<PollGenerateReportRequest xmlns="${MS_NS}">
  <ReportRequestId i:nil="false">${escapeXml(reportRequestId)}</ReportRequestId>
</PollGenerateReportRequest>`;
    const pollXml = await microsoftSoapRequest('PollGenerateReport', pollBody, accessToken);
    const status = extractXmlTag(pollXml, 'Status');
    if (status === 'Success') {
      downloadUrl = extractXmlTag(pollXml, 'ReportDownloadUrl');
      break;
    }
    if (status && status !== 'Pending') {
      throw new Error(`Microsoft Ads report status ${status}: ${pollXml.slice(0, 500)}`);
    }
  }

  if (!downloadUrl) {
    throw new Error('Microsoft Ads report timed out while Pending');
  }

  const url = downloadUrl.replace(/&amp;/g, '&');
  const { data: zipBuffer } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  const csvText = unzipFirstTextFile(Buffer.from(zipBuffer));
  const rows = parseCsvRows(csvText);
  const byDate = emptyDailyMap();

  for (const row of rows) {
    const dateRaw =
      row.TimePeriod
      || row['Time Period']
      || row.timePeriod
      || row.GregorianDate
      || row.Date;
    const date = normalizeSpendDate(dateRaw);
    const spend = roundMoney(row.Spend ?? row.spend ?? 0);
    if (!date) continue;
    const prev = byDate.get(date) || 0;
    byDate.set(date, roundMoney(prev + spend));
  }

  return byDate;
}

// ─── Meta (Facebook + Instagram ads combined) ───────────────────────────────

function getMetaAccountId() {
  const raw = String(process.env.META_ADS_ACCOUNT_ID || '').trim();
  if (!raw) return '';
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

function assertMetaAdsConfig() {
  const missing = [];
  if (!process.env.META_ADS_ACCESS_TOKEN) missing.push('META_ADS_ACCESS_TOKEN');
  if (!getMetaAccountId()) missing.push('META_ADS_ACCOUNT_ID');
  if (missing.length) {
    throw new Error(`Meta Ads spend not configured: ${missing.join(', ')}`);
  }
}

async function fetchMetaDailySpend({ startDate, endDate }) {
  assertMetaAdsConfig();
  const accountId = getMetaAccountId();
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const byDate = emptyDailyMap();

  let url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/insights`;
  let params = {
    fields: 'spend,date_start',
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    time_increment: 1,
    access_token: token,
    limit: 500,
  };

  while (url) {
    const { data } = await axios.get(url, {
      params: url.includes('access_token=') ? undefined : params,
      timeout: 60000,
    });

    for (const row of data.data || []) {
      const date = normalizeSpendDate(row.date_start);
      const spend = roundMoney(row.spend);
      if (!date) continue;
      const prev = byDate.get(date) || 0;
      byDate.set(date, roundMoney(prev + spend));
    }

    url = data.paging?.next || null;
    params = undefined;
  }

  return byDate;
}

async function safeFetch(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`[adsSpendPlatforms] ${label} spend unavailable:`, error.message);
    return emptyDailyMap();
  }
}

/**
 * @param {{ startDate: string, endDate: string }} periodLabels YYYY-MM-DD
 * @returns {Promise<{ google: Map<string, number>, microsoft: Map<string, number>, meta: Map<string, number> }>}
 */
async function getDailyAdsSpendByPlatform({ startDate, endDate }) {
  const [google, microsoft, meta] = await Promise.all([
    safeFetch('Google', () => fetchGoogleDailySpend({ startDate, endDate })),
    safeFetch('Microsoft', () => fetchMicrosoftDailySpend({ startDate, endDate })),
    safeFetch('Meta', () => fetchMetaDailySpend({ startDate, endDate })),
  ]);

  return { google, microsoft, meta };
}

function sumMap(map) {
  let total = 0;
  for (const value of map.values()) {
    total += Number(value) || 0;
  }
  return roundMoney(total);
}

function pickTopAdsSpend({ google, microsoft, meta }) {
  const ranked = [
    { platform: PLATFORM_LABELS.google, spend: roundMoney(google) },
    { platform: PLATFORM_LABELS.microsoft, spend: roundMoney(microsoft) },
    { platform: PLATFORM_LABELS.meta, spend: roundMoney(meta) },
  ];

  let top = ranked[0];
  for (const row of ranked) {
    if (row.spend > top.spend) {
      top = row;
    }
  }

  if (top.spend <= 0) {
    return { platform: '—', spend: 0 };
  }
  return top;
}

function spendForDate(maps, date) {
  return {
    google: roundMoney(maps.google.get(date) || 0),
    microsoft: roundMoney(maps.microsoft.get(date) || 0),
    meta: roundMoney(maps.meta.get(date) || 0),
  };
}

module.exports = {
  PLATFORM_LABELS,
  getDailyAdsSpendByPlatform,
  sumMap,
  pickTopAdsSpend,
  spendForDate,
  roundMoney,
};
