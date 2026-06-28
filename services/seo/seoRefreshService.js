const SeoSiteSnapshot = require('../../models/SeoSiteSnapshot');
const SeoAuditIssue = require('../../models/SeoAuditIssue');
const SeoKeyword = require('../../models/SeoKeyword');
const SeoRefreshJob = require('../../models/SeoRefreshJob');
const { getSiteUrl } = require('../../config/seoConfig');
const { crawlSite } = require('./seoCrawlService');
const { fetchCoreWebVitals } = require('./pageSpeedService');
const { fetchTopQueries } = require('./gscService');
const {
  buildIssuesFromCrawl,
  buildTechnicalChecks,
  buildAiActionPlan,
  countBySeverity,
  computeSeoScore,
  scoreStatusFromScore,
} = require('./seoAuditService');

const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

async function getOrCreateSnapshot(siteUrl = getSiteUrl()) {
  let snapshot = await SeoSiteSnapshot.findOne({ siteUrl });
  if (!snapshot) {
    snapshot = await SeoSiteSnapshot.create({
      siteUrl,
      seoScore: 0,
      liveMonitoring: false,
      siteHealth: {},
    });
  }
  return snapshot;
}

async function getOverview(siteUrl = getSiteUrl()) {
  const snapshot = await getOrCreateSnapshot(siteUrl);
  const hostname = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return {
    siteUrl: hostname,
    totalPages: snapshot.totalPages || snapshot.siteHealth?.keyMetrics?.sitemapPageCount || 0,
    domainAuthority: snapshot.domainAuthority,
    seoScore: snapshot.seoScore || 0,
    liveMonitoring: snapshot.liveMonitoring,
    lastRefreshedAt: snapshot.lastRefreshedAt,
    refreshJobId: snapshot.refreshJobId,
  };
}

async function getSiteHealth(siteUrl = getSiteUrl()) {
  const snapshot = await getOrCreateSnapshot(siteUrl);
  const health = snapshot.siteHealth || {};

  return {
    overallScore: health.overallScore ?? snapshot.seoScore ?? 0,
    scoreStatus: health.scoreStatus || 'needs_work',
    issueCounts: health.issueCounts || { critical: 0, high: 0, medium: 0, low: 0 },
    coreWebVitals: health.coreWebVitals || {
      lcp: { status: 'unknown', displayValue: '—' },
      fid: { status: 'unknown', displayValue: '—' },
      cls: { status: 'unknown', displayValue: '—' },
      ttfb: { status: 'unknown', displayValue: '—' },
    },
    indexCoverage: health.indexCoverage || { indexed: 0, notIndexed: 0, blocked: 0 },
    keyMetrics: {
      domainAuthority: snapshot.domainAuthority,
      organicTrafficMonthly: health.keyMetrics?.organicTrafficMonthly ?? null,
      sitemapPages: health.keyMetrics?.sitemapPageCount ?? 0,
      crawledPages: health.keyMetrics?.crawledPageCount ?? 0,
    },
    technicalChecks: health.technicalChecks || [],
    aiActionPlan: health.aiActionPlan || [],
    lastRefreshedAt: snapshot.lastRefreshedAt,
  };
}

async function getAuditSummary(siteUrl = getSiteUrl()) {
  const issues = await SeoAuditIssue.find({ siteUrl });
  const counts = countBySeverity(issues);
  return {
    critical: counts.critical,
    high: counts.high,
    medium: counts.medium,
    low: counts.low,
    total: issues.length,
  };
}

async function getAuditIssues(siteUrl = getSiteUrl(), { severity = 'all', page = 1, limit = 20 } = {}) {
  const filter = { siteUrl };
  if (severity && severity !== 'all') {
    filter.severity = severity;
  }

  const skip = (Math.max(1, page) - 1) * limit;
  const [issues, total] = await Promise.all([
    SeoAuditIssue.find(filter).sort({ severity: 1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
    SeoAuditIssue.countDocuments(filter),
  ]);

  return {
    issues: issues.map((issue) => ({
      id: issue.issueKey,
      title: issue.title,
      severity: issue.severity,
      affectedPageCount: issue.affectedPageCount,
      impactSummary: issue.impactSummary,
      description: issue.description,
      affectedUrls: issue.affectedUrls,
      expectedImprovement: issue.expectedImprovement,
      aiFixSteps: issue.aiFixSteps,
      updatedAt: issue.updatedAt,
    })),
    meta: {
      currentPage: page,
      limit,
      total,
      count: issues.length,
    },
  };
}

async function getAuditIssueById(siteUrl, issueKey) {
  const issue = await SeoAuditIssue.findOne({ siteUrl, issueKey }).lean();
  if (!issue) {
    return null;
  }
  return {
    id: issue.issueKey,
    title: issue.title,
    severity: issue.severity,
    affectedPageCount: issue.affectedPageCount,
    impactSummary: issue.impactSummary,
    description: issue.description,
    affectedUrls: issue.affectedUrls,
    expectedImprovement: issue.expectedImprovement,
    aiFixSteps: issue.aiFixSteps,
    updatedAt: issue.updatedAt,
  };
}

async function getKeywordsSummary(siteUrl = getSiteUrl()) {
  const tracked = await SeoKeyword.find({ siteUrl, isTracked: true });
  const top10 = tracked.filter((k) => k.position != null && k.position <= 10).length;
  const withPosition = tracked.filter((k) => k.position != null);
  const biggest = withPosition.reduce((best, k) => {
    if (!best) return k;
    if (k.position < best.position) return k;
    return best;
  }, null);

  return {
    trackedCount: tracked.length,
    top10Count: top10,
    biggestOpportunity: biggest
      ? { keyword: biggest.keyword, position: biggest.position, targetUrl: biggest.targetUrl }
      : null,
    avgKeywordDifficulty: tracked.length
      ? Math.round(
        tracked.filter((k) => k.keywordDifficulty != null)
          .reduce((s, k) => s + k.keywordDifficulty, 0)
          / Math.max(1, tracked.filter((k) => k.keywordDifficulty != null).length),
      )
      : null,
  };
}

async function listKeywords(siteUrl = getSiteUrl(), options = {}) {
  const {
    tab = 'tracked', search = '', page = 1, limit = 20,
  } = options;

  const filter = { siteUrl };
  if (tab === 'suggestions') {
    filter.isSuggestion = true;
  } else {
    filter.isTracked = true;
  }

  if (search) {
    filter.keyword = { $regex: search, $options: 'i' };
  }

  const skip = (Math.max(1, page) - 1) * limit;
  const [rows, total] = await Promise.all([
    SeoKeyword.find(filter).sort({ position: 1, keyword: 1 }).skip(skip).limit(limit).lean(),
    SeoKeyword.countDocuments(filter),
  ]);

  return {
    keywords: rows.map((k) => ({
      id: k._id.toString(),
      keyword: k.keyword,
      volume: k.volume,
      keywordDifficulty: k.keywordDifficulty,
      position: k.position,
      positionChange: k.positionChange,
      intent: k.intent,
      targetUrl: k.targetUrl,
      isTracked: k.isTracked,
      isSuggestion: k.isSuggestion,
      source: k.source,
    })),
    meta: {
      currentPage: page,
      limit,
      total,
      count: rows.length,
    },
  };
}

async function trackKeyword(siteUrl, { keyword, targetUrl = '' }) {
  const normalized = String(keyword || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('keyword is required');
  }

  const doc = await SeoKeyword.findOneAndUpdate(
    { siteUrl, keyword: normalized },
    {
      $set: {
        siteUrl,
        keyword: normalized,
        targetUrl: targetUrl || '',
        isTracked: true,
        isSuggestion: false,
        source: 'manual',
      },
    },
    { upsert: true, new: true },
  );

  return {
    id: doc._id.toString(),
    keyword: doc.keyword,
    volume: doc.volume,
    keywordDifficulty: doc.keywordDifficulty,
    position: doc.position,
    positionChange: doc.positionChange,
    intent: doc.intent,
    targetUrl: doc.targetUrl,
  };
}

async function deleteKeyword(siteUrl, keywordId) {
  const result = await SeoKeyword.findOneAndDelete({ _id: keywordId, siteUrl });
  return Boolean(result);
}

async function getRefreshJobStatus(jobId) {
  if (!jobId) {
    return null;
  }
  return SeoRefreshJob.findById(jobId).lean();
}

async function runRefresh(siteUrl = getSiteUrl(), triggeredBy = null) {
  const snapshot = await getOrCreateSnapshot(siteUrl);

  if (snapshot.lastRefreshedAt) {
    const elapsed = Date.now() - new Date(snapshot.lastRefreshedAt).getTime();
    if (elapsed < REFRESH_COOLDOWN_MS) {
      const err = new Error('Refresh cooldown active. Try again in a few minutes.');
      err.statusCode = 429;
      throw err;
    }
  }

  const running = await SeoRefreshJob.findOne({ siteUrl, status: 'running' });
  if (running) {
    return running;
  }

  const job = await SeoRefreshJob.create({
    siteUrl,
    status: 'running',
    startedAt: new Date(),
    triggeredBy,
    progress: { step: 'crawl', percent: 10 },
  });

  snapshot.refreshJobId = job._id;
  await snapshot.save();

  setImmediate(() => {
    executeRefresh(job._id, siteUrl).catch((error) => {
      console.error('[SEO Refresh] Background job failed:', error.message);
    });
  });

  return job;
}

async function executeRefresh(jobId, siteUrl) {
  const job = await SeoRefreshJob.findById(jobId);
  if (!job) {
    return;
  }

  try {
    await job.updateOne({ progress: { step: 'crawl', percent: 20 } });
    const crawlResult = await crawlSite(siteUrl);

    await job.updateOne({ progress: { step: 'pagespeed', percent: 45 } });
    const homepage = crawlResult.pages[0]?.url || siteUrl;
    const cwv = await fetchCoreWebVitals(homepage);

    await job.updateOne({ progress: { step: 'audit', percent: 65 } });
    const issues = buildIssuesFromCrawl(crawlResult);
    const technicalChecks = buildTechnicalChecks(crawlResult, cwv);
    const issueCounts = countBySeverity(issues);
    const seoScore = computeSeoScore(issues, technicalChecks);
    const scoreStatus = scoreStatusFromScore(seoScore);
    const aiActionPlan = buildAiActionPlan(issues);

    const noindexCount = crawlResult.pages.filter((p) => p.hasNoindex).length;
    const indexedEstimate = crawlResult.pages.length - noindexCount;

    await SeoAuditIssue.deleteMany({ siteUrl });
    if (issues.length) {
      await SeoAuditIssue.insertMany(issues.map((issue) => ({
        siteUrl,
        refreshJobId: jobId,
        ...issue,
      })));
    }

    await job.updateOne({ progress: { step: 'keywords', percent: 85 } });
    try {
      const gscQueries = await fetchTopQueries();
      for (const row of gscQueries) {
        await SeoKeyword.findOneAndUpdate(
          { siteUrl, keyword: row.keyword.toLowerCase() },
          {
            $set: {
              siteUrl,
              keyword: row.keyword.toLowerCase(),
              volume: row.volume,
              position: row.position,
              isSuggestion: true,
              isTracked: false,
              source: 'gsc',
            },
          },
          { upsert: true },
        );
      }
    } catch (gscError) {
      console.warn('[SEO Refresh] GSC sync skipped:', gscError.message);
    }

    const now = new Date();
    await SeoSiteSnapshot.findOneAndUpdate(
      { siteUrl },
      {
        $set: {
          totalPages: crawlResult.sitemapPageCount,
          seoScore,
          liveMonitoring: true,
          lastRefreshedAt: now,
          refreshJobId: jobId,
          siteHealth: {
            overallScore: seoScore,
            scoreStatus,
            issueCounts,
            coreWebVitals: {
              lcp: cwv.lcp,
              fid: cwv.fid,
              cls: cwv.cls,
              ttfb: cwv.ttfb,
            },
            indexCoverage: {
              indexed: indexedEstimate,
              notIndexed: 0,
              blocked: noindexCount,
            },
            keyMetrics: {
              organicTrafficMonthly: null,
              sitemapPageCount: crawlResult.sitemapPageCount,
              crawledPageCount: crawlResult.pages.length,
            },
            technicalChecks,
            aiActionPlan,
          },
        },
      },
      { upsert: true },
    );

    await job.updateOne({
      status: 'completed',
      completedAt: now,
      progress: { step: 'done', percent: 100 },
      stats: {
        pagesCrawled: crawlResult.pages.length,
        issuesFound: issues.length,
      },
    });
  } catch (error) {
    await job.updateOne({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: error.message,
      progress: { step: 'failed', percent: 0 },
    });
    throw error;
  }
}

module.exports = {
  getOverview,
  getSiteHealth,
  getAuditSummary,
  getAuditIssues,
  getAuditIssueById,
  getKeywordsSummary,
  listKeywords,
  trackKeyword,
  deleteKeyword,
  runRefresh,
  getRefreshJobStatus,
  getOrCreateSnapshot,
};
