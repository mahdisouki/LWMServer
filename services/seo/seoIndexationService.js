const mongoose = require('mongoose');
const SeoIndexPage = require('../../models/SeoIndexPage');
const SeoSiteSnapshot = require('../../models/SeoSiteSnapshot');
const { getSiteUrl, getMaxInspectUrls, isGscEnabled } = require('../../config/seoConfig');
const { fetchTopPages, inspectUrl } = require('./gscService');

const INSPECT_DELAY_MS = 250;

function normalizeUrl(url) {
  return String(url || '').trim().replace(/#.*$/, '');
}

function isSameHost(url, siteUrl) {
  try {
    return new URL(url).hostname === new URL(siteUrl).hostname;
  } catch {
    return false;
  }
}

/** Inspect the canonical Google should index, not a slash-stripped crawl URL. */
function inspectionUrlForPage(doc) {
  const site = doc.siteUrl || getSiteUrl();
  const base = site.endsWith('/') ? site : `${site}/`;
  const raw = String(doc.canonical || '').trim() || doc.url;
  let absolute = normalizeUrl(doc.url);
  try {
    absolute = normalizeUrl(new URL(raw, base).href);
  } catch {
    absolute = normalizeUrl(doc.url);
  }
  if (!absolute || !isSameHost(absolute, site)) {
    return normalizeUrl(doc.url);
  }
  return absolute;
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

function mapGoogleStatus(verdict) {
  const value = String(verdict || '').toUpperCase();
  if (value === 'PASS' || value === 'PARTIAL') {
    return 'indexed';
  }
  if (value === 'FAIL' || value === 'NEUTRAL') {
    return 'not_indexed';
  }
  const err = new Error(`URL Inspection returned unspecified verdict: ${verdict || 'missing'}`);
  err.statusCode = 502;
  throw err;
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
    googleStatus: doc.googleStatus || 'unknown',
    googleVerdict: doc.googleVerdict || null,
    googleCoverageState: doc.googleCoverageState || null,
    googleIndexingState: doc.googleIndexingState || null,
    googleCanonical: doc.googleCanonical || null,
    googleLastCrawlTime: doc.googleLastCrawlTime || null,
    inspectionResultLink: doc.inspectionResultLink || null,
    lastInspectedAt: doc.lastInspectedAt || null,
    inspectError: doc.inspectError || null,
    lastCrawledAt: doc.lastCrawledAt,
    updatedAt: doc.updatedAt,
  };
}

function inspectionFieldsFromResult(inspection) {
  return {
    googleStatus: mapGoogleStatus(inspection.verdict),
    googleVerdict: inspection.verdict,
    googleCoverageState: inspection.coverageState,
    googleIndexingState: inspection.indexingState,
    googleRobotsTxtState: inspection.robotsTxtState,
    googlePageFetchState: inspection.pageFetchState,
    googleCanonical: inspection.googleCanonical,
    googleLastCrawlTime: inspection.lastCrawlTime ? new Date(inspection.lastCrawlTime) : null,
    inspectionResultLink: inspection.inspectionResultLink,
    lastInspectedAt: new Date(),
    inspectError: null,
  };
}

function inspectionErrorFields(message) {
  return {
    googleStatus: 'inspect_error',
    lastInspectedAt: new Date(),
    inspectError: message,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function crawlFieldsFromDoc(doc) {
  return {
    status: doc.status,
    reason: doc.reason,
    inSitemap: doc.inSitemap,
    hasNoindex: doc.hasNoindex,
    robotsMeta: doc.robotsMeta,
    title: doc.title,
    canonical: doc.canonical,
    isCartOrCheckout: doc.isCartOrCheckout,
    errorMessage: doc.errorMessage,
    gscImpressions: doc.gscImpressions,
    gscClicks: doc.gscClicks,
    gscSignal: doc.gscSignal,
    refreshJobId: doc.refreshJobId,
    lastCrawledAt: doc.lastCrawledAt,
  };
}

/**
 * Upsert crawl inventory without wiping existing Google inspection results.
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

  if (docs.length) {
    await SeoIndexPage.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { siteUrl, url: doc.url },
          update: {
            $set: crawlFieldsFromDoc(doc),
            $setOnInsert: {
              siteUrl,
              url: doc.url,
              googleStatus: 'unknown',
            },
          },
          upsert: true,
        },
      })),
    );
  }

  const keptUrls = docs.map((doc) => doc.url);
  const canPrune = crawlResult.sitemapFetched !== false && keptUrls.length > 0;
  if (canPrune) {
    await SeoIndexPage.deleteMany({
      siteUrl,
      url: { $nin: keptUrls },
    });
  }

  const summary = await getSummary(siteUrl);
  await SeoSiteSnapshot.findOneAndUpdate(
    { siteUrl },
    {
      $set: {
        'siteHealth.indexCoverage': {
          indexed: summary.googleIndexed || summary.indexable,
          notIndexed: summary.googleNotIndexed || summary.errors,
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
  const [
    indexable,
    blocked,
    errors,
    total,
    likelyIndexed,
    googleIndexed,
    googleNotIndexed,
    googleUnknown,
    googleInspectError,
    snapshot,
  ] = await Promise.all([
    SeoIndexPage.countDocuments({ siteUrl, status: 'indexable' }),
    SeoIndexPage.countDocuments({ siteUrl, status: 'blocked' }),
    SeoIndexPage.countDocuments({ siteUrl, status: 'error' }),
    SeoIndexPage.countDocuments({ siteUrl }),
    SeoIndexPage.countDocuments({ siteUrl, gscSignal: 'likely_indexed' }),
    SeoIndexPage.countDocuments({ siteUrl, googleStatus: 'indexed' }),
    SeoIndexPage.countDocuments({ siteUrl, googleStatus: 'not_indexed' }),
    SeoIndexPage.countDocuments({
      siteUrl,
      $or: [{ googleStatus: 'unknown' }, { googleStatus: { $exists: false } }],
    }),
    SeoIndexPage.countDocuments({ siteUrl, googleStatus: 'inspect_error' }),
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
    googleIndexed,
    googleNotIndexed,
    googleUnknown,
    googleInspectError,
    inspectedCount: googleIndexed + googleNotIndexed + googleInspectError,
    source: 'crawl+url_inspection',
    notes: {
      indexedFieldMeaning: 'indexable_by_crawl_no_noindex',
      notIndexedFieldMeaning: 'fetch_errors',
      blockedFieldMeaning: 'meta_noindex',
      likelyIndexedMeaning: 'gsc_impressions_in_lookback',
      googleIndexedMeaning: 'url_inspection_verdict_pass_or_partial',
      googleNotIndexedMeaning: 'url_inspection_verdict_fail_or_neutral',
    },
    lastSyncedAt: snapshot?.lastRefreshedAt || null,
  };
}

async function listPages(siteUrl = getSiteUrl(), {
  status = 'all',
  gscSignal = 'all',
  googleStatus = 'all',
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
  if (googleStatus && googleStatus !== 'all') {
    if (googleStatus === 'unknown') {
      filter.$or = [{ googleStatus: 'unknown' }, { googleStatus: { $exists: false } }];
    } else {
      filter.googleStatus = googleStatus;
    }
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
      .sort({ googleStatus: 1, status: 1, url: 1 })
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

async function inspectAndSave(doc) {
  const inspection = await inspectUrl(inspectionUrlForPage(doc));
  const fields = inspectionFieldsFromResult(inspection);
  Object.assign(doc, fields);
  await doc.save();
  return mapPage(doc);
}

async function inspectPageById(siteUrl, pageId) {
  if (!mongoose.Types.ObjectId.isValid(pageId)) {
    const err = new Error('Invalid indexation page id');
    err.statusCode = 400;
    throw err;
  }

  const page = await SeoIndexPage.findOne({ _id: pageId, siteUrl });
  if (!page) {
    return null;
  }

  try {
    return await inspectAndSave(page);
  } catch (error) {
    Object.assign(page, inspectionErrorFields(error.message));
    await page.save();
    error.statusCode = error.statusCode || 502;
    throw error;
  }
}

function inspectPriorityScore(doc, homepageUrl) {
  let score = 0;
  const url = normalizeUrl(doc.url);
  const home = normalizeUrl(homepageUrl);
  if (url === home || url === `${home}/` || url === home.replace(/\/$/, '')) {
    score += 100;
  }
  if (doc.status === 'error') score += 50;
  if (doc.status === 'blocked') score += 40;
  if (doc.gscSignal === 'no_impressions' || doc.gscSignal === 'unknown') score += 20;
  if (!doc.lastInspectedAt || doc.googleStatus === 'unknown') score += 15;
  if (doc.googleStatus === 'not_indexed') score += 12;
  if (doc.googleStatus === 'inspect_error') score += 10;
  return score;
}

async function inspectPriorityPages(siteUrl = getSiteUrl(), limit = getMaxInspectUrls()) {
  if (!isGscEnabled()) {
    return { inspected: 0, failed: 0, skipped: true, reason: 'gsc_disabled' };
  }

  const pages = await SeoIndexPage.find({ siteUrl }).select('url status gscSignal googleStatus lastInspectedAt').lean();
  const ranked = [...pages]
    .sort((a, b) => inspectPriorityScore(b, siteUrl) - inspectPriorityScore(a, siteUrl))
    .slice(0, Math.min(limit, pages.length));

  let inspected = 0;
  let failed = 0;

  for (let i = 0; i < ranked.length; i += 1) {
    const doc = await SeoIndexPage.findById(ranked[i]._id);
    if (!doc) {
      continue;
    }
    try {
      await inspectAndSave(doc);
      inspected += 1;
    } catch (error) {
      Object.assign(doc, inspectionErrorFields(error.message));
      await doc.save();
      failed += 1;
      console.warn(`[SEO Indexation] Inspect failed for ${doc.url}:`, error.message);
    }
    if (i < ranked.length - 1) {
      await sleep(INSPECT_DELAY_MS);
    }
  }

  return { inspected, failed, skipped: false, total: ranked.length };
}

module.exports = {
  syncFromCrawl,
  getSummary,
  listPages,
  inspectPageById,
  inspectPriorityPages,
};
