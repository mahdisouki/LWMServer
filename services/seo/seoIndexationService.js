const SeoIndexPage = require('../../models/SeoIndexPage');
const SeoSiteSnapshot = require('../../models/SeoSiteSnapshot');
const { getSiteUrl } = require('../../config/seoConfig');
const { fetchTopPages } = require('./gscService');

function normalizeUrl(url) {
  return String(url || '').trim().replace(/#.*$/, '');
}

function classifyPage(page) {
  if (page.hasNoindex) {
    return { status: 'blocked', reason: 'noindex' };
  }
  if (page.isCartOrCheckout) {
    return { status: 'indexable', reason: 'should_noindex_cart' };
  }
  return { status: 'indexable', reason: 'ok' };
}

function mapPage(doc) {
  return {
    id: doc._id.toString(),
    url: doc.url,
    status: doc.status,
    reason: doc.reason,
    inSitemap: doc.inSitemap,
    hasNoindex: doc.hasNoindex,
    robotsMeta: doc.robotsMeta || '',
    title: doc.title || '',
    canonical: doc.canonical || '',
    isCartOrCheckout: Boolean(doc.isCartOrCheckout),
    errorMessage: doc.errorMessage,
    gscImpressions: doc.gscImpressions,
    gscClicks: doc.gscClicks,
    gscSignal: doc.gscSignal || 'unknown',
    lastCrawledAt: doc.lastCrawledAt,
    updatedAt: doc.updatedAt,
  };
}

async function buildGscPageMap() {
  const rows = await fetchTopPages();
  const map = new Map();
  for (const row of rows) {
    const key = normalizeUrl(row.url);
    if (!key) {
      continue;
    }
    map.set(key, row);
    // Also index without trailing slash variance
    const alt = key.endsWith('/') ? key.slice(0, -1) : `${key}/`;
    if (!map.has(alt)) {
      map.set(alt, row);
    }
  }
  return map;
}

function applyGscSignal(url, gscMap) {
  const hit = gscMap.get(normalizeUrl(url));
  if (!hit) {
    return {
      gscImpressions: null,
      gscClicks: null,
      gscSignal: gscMap.size ? 'no_impressions' : 'unknown',
    };
  }
  return {
    gscImpressions: hit.impressions ?? 0,
    gscClicks: hit.clicks ?? 0,
    gscSignal: (hit.impressions || 0) > 0 ? 'likely_indexed' : 'no_impressions',
  };
}

/**
 * Replace indexation inventory from a crawl result.
 * @returns {{ summary: object, upserted: number }}
 */
async function syncFromCrawl(siteUrl, crawlResult, jobId = null) {
  const now = new Date();
  let gscMap = new Map();
  try {
    gscMap = await buildGscPageMap();
  } catch (err) {
    console.warn('[SEO Indexation] GSC page sync skipped:', err.message);
  }

  const docs = [];

  for (const page of crawlResult.pages || []) {
    const url = normalizeUrl(page.url);
    if (!url) {
      continue;
    }
    const { status, reason } = classifyPage(page);
    const gsc = applyGscSignal(url, gscMap);
    docs.push({
      siteUrl,
      url,
      status,
      reason,
      inSitemap: true,
      hasNoindex: Boolean(page.hasNoindex),
      robotsMeta: page.robotsMeta || '',
      title: page.title || '',
      canonical: page.canonical || '',
      isCartOrCheckout: Boolean(page.isCartOrCheckout),
      errorMessage: null,
      ...gsc,
      refreshJobId: jobId,
      lastCrawledAt: now,
    });
  }

  for (const err of crawlResult.errors || []) {
    const url = normalizeUrl(err.url);
    if (!url) {
      continue;
    }
    const gsc = applyGscSignal(url, gscMap);
    docs.push({
      siteUrl,
      url,
      status: 'error',
      reason: 'fetch_error',
      inSitemap: true,
      hasNoindex: false,
      robotsMeta: '',
      title: '',
      canonical: '',
      isCartOrCheckout: false,
      errorMessage: err.message || 'Fetch failed',
      ...gsc,
      refreshJobId: jobId,
      lastCrawledAt: now,
    });
  }

  await SeoIndexPage.deleteMany({ siteUrl });
  if (docs.length) {
    await SeoIndexPage.insertMany(docs);
  }

  const summary = await getSummary(siteUrl);
  await SeoSiteSnapshot.findOneAndUpdate(
    { siteUrl },
    {
      $set: {
        'siteHealth.indexCoverage': {
          indexed: summary.indexable,
          notIndexed: summary.errors,
          blocked: summary.blocked,
        },
        'siteHealth.keyMetrics.sitemapPageCount': summary.sitemapCount,
        'siteHealth.keyMetrics.crawledPageCount': summary.crawledCount,
      },
    },
    { upsert: true },
  );

  return { summary, upserted: docs.length };
}

async function getSummary(siteUrl = getSiteUrl()) {
  const [indexable, blocked, errors, total, likelyIndexed, snapshot] = await Promise.all([
    SeoIndexPage.countDocuments({ siteUrl, status: 'indexable' }),
    SeoIndexPage.countDocuments({ siteUrl, status: 'blocked' }),
    SeoIndexPage.countDocuments({ siteUrl, status: 'error' }),
    SeoIndexPage.countDocuments({ siteUrl }),
    SeoIndexPage.countDocuments({ siteUrl, gscSignal: 'likely_indexed' }),
    SeoSiteSnapshot.findOne({ siteUrl }).select('lastRefreshedAt siteHealth.keyMetrics').lean(),
  ]);

  const sitemapCount = snapshot?.siteHealth?.keyMetrics?.sitemapPageCount ?? total;
  const crawledCount = snapshot?.siteHealth?.keyMetrics?.crawledPageCount ?? (indexable + blocked);

  return {
    indexable,
    blocked,
    errors,
    total,
    sitemapCount,
    crawledCount,
    likelyIndexed,
    /** Honest labels: crawl indexability is not Google's index. */
    source: 'crawl',
    notes: {
      indexedFieldMeaning: 'indexable_by_crawl_no_noindex',
      notIndexedFieldMeaning: 'fetch_errors',
      blockedFieldMeaning: 'meta_noindex',
      likelyIndexedMeaning: 'gsc_impressions_in_lookback',
    },
    lastSyncedAt: snapshot?.lastRefreshedAt || null,
  };
}

async function listPages(siteUrl = getSiteUrl(), {
  status = 'all',
  gscSignal = 'all',
  page = 1,
  limit = 20,
  search = '',
} = {}) {
  const filter = { siteUrl };
  if (status && status !== 'all') {
    filter.status = status;
  }
  if (gscSignal && gscSignal !== 'all') {
    filter.gscSignal = gscSignal;
  }
  const q = String(search || '').trim();
  if (q) {
    filter.url = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * safeLimit;

  const [rows, total] = await Promise.all([
    SeoIndexPage.find(filter)
      .sort({ status: 1, url: 1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    SeoIndexPage.countDocuments(filter),
  ]);

  return {
    pages: rows.map(mapPage),
    meta: {
      currentPage: safePage,
      limit: safeLimit,
      total,
      count: rows.length,
    },
  };
}

module.exports = {
  syncFromCrawl,
  getSummary,
  listPages,
};
