const SeoCompetitor = require('../../models/SeoCompetitor');
const SeoSiteSnapshot = require('../../models/SeoSiteSnapshot');
const {
  getSiteUrl,
  getSiteHostname,
  isGscEnabled,
  isOpenPageRankEnabled,
  isDataForSeoEnabled,
} = require('../../config/seoConfig');
const { fetchSiteSummary } = require('./gscService');
const { fetchPageRanks } = require('./openPageRankService');
const SeoKeyword = require('../../models/SeoKeyword');

function resolveMetricsProvider() {
  const parts = [];
  if (isGscEnabled()) parts.push('gsc');
  if (isOpenPageRankEnabled()) parts.push('openpagerank');
  if (isDataForSeoEnabled()) parts.push('dataforseo');
  return parts.length ? parts.join('+') : null;
}

async function syncGscSiteMetrics(siteUrl) {
  if (!isGscEnabled()) {
    return { skipped: true, reason: 'GSC disabled' };
  }

  const summary = await fetchSiteSummary(28);
  const keywordsCount = await SeoKeyword.countDocuments({ siteUrl, source: 'gsc' });
  const now = new Date();

  await SeoSiteSnapshot.findOneAndUpdate(
    { siteUrl },
    {
      $set: {
        'siteHealth.keyMetrics.organicClicks28d': summary.clicks28d,
        'siteHealth.keyMetrics.organicImpressions28d': summary.impressions28d,
        'siteHealth.keyMetrics.organicTrafficMonthly': summary.clicks28d,
        'siteHealth.keyMetrics.organicTrafficLabel': 'clicks_28d',
        'siteHealth.keyMetrics.avgPosition28d': summary.avgPosition,
        'siteHealth.keyMetrics.keywordsCount': keywordsCount,
        'siteHealth.keyMetrics.gscSyncedAt': now,
        'siteHealth.keyMetrics.metricsProvider': resolveMetricsProvider(),
      },
    },
    { upsert: true },
  );

  return { ...summary, keywordsCount, syncedAt: now };
}

async function syncOpenPageRankForDomains(siteUrl, domains) {
  if (!isOpenPageRankEnabled()) {
    return { skipped: true, reason: 'Open PageRank not configured', synced: 0 };
  }

  const ranks = await fetchPageRanks(domains);
  const now = new Date();
  let synced = 0;

  const ownDomain = getSiteHostname();
  const ownRank = ranks[ownDomain];
  if (ownRank) {
    await SeoSiteSnapshot.findOneAndUpdate(
      { siteUrl },
      {
        $set: {
          domainAuthority: ownRank.domainAuthority,
          'siteHealth.keyMetrics.authorityScore': ownRank.authorityScore,
          'siteHealth.keyMetrics.authoritySource': 'openpagerank',
          'siteHealth.keyMetrics.globalRank': ownRank.globalRank,
          'siteHealth.keyMetrics.referringDomains': ownRank.referringDomains,
          'siteHealth.keyMetrics.backlinksCount': ownRank.referringDomains,
          'siteHealth.keyMetrics.backlinksLabel': 'referring_domains',
          'siteHealth.keyMetrics.authoritySyncedAt': now,
          'siteHealth.keyMetrics.metricsProvider': resolveMetricsProvider(),
        },
      },
      { upsert: true },
    );
    synced += 1;
  }

  const competitors = await SeoCompetitor.find({ siteUrl });
  for (const competitor of competitors) {
    const domain = competitor.competitorUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    const rank = ranks[domain];
    if (!rank) {
      continue;
    }
    await SeoCompetitor.findByIdAndUpdate(competitor._id, {
      $set: {
        domainAuthority: rank.domainAuthority,
        authorityScore: rank.authorityScore,
        backlinksCount: rank.referringDomains,
        lastSyncedAt: now,
        source: 'api',
      },
    });
    synced += 1;
  }

  return { synced, domains: domains.length };
}

async function syncFreeMetrics(siteUrl = getSiteUrl()) {
  const results = {
    gsc: null,
    openPageRank: null,
    provider: resolveMetricsProvider(),
  };

  try {
    results.gsc = await syncGscSiteMetrics(siteUrl);
  } catch (err) {
    console.warn('[SEO Free Metrics] GSC site sync failed:', err.message);
    results.gsc = { error: err.message };
  }

  const domains = [getSiteHostname()];
  const competitors = await SeoCompetitor.find({ siteUrl }).lean();
  for (const c of competitors) {
    const d = c.competitorUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (d) domains.push(d);
  }

  try {
    results.openPageRank = await syncOpenPageRankForDomains(siteUrl, domains);
  } catch (err) {
    console.warn('[SEO Free Metrics] Open PageRank sync failed:', err.message);
    results.openPageRank = { error: err.message };
  }

  return results;
}

module.exports = {
  syncFreeMetrics,
  syncGscSiteMetrics,
  syncOpenPageRankForDomains,
  resolveMetricsProvider,
};
