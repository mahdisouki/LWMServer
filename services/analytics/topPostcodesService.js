const Task = require('../../models/Task');
const QuotationRequest = require('../../models/QuotationRequest');
const TopPostcodesSnapshot = require('../../models/TopPostcodesSnapshot');
const { excludeMigratedOrdersFilter } = require('./taskFilters');

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;
const CACHE_KEY = TopPostcodesSnapshot.SNAPSHOT_KEY || 'default';
/** Treat cache as stale after 16 days (biweekly cron + small buffer). */
const TOP_POSTCODES_STALE_MS = 16 * 24 * 60 * 60 * 1000;

const CHUNK_SIZE = Math.max(
  parseInt(process.env.TOP_POSTCODES_CHUNK_SIZE, 10) || 500,
  50,
);
const CHUNK_DELAY_MS = Math.max(
  parseInt(process.env.TOP_POSTCODES_CHUNK_DELAY_MS, 10) || 250,
  0,
);

const BAR_COLORS = [
  'green', 'blue', 'purple', 'orange', 'pink', 'cyan', 'amber', 'indigo',
  'teal', 'lime', 'rose', 'violet', 'sky', 'emerald', 'fuchsia', 'red',
];

const ORDER_MATCH = {
  paymentStatus: { $ne: 'Failed' },
  createdByType: 'public',
  postcode: { $exists: true, $nin: ['', null] },
  ...excludeMigratedOrdersFilter,
};

const QUOTE_MATCH = {
  postcode: { $exists: true, $nin: ['', null] },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function clampLimit(limit) {
  return Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function extractPostcodePrefix(postcode) {
  if (!postcode || typeof postcode !== 'string') return '';
  const trimmed = postcode.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0].toUpperCase();
}

/**
 * Cursor-scan a collection in small batches with a pause between chunks
 * so the cron does not pin MongoDB / event loop for one long aggregation.
 */
async function forEachDocumentChunk(Model, match, onDoc, label) {
  let lastId = null;
  let chunkIndex = 0;
  let scanned = 0;

  while (true) {
    const query = lastId
      ? { $and: [match, { _id: { $gt: lastId } }] }
      : match;

    const batch = await Model.find(query)
      .select('_id postcode')
      .sort({ _id: 1 })
      .limit(CHUNK_SIZE)
      .lean();

    if (batch.length === 0) {
      break;
    }

    chunkIndex += 1;
    for (const doc of batch) {
      onDoc(doc);
    }
    scanned += batch.length;
    lastId = batch[batch.length - 1]._id;

    console.log(
      `[Top Postcodes Cron] ${label} chunk ${chunkIndex}: +${batch.length} (total ${scanned})`,
    );

    if (batch.length < CHUNK_SIZE) {
      break;
    }

    if (CHUNK_DELAY_MS > 0) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

  return { chunks: chunkIndex, scanned };
}

async function accumulateOrderBreakdown() {
  const orderCounts = new Map();
  let totalOrders = 0;
  let withValidPostcode = 0;
  let invalidPostcodes = 0;

  const scan = await forEachDocumentChunk(
    Task,
    ORDER_MATCH,
    (doc) => {
      totalOrders += 1;
      const prefix = extractPostcodePrefix(doc.postcode);
      if (!prefix) {
        invalidPostcodes += 1;
        return;
      }
      withValidPostcode += 1;
      orderCounts.set(prefix, (orderCounts.get(prefix) || 0) + 1);
    },
    'orders',
  );

  const topRows = [...orderCounts.entries()]
    .map(([postcode, orders]) => ({ postcode, orders }))
    .sort((a, b) => b.orders - a.orders || a.postcode.localeCompare(b.postcode))
    .slice(0, MAX_LIMIT);

  return {
    topRows,
    totalOrders,
    withValidPostcode,
    invalidPostcodes,
    uniquePostcodeAreas: orderCounts.size,
    scan,
  };
}

async function accumulateQuoteBreakdown(topPostcodes) {
  const prefixSet = new Set(topPostcodes.filter(Boolean));
  const quoteCounts = new Map();
  let totalQuotes = 0;
  let withValidPostcode = 0;
  let invalidPostcodes = 0;
  const seenPrefixes = new Set();

  const scan = await forEachDocumentChunk(
    QuotationRequest,
    QUOTE_MATCH,
    (doc) => {
      totalQuotes += 1;
      const prefix = extractPostcodePrefix(doc.postcode);
      if (!prefix) {
        invalidPostcodes += 1;
        return;
      }
      withValidPostcode += 1;
      seenPrefixes.add(prefix);
      if (prefixSet.has(prefix)) {
        quoteCounts.set(prefix, (quoteCounts.get(prefix) || 0) + 1);
      }
    },
    'quotes',
  );

  const quoteCountsObj = {};
  for (const [prefix, count] of quoteCounts.entries()) {
    quoteCountsObj[prefix] = count;
  }

  return {
    quoteCounts: quoteCountsObj,
    totalQuotes,
    withValidPostcode,
    invalidPostcodes,
    uniquePostcodeAreas: seenPrefixes.size,
    scan,
  };
}

function buildPostcodeRows(topOrderRows, quoteCounts) {
  const maxOrders = topOrderRows[0]?.orders || 0;

  return topOrderRows.map((row, index) => ({
    rank: index + 1,
    postcode: row.postcode,
    orders: row.orders,
    quotes: quoteCounts[row.postcode] || 0,
    sharePercent: maxOrders > 0 ? roundPercent((row.orders / maxOrders) * 100) : 0,
    color: BAR_COLORS[index % BAR_COLORS.length],
  }));
}

async function computeTopPostcodesSnapshot(limit = MAX_LIMIT) {
  const rowLimit = clampLimit(limit);

  const orderBreakdown = await accumulateOrderBreakdown();
  const topRows = orderBreakdown.topRows.slice(0, rowLimit);

  const quoteBreakdown = await accumulateQuoteBreakdown(
    topRows.map((row) => row.postcode),
  );

  const postcodes = buildPostcodeRows(topRows, quoteBreakdown.quoteCounts);

  const totals = postcodes.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orders,
      quotes: acc.quotes + row.quotes,
    }),
    { orders: 0, quotes: 0 },
  );

  return {
    postcodes,
    totals,
    orderAttribution: {
      totalOrders: orderBreakdown.totalOrders,
      withValidPostcode: orderBreakdown.withValidPostcode,
      invalidPostcodes: orderBreakdown.invalidPostcodes,
      uniquePostcodeAreas: orderBreakdown.uniquePostcodeAreas,
    },
    quoteAttribution: {
      totalQuotes: quoteBreakdown.totalQuotes,
      withValidPostcode: quoteBreakdown.withValidPostcode,
      invalidPostcodes: quoteBreakdown.invalidPostcodes,
      uniquePostcodeAreas: quoteBreakdown.uniquePostcodeAreas,
    },
    grouping: {
      level: 'outward',
      description: 'Postcodes grouped by outward code (e.g. SW1A from SW1A 2AA)',
    },
    limit: rowLimit,
    scanStats: {
      orderChunks: orderBreakdown.scan.chunks,
      ordersScanned: orderBreakdown.scan.scanned,
      quoteChunks: quoteBreakdown.scan.chunks,
      quotesScanned: quoteBreakdown.scan.scanned,
      chunkSize: CHUNK_SIZE,
      chunkDelayMs: CHUNK_DELAY_MS,
    },
  };
}

async function updateTopPostcodesCache() {
  const computedAt = new Date();
  const snapshot = await computeTopPostcodesSnapshot(MAX_LIMIT);

  await TopPostcodesSnapshot.findOneAndUpdate(
    { key: CACHE_KEY },
    {
      $set: {
        key: CACHE_KEY,
        postcodes: snapshot.postcodes,
        totals: snapshot.totals,
        orderAttribution: snapshot.orderAttribution,
        quoteAttribution: snapshot.quoteAttribution,
        grouping: snapshot.grouping,
        limit: snapshot.limit,
        computedAt,
      },
    },
    { upsert: true, new: true },
  );

  return {
    computedAt,
    rowsCached: snapshot.postcodes.length,
    totals: snapshot.totals,
    scanStats: snapshot.scanStats,
  };
}

async function isTopPostcodesCacheStale() {
  const snapshot = await TopPostcodesSnapshot.findOne({ key: CACHE_KEY })
    .select('computedAt')
    .lean();

  if (!snapshot?.computedAt) {
    return true;
  }

  return Date.now() - new Date(snapshot.computedAt).getTime() > TOP_POSTCODES_STALE_MS;
}

/**
 * Serve cached all-time top postcodes (refreshed by biweekly cron).
 * Date-range query params are ignored.
 */
async function getTopPostcodes({ limit = DEFAULT_LIMIT } = {}) {
  const rowLimit = clampLimit(limit);
  const snapshot = await TopPostcodesSnapshot.findOne({ key: CACHE_KEY }).lean();

  if (!snapshot?.computedAt) {
    throw new Error('Top postcodes cache is not ready yet');
  }

  const postcodes = (snapshot.postcodes || []).slice(0, rowLimit);
  const totals = postcodes.reduce(
    (acc, row) => ({
      orders: acc.orders + (row.orders || 0),
      quotes: acc.quotes + (row.quotes || 0),
    }),
    { orders: 0, quotes: 0 },
  );

  return {
    badge: {
      label: 'Cached · biweekly',
      icon: 'location',
    },
    grouping: snapshot.grouping || {
      level: 'outward',
      description: 'Postcodes grouped by outward code (e.g. SW1A from SW1A 2AA)',
    },
    orderAttribution: snapshot.orderAttribution || {},
    quoteAttribution: snapshot.quoteAttribution || {},
    postcodes,
    totals,
    limit: rowLimit,
    computedAt: snapshot.computedAt ? new Date(snapshot.computedAt).toISOString() : null,
    dateFilterApplied: false,
    dataSources: {
      orders:
        'TopPostcodesSnapshot — all-time public orders with paymentStatus not Failed, excluding createdBy MigrationScript, aggregated by postcode outward code in paced chunks (refreshed by biweekly cron)',
      quotes: 'Cached quote counts for the returned postcode areas only',
      ranking: 'Postcode areas ranked by order count from cached snapshot; date filters not applied',
    },
  };
}

module.exports = {
  getTopPostcodes,
  updateTopPostcodesCache,
  isTopPostcodesCacheStale,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
