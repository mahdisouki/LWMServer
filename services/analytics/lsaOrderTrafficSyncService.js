/**
 * Match Google Ads Local Services leads → Task orders and stamp trafficSource LSA.
 *
 * Rules:
 *  - Match email first, then phone (never name) — email is more reliable than phone
 *  - Lead must be before (or at) the order, within windowDays
 *  - Several orders on the same channel → pick the soonest order after the lead
 *  - Several leads → same order → pick the latest lead still before the order
 *  - Overwrite Organic / null / Direct only
 *  - Scope: createdByType public + Admin
 */
const Task = require('../../models/Task');
const {
  TRAFFIC_SOURCES,
  canApplyLsaTrafficSource,
} = require('../../utils/trafficSource');
const {
  normalizeEmail,
  normalizePhone,
} = require('../quotationTaskMatchingService');
const { excludeMigratedOrdersFilter } = require('./taskFilters');
const {
  DEFAULT_LOOKBACK_DAYS,
  withLsaLeadPages,
} = require('./lsaLeadsService');

const LEAD_BATCH_SIZE = 100;

const DEFAULT_WINDOW_DAYS = Math.min(
  Math.max(parseInt(process.env.LSA_ORDER_MATCH_WINDOW_DAYS, 10) || 7, 1),
  30,
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function orderInLeadWindow(leadCreatedAt, orderCreatedAt, windowDays) {
  if (!leadCreatedAt || !orderCreatedAt) return false;
  const leadMs = leadCreatedAt.getTime();
  const orderMs = orderCreatedAt.getTime();
  if (orderMs < leadMs) return false;
  return orderMs - leadMs <= windowDays * MS_PER_DAY;
}

function buildPhoneIndex(tasks) {
  const byPhone = new Map();
  for (const task of tasks) {
    for (const raw of [task.phoneNumber, task.phoneNumber2]) {
      const phone = normalizePhone(raw);
      if (!phone) continue;
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone).push(task);
    }
  }
  return byPhone;
}

function buildEmailIndex(tasks) {
  const byEmail = new Map();
  for (const task of tasks) {
    const email = normalizeEmail(task.email);
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(task);
  }
  return byEmail;
}

function uniqueTasks(tasks) {
  const seen = new Set();
  const out = [];
  for (const task of tasks) {
    const key = String(task._id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(task);
  }
  return out;
}

/** Soonest order after the lead (same idea as Call CSV earliest-after-call). */
function pickSoonestOrderAfterLead(hits) {
  if (!hits.length) return null;
  return [...hits].sort(
    (a, b) =>
      new Date(a.createdAt) - new Date(b.createdAt)
      || String(a._id).localeCompare(String(b._id)),
  )[0];
}

/**
 * Email first; if email missing or yields 0 matches, fall through to phone.
 * Several hits → pick the soonest order after the lead (do not skip).
 */
function findMatchingOrderForLead(lead, { byPhone, byEmail, windowDays }) {
  const leadPhone = normalizePhone(lead.phone);
  const leadEmail = normalizeEmail(lead.email);

  if (leadEmail) {
    const emailHits = uniqueTasks(
      (byEmail.get(leadEmail) || []).filter((task) =>
        orderInLeadWindow(lead.createdAt, new Date(task.createdAt), windowDays),
      ),
    );
    if (emailHits.length >= 1) {
      return {
        task: pickSoonestOrderAfterLead(emailHits),
        matchBy: 'email',
        ambiguous: false,
        candidates: emailHits.length,
      };
    }
  }

  if (leadPhone) {
    const phoneHits = uniqueTasks(
      (byPhone.get(leadPhone) || []).filter((task) =>
        orderInLeadWindow(lead.createdAt, new Date(task.createdAt), windowDays),
      ),
    );
    if (phoneHits.length >= 1) {
      return {
        task: pickSoonestOrderAfterLead(phoneHits),
        matchBy: 'phone',
        ambiguous: false,
        candidates: phoneHits.length,
      };
    }
  }

  return { task: null, matchBy: null, ambiguous: false, candidates: 0 };
}

async function loadCandidateOrders({ earliestLeadAt, latestOrderAt }) {
  return Task.find({
    createdAt: {
      $gte: earliestLeadAt,
      $lte: latestOrderAt,
    },
    paymentStatus: { $ne: 'Failed' },
    createdByType: { $in: ['public', 'Admin'] },
    $or: [
      { trafficSource: TRAFFIC_SOURCES.ORGANIC },
      { trafficSource: TRAFFIC_SOURCES.DIRECT },
      { trafficSource: { $exists: false } },
      { trafficSource: null },
    ],
    ...excludeMigratedOrdersFilter,
  })
    .select(
      '_id orderNumber email phoneNumber phoneNumber2 trafficSource createdAt createdByType',
    )
    .lean();
}

function leadIsLater(lead, otherLead) {
  const leadMs = new Date(lead.createdAt).getTime();
  const otherMs = new Date(otherLead.createdAt).getTime();
  if (leadMs !== otherMs) return leadMs > otherMs;
  return String(lead.id).localeCompare(String(otherLead.id)) > 0;
}

/**
 * @param {{ lookbackDays?: number, windowDays?: number, dryRun?: boolean }} [opts]
 */
async function syncLsaOrderTrafficSources({
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  windowDays = DEFAULT_WINDOW_DAYS,
  dryRun = false,
} = {}) {
  const summary = {
    skipped: false,
    reason: null,
    error: null,
    dryRun,
    startKey: null,
    endKey: null,
    lookbackDays,
    windowDays,
    leadsFetched: 0,
    candidates: 0,
    matched: 0,
    updated: 0,
    noMatch: 0,
    ambiguous: 0,
    alreadyClaimed: 0,
    notApplicable: 0,
    errors: 0,
    samples: [],
  };

  /** One winning lead per order. Latest lead before the order still wins across batches. */
  const bestByOrderId = new Map();
  const candidateIds = new Set();
  const syncedAt = new Date();

  function rememberClaim(lead, task, matchBy) {
    const orderKey = String(task._id);
    const current = bestByOrderId.get(orderKey);
    if (!current) {
      bestByOrderId.set(orderKey, { lead, task, matchBy, losingLeadIds: [] });
      return;
    }

    summary.alreadyClaimed += 1;
    if (leadIsLater(lead, current.lead)) {
      const losingLeadIds = current.losingLeadIds.slice();
      if (losingLeadIds.length < 19) losingLeadIds.push(String(current.lead.id));
      bestByOrderId.set(orderKey, { lead, task, matchBy, losingLeadIds });
      return;
    }
    if (current.losingLeadIds.length < 19) {
      current.losingLeadIds.push(String(lead.id));
    }
  }

  async function matchLeadBatch(batch) {
    const earliestLeadAt = batch[0].createdAt;
    const latestLeadAt = batch[batch.length - 1].createdAt;
    const latestOrderAt = new Date(latestLeadAt.getTime() + windowDays * MS_PER_DAY);
    const candidates = await loadCandidateOrders({ earliestLeadAt, latestOrderAt });

    for (const task of candidates) candidateIds.add(String(task._id));

    const byPhone = buildPhoneIndex(candidates);
    const byEmail = buildEmailIndex(candidates);

    for (const lead of batch) {
      const result = findMatchingOrderForLead(lead, { byPhone, byEmail, windowDays });
      if (!result.task) {
        summary.noMatch += 1;
        continue;
      }
      if (!canApplyLsaTrafficSource(result.task.trafficSource)) {
        summary.notApplicable += 1;
        continue;
      }
      rememberClaim(lead, result.task, result.matchBy);
    }
  }

  const fetched = await withLsaLeadPages({ lookbackDays }, async (page) => {
    summary.leadsFetched += page.length;
    for (let i = 0; i < page.length; i += LEAD_BATCH_SIZE) {
      const batch = page.slice(i, i + LEAD_BATCH_SIZE);
      await matchLeadBatch(batch);
      page.fill(null, i, i + batch.length);
    }
  });

  summary.skipped = !fetched.available;
  summary.reason = fetched.reason || null;
  summary.error = fetched.error || null;
  summary.startKey = fetched.startKey;
  summary.endKey = fetched.endKey;
  summary.lookbackDays = fetched.lookbackDays;
  summary.candidates = candidateIds.size;
  summary.matched = bestByOrderId.size;

  if (!fetched.available || summary.leadsFetched === 0) {
    return summary;
  }

  for (const claim of bestByOrderId.values()) {
    if (claim.losingLeadIds.length && summary.samples.length < 20) {
      summary.samples.push({
        leadId: claim.lead.id,
        orderNumber: claim.task.orderNumber,
        status: 'multi_lead_picked_latest',
        losingLeadIds: claim.losingLeadIds,
        matchBy: claim.matchBy,
      });
    }
  }

  for (const { lead, task, matchBy } of bestByOrderId.values()) {
    if (summary.samples.length < 20) {
      summary.samples.push({
        leadId: lead.id,
        orderNumber: task.orderNumber,
        from: task.trafficSource || null,
        to: TRAFFIC_SOURCES.LSA,
        matchBy,
        createdByType: task.createdByType,
      });
    }

    if (dryRun) {
      summary.updated += 1;
      continue;
    }

    try {
      const updateResult = await Task.updateOne(
        {
          _id: task._id,
          createdByType: { $in: ['public', 'Admin'] },
          $or: [
            { trafficSource: TRAFFIC_SOURCES.ORGANIC },
            { trafficSource: TRAFFIC_SOURCES.DIRECT },
            { trafficSource: { $exists: false } },
            { trafficSource: null },
          ],
        },
        {
          $set: {
            trafficSource: TRAFFIC_SOURCES.LSA,
            lsaLeadId: String(lead.id),
            lsaTrafficSyncedAt: syncedAt,
          },
        },
      );
      if (updateResult.modifiedCount > 0) {
        summary.updated += 1;
      } else {
        summary.notApplicable += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(
        `[LSA Order Traffic Sync] Failed order ${task.orderNumber}:`,
        error.message,
      );
    }
  }

  return summary;
}

module.exports = {
  syncLsaOrderTrafficSources,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_WINDOW_DAYS,
  orderInLeadWindow,
  findMatchingOrderForLead,
};
