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

  /** @type {Map<string, Array<{ lead: object, task: object, matchBy: string }>>} */
  const claimsByOrderId = new Map();
  const syncedAt = new Date();

  for (const lead of leads) {
    const result = findMatchingOrderForLead(lead, { byPhone, byEmail, windowDays });

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
    if (!claimsByOrderId.has(orderKey)) claimsByOrderId.set(orderKey, []);
    claimsByOrderId.get(orderKey).push({ lead, task, matchBy: result.matchBy });
  }

  /** @type {Array<{ lead: object, task: object, matchBy: string }>} */
  const winners = [];
  for (const claims of claimsByOrderId.values()) {
    const sorted = [...claims].sort((a, b) => {
      const aMs = new Date(a.lead.createdAt).getTime();
      const bMs = new Date(b.lead.createdAt).getTime();
      if (bMs !== aMs) return bMs - aMs; // latest lead before the order wins
      return String(b.lead.id).localeCompare(String(a.lead.id));
    });
    const winner = sorted[0];
    winners.push(winner);
    summary.matched += 1;

    if (sorted.length > 1) {
      summary.alreadyClaimed += sorted.length - 1;
      if (summary.samples.length < 20) {
        summary.samples.push({
          leadId: winner.lead.id,
          orderNumber: winner.task.orderNumber,
          status: 'multi_lead_picked_latest',
          losingLeadIds: sorted.slice(1).map((c) => c.lead.id),
          matchBy: winner.matchBy,
        });
      }
    }
  }

  for (const { lead, task, matchBy } of winners) {
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
