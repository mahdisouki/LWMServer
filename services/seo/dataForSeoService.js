const axios = require('axios');
const {
  isDataForSeoEnabled,
  getDataForSeoCredentials,
  getDataForSeoLocationCode,
  getDataForSeoLanguageCode,
} = require('../../config/seoConfig');

const API_BASE = 'https://api.dataforseo.com/v3';

function normalizeDomain(raw) {
  let value = String(raw || '').trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return value.split('/')[0];
}

async function postLive(endpoint, payload) {
  if (!isDataForSeoEnabled()) {
    throw new Error('DataForSEO is not configured (set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD)');
  }

  const { login, password } = getDataForSeoCredentials();
  const { data } = await axios.post(`${API_BASE}${endpoint}`, payload, {
    auth: { username: login, password },
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  if (data.status_code !== 20000) {
    throw new Error(data.status_message || 'DataForSEO request failed');
  }

  const task = data.tasks?.[0];
  if (!task) {
    throw new Error('DataForSEO returned no task');
  }
  if (task.status_code !== 20000) {
    throw new Error(task.status_message || 'DataForSEO task failed');
  }

  return task;
}

function computeTrendFromOrganic(organic) {
  if (!organic) {
    return 'unknown';
  }
  const up = organic.is_up || 0;
  const down = organic.is_down || 0;
  if (up > down * 1.2) {
    return 'up';
  }
  if (down > up * 1.2) {
    return 'down';
  }
  if (up === 0 && down === 0) {
    return 'stable';
  }
  return 'stable';
}

async function fetchDomainRankOverview(domain) {
  const target = normalizeDomain(domain);
  const task = await postLive('/dataforseo_labs/google/domain_rank_overview/live', [{
    target,
    location_code: getDataForSeoLocationCode(),
    language_code: getDataForSeoLanguageCode(),
    ignore_synonyms: true,
  }]);

  const item = task.result?.[0]?.items?.[0];
  const organic = item?.metrics?.organic;

  return {
    organicTrafficMonthly: organic?.etv != null ? Math.round(organic.etv) : null,
    keywordsCount: organic?.count ?? null,
    trend: computeTrendFromOrganic(organic),
  };
}

async function fetchBacklinksSummary(domain) {
  const target = normalizeDomain(domain);
  const task = await postLive('/backlinks/summary/live', [{
    target,
    rank_scale: 'one_hundred',
    include_subdomains: true,
    backlinks_status_type: 'live',
  }]);

  const summary = task.result?.[0];
  if (!summary) {
    return { domainAuthority: null, backlinksCount: null };
  }

  return {
    domainAuthority: summary.rank ?? null,
    backlinksCount: summary.backlinks ?? null,
  };
}

async function fetchDomainMetrics(domain) {
  const [rankOverview, backlinks] = await Promise.all([
    fetchDomainRankOverview(domain).catch((err) => {
      console.warn(`[DataForSEO] domain_rank_overview failed for ${domain}:`, err.message);
      return {
        organicTrafficMonthly: null,
        keywordsCount: null,
        trend: 'unknown',
      };
    }),
    fetchBacklinksSummary(domain).catch((err) => {
      console.warn(`[DataForSEO] backlinks/summary failed for ${domain}:`, err.message);
      return { domainAuthority: null, backlinksCount: null };
    }),
  ]);

  return {
    domainAuthority: backlinks.domainAuthority,
    organicTrafficMonthly: rankOverview.organicTrafficMonthly,
    keywordsCount: rankOverview.keywordsCount,
    backlinksCount: backlinks.backlinksCount,
    trend: rankOverview.trend,
  };
}

module.exports = {
  normalizeDomain,
  isDataForSeoEnabled,
  fetchDomainMetrics,
  fetchDomainRankOverview,
  fetchBacklinksSummary,
};
