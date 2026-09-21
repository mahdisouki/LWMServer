/**
 * Match Google Ads Local Services leads → Task orders and stamp trafficSource LSA.
 *
 * Rules:
 *  - Match phone first, then email (never name)
 *  - Lead must be before (or at) the order, within windowDays
 *  - Ambiguous matches (multiple orders) → skip
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
  fetchLsaLeads,
} = require('./lsaLeadsService');

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

/**
 * Phone first; if phone present and yields 0 matches, fall through to email.
 * Multiple matches at the chosen channel → ambiguous (null + flag).
 */
function findMatchingOrderForLead(lead, { byPhone, byEmail, windowDays }) {
  const leadPhone = normalizePhone(lead.phone);
  const leadEmail = normalizeEmail(lead.email);

  if (leadPhone) {
    const phoneHits = uniqueTasks(
      (byPhone.get(leadPhone) || []).filter((task) =>
        orderInLeadWindow(lead.createdAt, new Date(task.createdAt), windowDays),
      ),
    );
    if (phoneHits.length === 1) {
      return { task: phoneHits[0], matchBy: 'phone', ambiguous: false };
    }
    if (phoneHits.length > 1) {
      return { task: null, matchBy: 'phone', ambiguous: true, candidates: phoneHits.length };
    }
  }

  if (leadEmail) {
    const emailHits = uniqueTasks(
      (byEmail.get(leadEmail) || []).filter((task) =>
        orderInLeadWindow(lead.createdAt, new Date(task.createdAt), windowDays),
      ),
    );
    if (emailHits.length === 1) {
      return { task: emailHits[0], matchBy: 'email', ambiguous: false };
    }
    if (emailHits.length > 1) {
      return { task: null, matchBy: 'email', ambiguous: true, candidates: emailHits.length };
    }
  }

  return { task: null, matchBy: null, ambiguous: false };
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

/**
 * @param {{ lookbackDays?: number, windowDays?: number, dryRun?: boolean }} [opts]
 */
async function syncLsaOrderTrafficSources({
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  windowDays = DEFAULT_WINDOW_DAYS,
  dryRun = false,
} = {}) {
  const fetched = await fetchLsaLeads({ lookbackDays });

  const summary = {
    skipped: !fetched.available,
    reason: fetched.reason || null,
    error: fetched.error || null,
    dryRun,
    startKey: fetched.startKey,
    endKey: fetched.endKey,
    lookbackDays: fetched.lookbackDays,
    windowDays,
    leadsFetched: fetched.leads.length,
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

  if (!fetched.available) {
    return summary;
  }

  const leads = fetched.leads;
  if (!leads.length) {
    return summary;
  }

  const earliestLeadAt = leads[0].createdAt;
  const latestLeadAt = leads[leads.length - 1].createdAt;
  const latestOrderAt = new Date(latestLeadAt.getTime() + windowDays * MS_PER_DAY);

  const candidates = await loadCandidateOrders({ earliestLeadAt, latestOrderAt });
  summary.candidates = candidates.length;

  const byPhone = buildPhoneIndex(candidates);
  const byEmail = buildEmailIndex(candidates);

  /** @type {Map<string, { lead: object, task: object, matchBy: string }>} */
  const claimedByOrderId = new Map();
  const syncedAt = new Date();

  for (const lead of leads) {
    const result = findMatchingOrderForLead(lead, { byPhone, byEmail, windowDays });

    if (result.ambiguous) {
      summary.ambiguous += 1;
      if (summary.samples.length < 20) {
        summary.samples.push({
          leadId: lead.id,
          status: 'ambiguous',
          matchBy: result.matchBy,
          candidates: result.candidates,
        });
      }
      continue;
    }

    if (!result.task) {
      summary.noMatch += 1;
      continue;
    }

    const task = result.task;
    if (!canApplyLsaTrafficSource(task.trafficSource)) {
      summary.notApplicable += 1;
      continue;
    }

    const orderKey = String(task._id);
    if (claimedByOrderId.has(orderKey)) {
      // Two leads → same order: skip both (do not keep first claim).
      const prior = claimedByOrderId.get(orderKey);
      claimedByOrderId.delete(orderKey);
      summary.alreadyClaimed += 1;
      summary.matched = Math.max(0, summary.matched - 1);
      if (summary.samples.length < 20) {
        summary.samples.push({
          leadId: lead.id,
          priorLeadId: prior.lead.id,
          orderNumber: task.orderNumber,
          status: 'ambiguous_multi_lead',
        });
      }
      summary.ambiguous += 1;
      continue;
    }

    summary.matched += 1;
    claimedByOrderId.set(orderKey, { lead, task, matchBy: result.matchBy });
  }

  for (const { lead, task, matchBy } of claimedByOrderId.values()) {
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
