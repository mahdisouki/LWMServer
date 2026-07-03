const axios = require('axios');
const { isClarityEnabled, getClarityApiToken } = require('../../config/clarityConfig');

const CLARITY_BASE = 'https://www.clarity.ms/export-data/api/v1';

const VALID_DAYS = [1, 2, 3];
const VALID_DIMENSIONS = [
  'Browser',
  'Device',
  'Country',
  'OS',
  'Source',
  'Medium',
  'Campaign',
  'Channel',
  'URL',
];

async function fetchProjectLiveInsights({ numOfDays = 1, dimension1, dimension2, dimension3 } = {}) {
  if (!isClarityEnabled()) {
    throw new Error('Clarity is not configured');
  }

  const days = Number(numOfDays);
  if (!VALID_DAYS.includes(days)) {
    throw new Error('numOfDays must be 1, 2, or 3');
  }

  const dimensions = [dimension1, dimension2, dimension3].filter(Boolean);
  for (const dim of dimensions) {
    if (!VALID_DIMENSIONS.includes(dim)) {
      throw new Error(`Invalid dimension: ${dim}`);
    }
  }

  const params = new URLSearchParams({ numOfDays: String(days) });
  if (dimension1) params.set('dimension1', dimension1);
  if (dimension2) params.set('dimension2', dimension2);
  if (dimension3) params.set('dimension3', dimension3);

  try {
    const { data } = await axios.get(
      `${CLARITY_BASE}/project-live-insights?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${getClarityApiToken()}`,
          'Content-Type': 'application/json',
        },
      },
    );
    return data;
  } catch (error) {
    const status = error.response?.status;
    const clarityMessage = error.response?.data?.message || error.response?.data;
    if (status === 401) {
      throw new Error('Clarity API token is missing, invalid, or expired');
    }
    if (status === 429) {
      throw new Error('Clarity daily API request limit exceeded (10 per day)');
    }
    if (status === 400) {
      throw new Error(typeof clarityMessage === 'string' ? clarityMessage : 'Invalid Clarity API request');
    }
    throw error;
  }
}

async function getOverview(numOfDays = 1) {
  return fetchProjectLiveInsights({ numOfDays });
}

async function getTopPages(numOfDays = 3) {
  return fetchProjectLiveInsights({ numOfDays, dimension1: 'URL' });
}

async function getTrafficSources(numOfDays = 3) {
  return fetchProjectLiveInsights({
    numOfDays,
    dimension1: 'Source',
    dimension2: 'Medium',
    dimension3: 'Campaign',
  });
}

async function getDeviceBreakdown(numOfDays = 3) {
  return fetchProjectLiveInsights({
    numOfDays,
    dimension1: 'Device',
    dimension2: 'Browser',
    dimension3: 'OS',
  });
}

module.exports = {
  fetchProjectLiveInsights,
  getOverview,
  getTopPages,
  getTrafficSources,
  getDeviceBreakdown,
};
