function findMetric(data, metricName) {
  if (!Array.isArray(data)) {
    return null;
  }
  return data.find((m) => m.metricName === metricName) || null;
}

function parseIntSafe(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseFloatSafe(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return '';
  }
  return url.trim();
}

function getUrlPathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function urlMatchesPageFilter(url, pageFilter) {
  if (!pageFilter || pageFilter.id === 'all' || !pageFilter.pathPatterns?.length) {
    return true;
  }
  const pathname = getUrlPathname(url);
  return pageFilter.pathPatterns.some((pattern) => new RegExp(pattern, 'i').test(pathname));
}

function extractOverviewDayMetrics(overviewData, pageFilter = null) {
  const traffic = findMetric(overviewData, 'Traffic');
  const engagement = findMetric(overviewData, 'EngagementTime');
  const scroll = findMetric(overviewData, 'ScrollDepth');
  const popular = findMetric(overviewData, 'PopularPages');

  const trafficInfo = traffic?.information?.[0] || {};
  const engagementInfo = engagement?.information?.[0] || {};
  const scrollInfo = scroll?.information?.[0] || {};

  const sessions = parseIntSafe(trafficInfo.totalSessionCount);
  const botSessions = parseIntSafe(trafficInfo.totalBotSessionCount);
  const pagesPerSession = parseFloatSafe(trafficInfo.pagesPerSessionPercentage);
  const activeTimeSeconds = parseIntSafe(engagementInfo.activeTime);
  const totalTimeSeconds = parseIntSafe(engagementInfo.totalTime);
  const scrollDepth = parseFloatSafe(scrollInfo.averageScrollDepth);

  const popularPages = (popular?.information || [])
    .map((row) => ({
      url: normalizeUrl(row.url || row.Url),
      visitsCount: parseIntSafe(row.visitsCount || row.visits),
    }))
    .filter((row) => row.url);

  const filteredPopular = pageFilter?.id === 'all'
    ? popularPages
    : popularPages.filter((row) => urlMatchesPageFilter(row.url, pageFilter));

  const pageViews = filteredPopular.reduce((sum, row) => sum + row.visitsCount, 0);

  return {
    sessions,
    botSessions,
    pagesPerSession,
    activeTimeSeconds,
    totalTimeSeconds,
    scrollDepth,
    pageViews,
    popularPages: filteredPopular,
  };
}

function extractTopPagesDayMetrics(topPagesData, pageFilter = null) {
  const traffic = findMetric(topPagesData, 'Traffic');
  const engagement = findMetric(topPagesData, 'EngagementTime');

  const sessionsByUrl = new Map();
  let pageViews = 0;

  for (const row of traffic?.information || []) {
    const url = normalizeUrl(row.Url || row.url);
    if (!url || !urlMatchesPageFilter(url, pageFilter)) {
      continue;
    }
    const rowSessions = parseIntSafe(row.totalSessionCount);
    sessionsByUrl.set(url, rowSessions);
    pageViews += Math.round(rowSessions * parseFloatSafe(row.pagesPerSessionPercentage || 1));
  }

  let sessions = 0;
  let weightedActiveTime = 0;
  let totalTimeSeconds = 0;

  for (const rowSessions of sessionsByUrl.values()) {
    sessions += rowSessions;
  }

  for (const row of engagement?.information || []) {
    const url = normalizeUrl(row.Url || row.url);
    if (!url || !urlMatchesPageFilter(url, pageFilter)) {
      continue;
    }
    const rowSessions = sessionsByUrl.get(url) || 0;
    weightedActiveTime += parseIntSafe(row.activeTime) * rowSessions;
    totalTimeSeconds += parseIntSafe(row.totalTime);
  }

  const activeTimeSeconds = sessions > 0
    ? Math.round(weightedActiveTime / sessions)
    : 0;

  return {
    sessions,
    botSessions: 0,
    pagesPerSession: sessions > 0 ? pageViews / sessions : 0,
    activeTimeSeconds,
    totalTimeSeconds,
    scrollDepth: 0,
    pageViews,
    popularPages: [],
  };
}

function aggregateDayMetrics(metricsList) {
  const totals = {
    sessions: 0,
    botSessions: 0,
    pageViews: 0,
    weightedActiveTime: 0,
    totalTimeSeconds: 0,
    scrollDepthSum: 0,
    scrollDepthDays: 0,
    pagesPerSessionSum: 0,
    pagesPerSessionDays: 0,
    popularPagesMap: new Map(),
    dataPoints: metricsList.length,
  };

  for (const day of metricsList) {
    totals.sessions += day.sessions;
    totals.botSessions += day.botSessions;
    totals.pageViews += day.pageViews;
    totals.weightedActiveTime += day.activeTimeSeconds * day.sessions;
    totals.totalTimeSeconds += day.totalTimeSeconds;

    if (day.scrollDepth > 0) {
      totals.scrollDepthSum += day.scrollDepth;
      totals.scrollDepthDays += 1;
    }
    if (day.pagesPerSession > 0) {
      totals.pagesPerSessionSum += day.pagesPerSession;
      totals.pagesPerSessionDays += 1;
    }

    for (const page of day.popularPages || []) {
      const key = page.url;
      const existing = totals.popularPagesMap.get(key) || { url: key, visitsCount: 0 };
      existing.visitsCount += page.visitsCount;
      totals.popularPagesMap.set(key, existing);
    }
  }

  const avgTimeOnSiteSeconds = totals.sessions > 0
    ? Math.round(totals.weightedActiveTime / totals.sessions)
    : 0;

  const topPages = Array.from(totals.popularPagesMap.values())
    .sort((a, b) => b.visitsCount - a.visitsCount)
    .slice(0, 20);

  return {
    sessions: totals.sessions,
    botSessionsExcluded: totals.botSessions,
    pageViews: totals.pageViews,
    avgTimeOnSiteSeconds,
    totalTimeSeconds: totals.totalTimeSeconds,
    scrollDepthAverage: totals.scrollDepthDays > 0
      ? Math.round((totals.scrollDepthSum / totals.scrollDepthDays) * 100) / 100
      : 0,
    pagesPerSession: totals.pagesPerSessionDays > 0
      ? Math.round((totals.pagesPerSessionSum / totals.pagesPerSessionDays) * 100) / 100
      : 0,
    topPages,
    dataPoints: totals.dataPoints,
  };
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  if (minutes === 0) {
    return `${secs} sec`;
  }
  return `${minutes}m ${secs}s`;
}

function percentChange(current, previous) {
  if (previous === 0 || previous == null) {
    return current > 0 ? null : 0;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

const SOURCE_LABELS = {
  organic: 'Organic Search',
  direct: 'Direct',
  referral: 'Referral',
  social: 'Social',
  paid: 'Paid Search',
  email: 'Email',
  other: 'Other',
};

function mapTrafficSourceCategory(source, medium) {
  const m = (medium || '').toLowerCase().trim();
  const s = (source || '').toLowerCase().trim();

  if (m === 'organic') return 'organic';
  if (m === 'direct') return 'direct';
  if (m === 'referral') return 'referral';
  if (m === 'social') return 'social';
  if (m === 'cpc' || m === 'ppc' || m === 'paid') return 'paid';
  if (/facebook|instagram|twitter|linkedin|tiktok|youtube/.test(s)) return 'social';
  if (!s && !m) return 'direct';
  return 'other';
}

function extractOverviewTrafficSeries(overviewData) {
  const traffic = findMetric(overviewData, 'Traffic');
  const popular = findMetric(overviewData, 'PopularPages');
  const trafficInfo = traffic?.information?.[0] || {};

  const pageViews = (popular?.information || []).reduce(
    (sum, row) => sum + parseIntSafe(row.visitsCount || row.visits),
    0,
  );

  return {
    sessions: parseIntSafe(trafficInfo.totalSessionCount),
    visitors: parseIntSafe(trafficInfo.distinctUserCount),
    pageViews,
  };
}

function extractSourceBreakdown(trafficSourcesData) {
  const traffic = findMetric(trafficSourcesData, 'Traffic');
  const breakdown = {
    organic: 0,
    direct: 0,
    referral: 0,
    social: 0,
    paid: 0,
    other: 0,
  };

  for (const row of traffic?.information || []) {
    const category = mapTrafficSourceCategory(row.Source, row.Medium);
    breakdown[category] += parseIntSafe(row.totalSessionCount);
  }

  return breakdown;
}

function getTopSourceLabel(breakdown) {
  const entries = Object.entries(breakdown || {})
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    return null;
  }
  return SOURCE_LABELS[entries[0][0]] || entries[0][0];
}

const CATEGORY_COLORS = {
  organic: 'green',
  direct: 'blue',
  referral: 'purple',
  paid: 'orange',
  social: 'pink',
  email: 'cyan',
  other: 'slate',
};

function titleCase(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatTrafficChannelLabel(category) {
  return SOURCE_LABELS[category] || SOURCE_LABELS.other;
}

function formatTrafficPlatformLabel(source, medium, category) {
  const sourceLower = (source || '').toLowerCase().trim();
  const mediumLower = (medium || '').toLowerCase().trim();

  if (category === 'direct') {
    return null;
  }
  if (category === 'paid' && sourceLower === 'google') {
    return 'Google Ads';
  }
  if (category === 'organic' && sourceLower === 'google') {
    return 'Google';
  }
  if (category === 'email') {
    if (mediumLower === 'newsletter') {
      return 'Newsletter';
    }
    return titleCase(source) || titleCase(medium) || null;
  }
  if (category === 'social') {
    if (sourceLower.includes('facebook')) return 'Facebook';
    if (sourceLower.includes('instagram')) return 'Instagram';
    if (sourceLower.includes('twitter') || sourceLower === 'x') return 'Twitter';
    if (sourceLower.includes('linkedin')) return 'LinkedIn';
    if (sourceLower.includes('tiktok')) return 'TikTok';
    if (sourceLower.includes('youtube')) return 'YouTube';
  }

  if (sourceLower) {
    return titleCase(source.replace(/^www\./, ''));
  }
  if (mediumLower) {
    return titleCase(medium);
  }
  return null;
}

function formatTrafficSourceLabel(source, medium) {
  const category = mapTrafficSourceCategory(source, medium);
  const sourceLabel = titleCase(source);
  const mediumLabel = titleCase(medium);
  const mediumLower = (medium || '').toLowerCase().trim();

  if (mediumLower === 'email' || mediumLower === 'newsletter') {
    return sourceLabel ? `Email (${sourceLabel})` : 'Email';
  }

  switch (category) {
    case 'organic':
      return sourceLabel ? `Organic Search (${sourceLabel})` : 'Organic Search';
    case 'direct':
      return 'Direct';
    case 'paid':
      return sourceLabel ? `Paid Search (${sourceLabel} Ads)` : 'Paid Search';
    case 'referral':
      return sourceLabel ? `Referral (${sourceLabel})` : 'Referral';
    case 'social':
      return sourceLabel ? `Social (${sourceLabel})` : 'Social';
    default:
      if (sourceLabel && mediumLabel) {
        return `${sourceLabel} (${mediumLabel})`;
      }
      return sourceLabel || mediumLabel || 'Other';
  }
}

function extractSourceSessionRows(trafficSourcesData) {
  const traffic = findMetric(trafficSourcesData, 'Traffic');
  const rows = [];

  for (const row of traffic?.information || []) {
    const source = String(row.Source || '').trim();
    const medium = String(row.Medium || '').trim();
    const sessions = parseIntSafe(row.totalSessionCount);
    if (sessions <= 0) {
      continue;
    }

    const category = mapTrafficSourceCategory(source, medium);
    const mediumLower = medium.toLowerCase();
    const resolvedCategory = mediumLower === 'email' || mediumLower === 'newsletter'
      ? 'email'
      : category;

    rows.push({
      source,
      medium,
      category: resolvedCategory,
      sessions,
    });
  }

  return rows;
}

function buildSourceKey(source, medium) {
  return `${(source || '').toLowerCase().trim()}|${(medium || '').toLowerCase().trim()}`;
}

const CLARITY_CHANNEL_LABELS = {
  OrganicSearch: 'Organic Search',
  PaidSearch: 'Paid Search',
  Referral: 'Referral',
  Social: 'Social',
  Direct: 'Direct',
  Email: 'Email',
  AIPlatform: 'AI',
  Other: 'Other (Unclassified / Self-Referral)',
};

const CLARITY_CHANNEL_COLORS = {
  OrganicSearch: 'green',
  PaidSearch: 'orange',
  Direct: 'blue',
  Referral: 'purple',
  Social: 'pink',
  Email: 'cyan',
  AIPlatform: 'slate',
  Other: 'slate',
};

const CLARITY_CHANNEL_TO_LEGACY = {
  OrganicSearch: 'organic',
  PaidSearch: 'paid',
  Referral: 'referral',
  Social: 'social',
  Direct: 'direct',
  Email: 'email',
  AIPlatform: 'other',
  Other: 'other',
};

function normalizeClarityChannel(channel) {
  return String(channel || '').replace(/\s+/g, '');
}

function clarityChannelToId(channel) {
  const normalized = normalizeClarityChannel(channel);
  if (!normalized) {
    return 'unknown';
  }
  return normalized
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function formatClarityChannelLabel(channel) {
  const key = normalizeClarityChannel(channel);
  return CLARITY_CHANNEL_LABELS[key] || titleCase(key) || 'Other';
}

function mapClarityChannelToLegacyCategory(channel) {
  const key = normalizeClarityChannel(channel);
  return CLARITY_CHANNEL_TO_LEGACY[key] || 'other';
}

function formatClarityChannelPlatform(channel, source) {
  const channelKey = normalizeClarityChannel(channel);
  const sourceLower = (source || '').toLowerCase().trim();

  if (channelKey === 'Direct') {
    return null;
  }
  if (channelKey === 'Other' && !sourceLower) {
    return 'Mixed / Unknown';
  }
  if (channelKey === 'Other' && sourceLower.includes('londonwastemanagement.com')) {
    return 'Self-referral (own domain)';
  }
  if (channelKey === 'PaidSearch' && sourceLower === 'google') {
    return 'Google Ads';
  }
  if (channelKey === 'OrganicSearch' && sourceLower === 'google') {
    return 'Google';
  }
  if (sourceLower) {
    return titleCase(source.replace(/^www\./, ''));
  }
  return null;
}

function resolveClarityChannel(channel, source) {
  const channelKey = normalizeClarityChannel(channel);
  const sourceLower = String(source || '').toLowerCase().trim();

  // Clarity can report self-referrals as "Other"; treat own domain as Direct.
  if (channelKey === 'Other' && sourceLower.includes('londonwastemanagement.com')) {
    return 'Direct';
  }

  return channel;
}

function extractChannelSourceRows(trafficSourcesData) {
  const traffic = findMetric(trafficSourcesData, 'Traffic');
  const rows = [];

  for (const row of traffic?.information || []) {
    const rawChannel = String(row.Channel || row.channel || '').trim();
    const source = String(row.Source || row.source || '').trim();
    const channel = resolveClarityChannel(rawChannel, source);
    const sessions = parseIntSafe(row.totalSessionCount);
    if (!channel || sessions <= 0) {
      continue;
    }

    rows.push({
      channel,
      source,
      sessions,
      legacyCategory: mapClarityChannelToLegacyCategory(channel),
    });
  }

  return rows;
}

function extractSnapshotSourceBreakdown(trafficSourcesData) {
  const channelRows = extractChannelSourceRows(trafficSourcesData);
  if (channelRows.length > 0) {
    const breakdown = {
      organic: 0,
      direct: 0,
      referral: 0,
      social: 0,
      paid: 0,
      other: 0,
    };

    for (const row of channelRows) {
      const bucket = row.legacyCategory === 'email' ? 'other' : row.legacyCategory;
      breakdown[bucket] = (breakdown[bucket] || 0) + row.sessions;
    }

    return breakdown;
  }

  return extractSourceBreakdown(trafficSourcesData);
}

module.exports = {
  findMetric,
  parseIntSafe,
  parseFloatSafe,
  normalizeUrl,
  extractOverviewDayMetrics,
  extractTopPagesDayMetrics,
  extractOverviewTrafficSeries,
  extractSourceBreakdown,
  extractSnapshotSourceBreakdown,
  extractChannelSourceRows,
  getTopSourceLabel,
  mapTrafficSourceCategory,
  SOURCE_LABELS,
  CATEGORY_COLORS,
  CLARITY_CHANNEL_LABELS,
  CLARITY_CHANNEL_COLORS,
  formatClarityChannelLabel,
  formatClarityChannelPlatform,
  clarityChannelToId,
  normalizeClarityChannel,
  mapClarityChannelToLegacyCategory,
  formatTrafficChannelLabel,
  formatTrafficPlatformLabel,
  formatTrafficSourceLabel,
  extractSourceSessionRows,
  buildSourceKey,
  aggregateDayMetrics,
  urlMatchesPageFilter,
  formatDuration,
  percentChange,
};
