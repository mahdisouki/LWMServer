const SeoCompetitor = require('../../models/SeoCompetitor');
const SeoContentGap = require('../../models/SeoContentGap');
const SeoKeyword = require('../../models/SeoKeyword');
const SeoSiteSnapshot = require('../../models/SeoSiteSnapshot');
const Blog = require('../../models/Blog');
const {
  getSiteUrl,
  getSiteHostname,
  getMaxCompetitors,
  getDefaultBlogImage,
  isGscEnabled,
  isSeoAgentEnabled,
} = require('../../config/seoConfig');
const { fetchDomainMetrics, isDataForSeoEnabled } = require('./dataForSeoService');
const { syncFreeMetrics, resolveMetricsProvider } = require('./seoFreeMetricsService');
const { fetchPageRank, isOpenPageRankEnabled } = require('./openPageRankService');
const { generateBlogFromContentGap } = require('./seoAgentService');

function normalizeCompetitorUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) {
    return '';
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.search = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

function titleCaseKeyword(keyword) {
  return String(keyword || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildGapInsight(keyword, position) {
  if (position == null) {
    return `No ranking detected for "${keyword}" — create targeted content to capture this query.`;
  }
  if (position <= 10) {
    return `You rank #${position} for "${keyword}" — optimize existing content to reach top 3.`;
  }
  if (position <= 30) {
    return `You rank #${position} for "${keyword}" — strong opportunity to break onto page 1.`;
  }
  return `You rank #${position} for "${keyword}" — low visibility; consider a dedicated landing page.`;
}

async function getYourSiteMetrics(siteUrl) {
  const snapshot = await SeoSiteSnapshot.findOne({ siteUrl }).lean();
  const [trackedCount, suggestionCount] = await Promise.all([
    SeoKeyword.countDocuments({ siteUrl, isTracked: true }),
    SeoKeyword.countDocuments({ siteUrl, isSuggestion: true }),
  ]);

  const km = snapshot?.siteHealth?.keyMetrics || {};

  return {
    domain: getSiteHostname(),
    domainAuthority: snapshot?.domainAuthority ?? null,
    authorityScore: km.authorityScore ?? null,
    authoritySource: km.authoritySource ?? (snapshot?.domainAuthority != null ? 'openpagerank' : null),
    organicClicks28d: km.organicClicks28d ?? null,
    organicImpressions28d: km.organicImpressions28d ?? null,
    organicTrafficMonthly: km.organicTrafficMonthly ?? km.organicClicks28d ?? null,
    organicTrafficLabel: km.organicTrafficLabel ?? (km.organicClicks28d != null ? 'clicks_28d' : null),
    avgPosition28d: km.avgPosition28d ?? null,
    keywordsCount: km.keywordsCount ?? (trackedCount + suggestionCount),
    backlinksCount: km.backlinksCount ?? km.referringDomains ?? null,
    backlinksLabel: km.backlinksLabel ?? (km.referringDomains != null ? 'referring_domains' : null),
    globalRank: km.globalRank ?? null,
    metricsProvider: km.metricsProvider ?? resolveMetricsProvider(),
  };
}

function mapCompetitor(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    url: doc.competitorUrl,
    domainAuthority: doc.domainAuthority,
    authorityScore: doc.authorityScore ?? (doc.domainAuthority != null ? doc.domainAuthority / 10 : null),
    authoritySource: doc.authorityScore != null || doc.domainAuthority != null ? 'openpagerank' : null,
    organicTrafficMonthly: doc.organicTrafficMonthly,
    keywordsCount: doc.keywordsCount,
    backlinksCount: doc.backlinksCount,
    backlinksLabel: doc.backlinksCount != null ? 'referring_domains' : null,
    trend: doc.trend,
    lastSyncedAt: doc.lastSyncedAt,
    source: doc.source,
  };
}

function buildChartData(yourSite, competitors) {
  const chart = [];

  if (yourSite.domainAuthority != null) {
    chart.push({ name: 'You', domainAuthority: yourSite.domainAuthority });
  } else {
    chart.push({ name: 'You', domainAuthority: 0 });
  }

  for (const competitor of competitors) {
    chart.push({
      name: competitor.name,
      domainAuthority: competitor.domainAuthority ?? 0,
    });
  }

  return chart;
}

async function getCompetitorsOverview(siteUrl = getSiteUrl()) {
  const [yourSite, rows] = await Promise.all([
    getYourSiteMetrics(siteUrl),
    SeoCompetitor.find({ siteUrl }).sort({ createdAt: 1 }).lean(),
  ]);

  const competitors = rows.map(mapCompetitor);

  return {
    yourSite,
    competitors,
    chartData: buildChartData(yourSite, competitors),
    chartMetric: 'authority',
    chartMetricLabel: 'Open PageRank (0–10, chart ×10)',
    authorityMetricLabel: 'Open PageRank',
    trafficMetricLabel: yourSite.organicTrafficLabel === 'clicks_28d'
      ? 'Organic clicks (28 days)'
      : 'Organic traffic',
    backlinksMetricLabel: 'Referring domains',
  };
}

async function addCompetitor(siteUrl, { name, url, competitorUrl }) {
  const competitorUrlNormalized = normalizeCompetitorUrl(url || competitorUrl);
  if (!competitorUrlNormalized) {
    throw new Error('A valid competitor url is required');
  }

  const displayName = String(name || '').trim() || hostnameFromUrl(competitorUrlNormalized);
  if (!displayName) {
    throw new Error('name is required');
  }

  const count = await SeoCompetitor.countDocuments({ siteUrl });
  if (count >= getMaxCompetitors()) {
    const err = new Error(`Maximum of ${getMaxCompetitors()} competitors allowed`);
    err.statusCode = 400;
    throw err;
  }

  const doc = await SeoCompetitor.findOneAndUpdate(
    { siteUrl, competitorUrl: competitorUrlNormalized },
    {
      $set: {
        siteUrl,
        name: displayName,
        competitorUrl: competitorUrlNormalized,
        source: 'manual',
      },
      $setOnInsert: {
        domainAuthority: null,
        organicTrafficMonthly: null,
        keywordsCount: null,
        backlinksCount: null,
        trend: 'unknown',
      },
    },
    { upsert: true, new: true },
  );

  if (isDataForSeoEnabled()) {
    try {
      await syncSingleCompetitorMetrics(doc);
      const refreshed = await SeoCompetitor.findById(doc._id).lean();
      return mapCompetitor(refreshed);
    } catch (err) {
      console.warn('[SEO Competitors] Metrics fetch on add failed:', err.message);
    }
  } else if (isOpenPageRankEnabled()) {
    try {
      const domain = hostnameFromUrl(competitorUrlNormalized);
      const rank = await fetchPageRank(domain);
      if (rank.domainAuthority != null) {
        await SeoCompetitor.findByIdAndUpdate(doc._id, {
          $set: {
            domainAuthority: rank.domainAuthority,
            authorityScore: rank.authorityScore,
            backlinksCount: rank.referringDomains,
            lastSyncedAt: new Date(),
            source: 'api',
          },
        });
        const refreshed = await SeoCompetitor.findById(doc._id).lean();
        return mapCompetitor(refreshed);
      }
    } catch (err) {
      console.warn('[SEO Competitors] Open PageRank on add failed:', err.message);
    }
  }

  return mapCompetitor(doc);
}

async function deleteCompetitor(siteUrl, competitorId) {
  const result = await SeoCompetitor.findOneAndDelete({ _id: competitorId, siteUrl });
  return Boolean(result);
}

async function listContentGaps(siteUrl = getSiteUrl(), { page = 1, limit = 20, status = 'open' } = {}) {
  const filter = { siteUrl };
  if (status && status !== 'all') {
    filter.status = status;
  }

  const skip = (Math.max(1, page) - 1) * limit;
  const [rows, total] = await Promise.all([
    SeoContentGap.find(filter).sort({ volume: -1, keyword: 1 }).skip(skip).limit(limit).lean(),
    SeoContentGap.countDocuments(filter),
  ]);

  return {
    gaps: rows.map((gap) => ({
      id: gap._id.toString(),
      keyword: gap.keyword,
      insight: gap.insight,
      volume: gap.volume,
      keywordDifficulty: gap.keywordDifficulty,
      competitorName: gap.competitorName,
      status: gap.status,
      blogId: gap.blogId ? gap.blogId.toString() : null,
      updatedAt: gap.updatedAt,
    })),
    meta: {
      currentPage: page,
      limit,
      total,
      count: rows.length,
    },
  };
}

async function createPageFromContentGap(siteUrl, gapId, { author = 'SEO Assistant' } = {}) {
  const gap = await SeoContentGap.findOne({ _id: gapId, siteUrl });
  if (!gap) {
    return null;
  }

  if (gap.blogId) {
    const existing = await Blog.findById(gap.blogId).lean();
    if (existing) {
      return { blog: existing, gap, alreadyExists: true, aiGenerated: false };
    }
  }

  let title;
  let description;
  let tags;
  let aiMeta = null;

  if (isSeoAgentEnabled()) {
    const generated = await generateBlogFromContentGap(gap);
    title = generated.title;
    description = generated.description;
    tags = generated.tags;
    aiMeta = {
      model: generated.model,
      usage: generated.usage,
      metaTitle: generated.metaTitle,
      metaDescription: generated.metaDescription,
      needsReview: generated.needsReview || [],
    };
  } else {
    title = titleCaseKeyword(gap.keyword);
    description = [
      `<h2>${title}</h2>`,
      `<p>${gap.insight}</p>`,
      '<p>This draft was generated from an SEO content gap. Expand with service details, FAQs, and local proof points before publishing.</p>',
    ].join('\n');
    tags = gap.keyword.split(/\s+/).filter(Boolean).slice(0, 5);
  }

  const blog = await Blog.create({
    title,
    author,
    description,
    image: getDefaultBlogImage(),
    tags,
  });

  gap.blogId = blog._id;
  gap.status = 'draft_created';
  await gap.save();

  return {
    blog,
    gap,
    alreadyExists: false,
    aiGenerated: Boolean(aiMeta),
    aiMeta,
  };
}

async function syncContentGapsFromKeywords(siteUrl, jobId = null) {
  const candidates = await SeoKeyword.find({
    siteUrl,
    $or: [
      { isSuggestion: true, volume: { $gte: 50 } },
      { isTracked: true },
      { source: 'gsc' },
    ],
  }).lean();

  const weakKeywords = candidates.filter((row) => {
    if (row.position == null) {
      return (row.volume || 0) >= 20;
    }
    return row.position > 10;
  });

  const now = new Date();
  let upserted = 0;

  for (const row of weakKeywords.slice(0, 100)) {
    const keyword = String(row.keyword || '').trim().toLowerCase();
    if (!keyword) {
      continue;
    }

    await SeoContentGap.findOneAndUpdate(
      { siteUrl, keyword },
      {
        $set: {
          siteUrl,
          keyword,
          insight: buildGapInsight(keyword, row.position),
          volume: row.volume ?? null,
          keywordDifficulty: row.keywordDifficulty ?? null,
          refreshJobId: jobId,
        },
        $setOnInsert: {
          status: 'open',
        },
      },
      { upsert: true },
    );
    upserted += 1;
  }

  return { upserted, scanned: candidates.length };
}

async function syncSingleCompetitorMetrics(competitorDoc) {
  const domain = hostnameFromUrl(competitorDoc.competitorUrl);
  const metrics = await fetchDomainMetrics(domain);
  const now = new Date();

  await SeoCompetitor.findByIdAndUpdate(competitorDoc._id, {
    $set: {
      domainAuthority: metrics.domainAuthority,
      organicTrafficMonthly: metrics.organicTrafficMonthly,
      keywordsCount: metrics.keywordsCount,
      backlinksCount: metrics.backlinksCount,
      trend: metrics.trend,
      lastSyncedAt: now,
      source: 'api',
    },
  });

  return metrics;
}

async function syncSiteMetricsFromProvider(siteUrl = getSiteUrl()) {
  if (!isDataForSeoEnabled()) {
    return { skipped: true, reason: 'DataForSEO not configured' };
  }

  const domain = getSiteHostname();
  const metrics = await fetchDomainMetrics(domain);
  const now = new Date();

  await SeoSiteSnapshot.findOneAndUpdate(
    { siteUrl },
    {
      $set: {
        domainAuthority: metrics.domainAuthority,
        'siteHealth.keyMetrics.organicTrafficMonthly': metrics.organicTrafficMonthly,
        'siteHealth.keyMetrics.keywordsCount': metrics.keywordsCount,
        'siteHealth.keyMetrics.backlinksCount': metrics.backlinksCount,
        'siteHealth.keyMetrics.metricsSyncedAt': now,
      },
    },
    { upsert: true },
  );

  return { domain, ...metrics, syncedAt: now };
}

async function syncCompetitorMetricsFromProvider(siteUrl = getSiteUrl()) {
  if (isDataForSeoEnabled()) {
    const competitors = await SeoCompetitor.find({ siteUrl });
    let synced = 0;

    await syncSiteMetricsFromProvider(siteUrl);

    for (const competitor of competitors) {
      try {
        await syncSingleCompetitorMetrics(competitor);
        synced += 1;
      } catch (err) {
        console.warn(`[SEO Competitors] Failed to sync ${competitor.competitorUrl}:`, err.message);
      }
    }

    return { synced, total: competitors.length, provider: 'dataforseo' };
  }

  const freeResult = await syncFreeMetrics(siteUrl);
  const competitors = await SeoCompetitor.find({ siteUrl });
  return {
    synced: freeResult.openPageRank?.synced ?? 0,
    total: competitors.length,
    provider: freeResult.provider,
    free: freeResult,
    skipped: !isGscEnabled() && !isOpenPageRankEnabled(),
    reason: !isGscEnabled() && !isOpenPageRankEnabled()
      ? 'Enable SEO_GSC_ENABLED and/or OPENPAGERANK_API_KEY'
      : undefined,
  };
}

async function touchCompetitorsSynced(siteUrl) {
  const now = new Date();
  await SeoCompetitor.updateMany(
    { siteUrl },
    { $set: { lastSyncedAt: now } },
  );
}

module.exports = {
  getCompetitorsOverview,
  addCompetitor,
  deleteCompetitor,
  listContentGaps,
  createPageFromContentGap,
  syncContentGapsFromKeywords,
  syncCompetitorMetricsFromProvider,
  syncSiteMetricsFromProvider,
  syncFreeMetrics,
  touchCompetitorsSynced,
};
