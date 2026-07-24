const ClaritySnapshot = require('../../models/ClaritySnapshot');
const { resolvePeriod } = require('./dashboardService');
const { toDateString, getPeriodLabels } = require('../../utils/analyticsDateRange');
const {
  CATEGORY_COLORS,
  CLARITY_CHANNEL_COLORS,
  clarityChannelToId,
  extractChannelSourceRows,
  extractSourceSessionRows,
  formatClarityChannelLabel,
  formatClarityChannelPlatform,
  formatTrafficChannelLabel,
  formatTrafficPlatformLabel,
  mapClarityChannelToLegacyCategory,
  normalizeClarityChannel,
} = require('../../utils/clarityMetricsParser');

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function accumulateClarityChannels(snapshots) {
  const channels = new Map();

  for (const snapshot of snapshots) {
    for (const row of extractChannelSourceRows(snapshot.data)) {
      const key = normalizeClarityChannel(row.channel);
      const existing = channels.get(key);

      if (!existing) {
        channels.set(key, {
          format: 'clarity_channel',
          channel: row.channel,
          sessions: row.sessions,
          topSource: row.source,
          topSourceSessions: row.sessions,
        });
        continue;
      }

      existing.sessions += row.sessions;
      if (row.sessions > existing.topSourceSessions) {
        existing.topSource = row.source;
        existing.topSourceSessions = row.sessions;
      }
    }
  }

  return channels;
}

function accumulateLegacyChannels(snapshots) {
  const channels = new Map();

  for (const snapshot of snapshots) {
    for (const row of extractSourceSessionRows(snapshot.data)) {
      const key = row.category;
      const existing = channels.get(key);

      if (!existing) {
        channels.set(key, {
          format: 'legacy_source_medium',
          channel: row.category,
          sessions: row.sessions,
          topSource: row.source,
          topMedium: row.medium,
          topSourceSessions: row.sessions,
        });
        continue;
      }

      existing.sessions += row.sessions;
      if (row.sessions > existing.topSourceSessions) {
        existing.topSource = row.source;
        existing.topMedium = row.medium;
        existing.topSourceSessions = row.sessions;
      }
    }
  }

  return channels;
}

function accumulateFromSnapshots(snapshots) {
  const clarityChannels = accumulateClarityChannels(snapshots);
  if (clarityChannels.size > 0) {
    return { channels: clarityChannels, format: 'clarity_channel' };
  }

  return {
    channels: accumulateLegacyChannels(snapshots),
    format: 'legacy_source_medium',
  };
}

function buildChannelRows(channelTotals, limit) {
  const rows = [...channelTotals.values()]
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);

  const maxSessions = rows[0]?.sessions || 0;

  return rows.map((row, index) => {
    const isLegacy = row.format === 'legacy_source_medium';
    const channelKey = isLegacy ? row.channel : normalizeClarityChannel(row.channel);

    return {
      rank: index + 1,
      id: isLegacy ? row.channel : clarityChannelToId(row.channel),
      clarityChannel: isLegacy ? null : channelKey,
      label: isLegacy
        ? formatTrafficChannelLabel(row.channel)
        : formatClarityChannelLabel(row.channel),
      platform: isLegacy
        ? formatTrafficPlatformLabel(row.topSource, row.topMedium, row.channel)
        : formatClarityChannelPlatform(row.channel, row.topSource),
      category: isLegacy ? row.channel : mapClarityChannelToLegacyCategory(row.channel),
      sessions: row.sessions,
      sharePercent: maxSessions > 0 ? roundPercent((row.sessions / maxSessions) * 100) : 0,
      color: isLegacy
        ? CATEGORY_COLORS[row.channel] || CATEGORY_COLORS.other
        : CLARITY_CHANNEL_COLORS[channelKey] || CLARITY_CHANNEL_COLORS.Other,
    };
  });
}

async function getTrafficSources({ preset, startDate, endDate, limit = DEFAULT_LIMIT } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });
  const rowLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const snapshots = await ClaritySnapshot.find({
    snapshotType: 'traffic_sources',
    snapshotDate: { $gte: period.start, $lte: period.end },
  }).sort({ snapshotDate: 1 }).lean();

  const { channels: channelTotals, format: snapshotFormat } = accumulateFromSnapshots(snapshots);
  const sources = buildChannelRows(channelTotals, rowLimit);
  const totalSessions = [...channelTotals.values()].reduce((sum, row) => sum + row.sessions, 0);

  let snapshotNote;
  if (snapshots.length === 0) {
    snapshotNote = 'No traffic source snapshots for this period. Data appears as daily Clarity sync runs.';
  } else if (snapshotFormat === 'legacy_source_medium') {
    snapshotNote = 'Using legacy Source/Medium snapshot data. Run clarity:sync to refresh with Clarity Channel format.';
  }

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: snapshots.length,
      format: snapshotFormat,
      note: snapshotNote,
    },
    sources,
    totals: {
      sessions: totalSessions,
      channels: channelTotals.size,
    },
    limit: rowLimit,
    omittedMetrics: {
      goals: 'Not available per channel until UTM/referrer is stored on quote and order submissions',
      conversionRate: 'Requires per-channel goal attribution',
      revenue: 'Order trafficSource supports Google Ads, Microsoft Ads, Instagram, Facebook, Organic when utm_source/click IDs are sent',
    },
    dataSources: {
      sessions: snapshotFormat === 'clarity_channel'
        ? 'Clarity traffic_sources snapshots — Channel dimension with Source for platform sub-labels'
        : 'Clarity traffic_sources snapshots — legacy Source/Medium rows (re-sync for Channel format)',
      platform: 'Top Source within each channel row',
      ranking: 'Channels ranked by session count',
    },
  };
}

module.exports = {
  getTrafficSources,
};
