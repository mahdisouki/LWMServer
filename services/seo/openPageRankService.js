const axios = require('axios');
const { isOpenPageRankEnabled, getOpenPageRankApiKey } = require('../../config/seoConfig');

const API_URL = 'https://openpagerank.keywordseverywhere.com/v1/domains/bulk';
const BATCH_SIZE = 100;

function normalizeDomain(raw) {
  let value = String(raw || '').trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return value.split('/')[0];
}

function toChartAuthority(openPageRank) {
  if (openPageRank == null || Number.isNaN(openPageRank)) {
    return null;
  }
  return Math.round(Number(openPageRank) * 10);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function mapResultRow(row) {
  if (!row?.found || row.open_page_rank == null) {
    return null;
  }

  const score = Number(row.open_page_rank);
  return {
    authorityScore: Math.round(score * 100) / 100,
    domainAuthority: toChartAuthority(score),
    globalRank: row.rank ?? null,
    referringDomains: row.referring_domains ?? null,
  };
}

async function fetchPageRanks(domains) {
  if (!isOpenPageRankEnabled()) {
    return {};
  }

  const unique = [...new Set(domains.map(normalizeDomain).filter(Boolean))];
  if (!unique.length) {
    return {};
  }

  const map = {};
  const batches = chunkArray(unique, BATCH_SIZE);

  for (const batch of batches) {
    const { data, status } = await axios.post(
      API_URL,
      { domains: batch, include_history: false },
      {
        headers: {
          Authorization: `Bearer ${getOpenPageRankApiKey()}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
        validateStatus: () => true,
      },
    );

    if (status === 401) {
      throw new Error(data?.error?.message || 'Invalid Open PageRank API key');
    }
    if (status >= 400) {
      throw new Error(data?.error?.message || `Open PageRank request failed (${status})`);
    }

    if (!Array.isArray(data?.results)) {
      throw new Error('Open PageRank returned an unexpected response');
    }

    for (const row of data.results) {
      const metrics = mapResultRow(row);
      if (!metrics) {
        continue;
      }
      map[normalizeDomain(row.domain)] = metrics;
    }
  }

  return map;
}

async function fetchPageRank(domain) {
  const map = await fetchPageRanks([domain]);
  return map[normalizeDomain(domain)] || {
    authorityScore: null,
    domainAuthority: null,
    globalRank: null,
    referringDomains: null,
  };
}

module.exports = {
  normalizeDomain,
  isOpenPageRankEnabled,
  fetchPageRanks,
  fetchPageRank,
  toChartAuthority,
};
