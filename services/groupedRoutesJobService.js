const axios = require('axios');
const crypto = require('crypto');
const Task = require('../models/Task');
const TippingRequest = require('../models/TippingRequest');
const Truck = require('../models/Truck');
const RouteOptimizerJob = require('../models/RouteOptimizerJob');
const dailySheetController = require('../controllers/dailySheetController');
const { truckDisplayName } = require('../utils/truckHelpers');
const {
  assignTaskFromRouteSegment,
  buildTaskOwnershipPlan,
  persistTaskOwnershipPlan,
  clearTaskAssignmentFilter,
  clearTaskAssignmentUpdate,
} = require('../utils/multiUnitTaskAssignment');

const EXTERNAL_ROUTE_OPTIMIZER_URL = (
  process.env.EXTERNAL_ROUTE_OPTIMIZER_URL || 'https://routeoptimiser.duckdns.org'
).replace(/\/$/, '');

const COMPARE_GROUPED_PATH =
  process.env.EXTERNAL_COMPARE_GROUPED_API_PATH || '/api/v1/compare-grouped';

/** How long Node waits when kicking off Python (expect 202 quickly). */
const START_TIMEOUT_MS =
  Number(process.env.ROUTE_OPTIMIZER_ASYNC_START_TIMEOUT_MS) || 15000;

/** Fallback if Python still runs sync and never callbacks. */
const SYNC_FALLBACK_TIMEOUT_MS =
  Number(process.env.ROUTE_OPTIMIZER_SYNC_FALLBACK_TIMEOUT_MS) || 600000;

function newJobId() {
  return crypto.randomUUID();
}

function resolveCallbackBaseUrl(req) {
  const fromEnv = (
    process.env.ROUTE_OPTIMIZER_CALLBACK_BASE_URL ||
    process.env.PUBLIC_API_BASE_URL ||
    ''
  ).replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function buildCallbackUrl(req) {
  return `${resolveCallbackBaseUrl(req)}/api/route-optimizer/external/grouped-routes/callback`;
}

function dayBoundsFromDateStr(dateStr) {
  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
  return { startOfDay, endOfDay };
}

async function notifyGroupedRoutesJob(job, extra = {}) {
  try {
    const { emitToUser, emitToAllOnlineAdmins } = require('../socket');
    const payload = {
      jobId: job.jobId,
      status: job.status,
      date: job.date,
      assignedCount: job.assignedCount || 0,
      winner: job.result?.winner ?? null,
      winner_reason: job.result?.winner_reason ?? null,
      error: job.error || null,
      ...extra,
    };
    if (job.createdBy) {
      emitToUser(job.createdBy, 'routeOptimizer:groupedDone', payload);
    }
    await emitToAllOnlineAdmins('routeOptimizer:groupedDone', payload);
  } catch (err) {
    console.warn(
      '[RouteOptimizer:groupedJob] socket notify failed:',
      err.message
    );
  }
}

/**
 * Persist compare-grouped routes onto trucks/tasks (same logic as previous sync handler).
 */
async function applyGroupedRoutesResult({
  dateStr,
  truckIds,
  routes,
  externalData = {},
}) {
  const { startOfDay, endOfDay } = dayBoundsFromDateStr(dateStr);
  const consideredTruckIds = (truckIds || []).map((id) => id);
  const routeKeys = Object.keys(routes || {});

  if (consideredTruckIds.length) {
    await Task.updateMany(
      clearTaskAssignmentFilter(startOfDay, endOfDay, consideredTruckIds),
      clearTaskAssignmentUpdate()
    );
  }

  // Same task on several truck routes → one primary, rest escorts (chosen here).
  const ownershipPlan = buildTaskOwnershipPlan(routes);
  await persistTaskOwnershipPlan(Task, ownershipPlan);

  const trucks = await Truck.find({ _id: { $in: consideredTruckIds } });
  const truckById = new Map(trucks.map((t) => [t._id.toString(), t]));

  let assignedCount = 0;
  for (const routeKey of routeKeys) {
    const truck = truckById.get(String(routeKey));
    if (!truck) {
      console.log(
        '[RouteOptimizer:groupedJob] routeKey=%s no truck matched (skip)',
        routeKey
      );
      continue;
    }

    if (!truck.tasks) truck.tasks = new Map();
    truck.tasks.set(dateStr, []);
    truck.markModified('tasks');

    const routeSegments = Array.isArray(routes[routeKey]?.route_segments)
      ? routes[routeKey].route_segments
      : [];

    let assignedThisTruck = 0;
    for (let i = 0; i < routeSegments.length; i++) {
      const segment = routeSegments[i];
      if (!segment || typeof segment !== 'object') continue;

      const rawTaskId = segment.taskId;
      const taskId =
        typeof rawTaskId === 'string'
          ? rawTaskId
          : rawTaskId && typeof rawTaskId === 'object' && rawTaskId.$oid
            ? rawTaskId.$oid
            : null;
      if (!taskId) continue;

      const order = Number.isFinite(Number(segment.order))
        ? Number(segment.order)
        : i + 1;
      const segType =
        segment.type === 'TippingRequest' ? 'TippingRequest' : 'task';

      if (segType === 'TippingRequest') {
        await TippingRequest.findByIdAndUpdate(taskId, {
          truckId: truck._id,
        });
        truck.addTippingRequest(dateStr, taskId, order);
      } else {
        await assignTaskFromRouteSegment(
          Task,
          taskId,
          truck._id,
          segment,
          ownershipPlan,
        );
        truck.addTask(dateStr, taskId, order);
      }
      assignedCount += 1;
      assignedThisTruck += 1;
    }

    console.log(
      '[RouteOptimizer:groupedJob] truck %s assigned %d',
      truckDisplayName(truck),
      assignedThisTruck
    );
    await truck.save();
  }

  try {
    const mockReq = { body: { date: dateStr } };
    const mockRes = { status: () => ({ json: () => {} }), json: () => {} };
    await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
  } catch (dailySheetErr) {
    console.error(
      '[RouteOptimizer:groupedJob] daily sheet sync error',
      dailySheetErr
    );
  }

  const externalSummary =
    externalData.summary && typeof externalData.summary === 'object'
      ? externalData.summary
      : {};

  return {
    assignedCount,
    summary: {
      date: dateStr,
      trucks_used: routeKeys.length,
      ...externalSummary,
      assigned: assignedCount,
    },
    winner: externalData.winner ?? null,
    winner_reason: externalData.winner_reason ?? null,
    routes,
    api_calls_used: externalData.api_calls_used ?? 0,
    success: externalData.success !== false,
  };
}

/**
 * Atomically claim a processing job so Python callback retries do not double-apply.
 * @returns {Promise<object|null>} claimed job or null if already claimed/finalized
 */
async function claimGroupedJobForApply(jobId) {
  return RouteOptimizerJob.findOneAndUpdate(
    { jobId, status: 'processing' },
    { $set: { status: 'applying', updatedAt: new Date() } },
    { new: true }
  );
}

async function completeGroupedJobSuccess(job, externalData) {
  const routes = externalData.routes || {};
  const applied = await applyGroupedRoutesResult({
    dateStr: job.date,
    truckIds: job.truckIds,
    routes,
    externalData,
  });

  job.status = 'done';
  job.assignedCount = applied.assignedCount;
  job.result = {
    success: applied.success,
    winner: applied.winner,
    winner_reason: applied.winner_reason,
    routes: applied.routes,
    api_calls_used: applied.api_calls_used,
    summary: applied.summary,
  };
  job.error = '';
  job.completedAt = new Date();
  await job.save();

  await notifyGroupedRoutesJob(job);
  return job;
}

async function completeGroupedJobFailure(job, errorMessage) {
  job.status = 'failed';
  job.error = String(errorMessage || 'grouped routes failed');
  job.completedAt = new Date();
  await job.save();
  await notifyGroupedRoutesJob(job);
  return job;
}

/**
 * Tell Python to run compare-grouped in background (job_id + callback_url).
 * If Python still returns 200 with routes, apply immediately (sync fallback).
 */
async function startCompareGroupedOnPython(job, callbackUrl) {
  const url = `${EXTERNAL_ROUTE_OPTIMIZER_URL}${COMPARE_GROUPED_PATH}`;
  const body = {
    ...(job.requestPayload || {}),
    job_id: job.jobId,
    callback_url: callbackUrl,
  };

  const headers = { 'Content-Type': 'application/json' };
  const secret = process.env.ROUTE_OPTIMIZER_CALLBACK_SECRET;
  if (secret) headers['x-route-optimizer-secret'] = secret;

  console.log(
    '[RouteOptimizer:groupedJob] start python jobId=%s url=%s',
    job.jobId,
    url
  );

  // Prefer quick 202; if Python is still sync, allow long wait in this background task.
  const { data, status } = await axios.post(url, body, {
    timeout: SYNC_FALLBACK_TIMEOUT_MS,
    validateStatus: () => true,
    headers,
  });

  if (status === 202) {
    console.log(
      '[RouteOptimizer:groupedJob] python accepted async jobId=%s',
      job.jobId
    );
    return { mode: 'async' };
  }

  if (status === 200 && data && typeof data === 'object' && data.routes) {
    console.log(
      '[RouteOptimizer:groupedJob] python returned sync result jobId=%s',
      job.jobId
    );
    const claimed = await claimGroupedJobForApply(job.jobId);
    if (claimed) {
      await completeGroupedJobSuccess(claimed, data);
    }
    return { mode: 'sync' };
  }

  const message =
    data?.detail ||
    data?.message ||
    data?.error ||
    `Python compare-grouped failed (HTTP ${status})`;
  throw new Error(
    typeof message === 'string' ? message : JSON.stringify(message)
  );
}

async function createAndKickCompareGroupedJob({
  dateStr,
  truckIds,
  requestPayload,
  createdBy,
  callbackUrl,
}) {
  const jobId = newJobId();
  const job = await RouteOptimizerJob.create({
    jobId,
    kind: 'compare_grouped',
    status: 'processing',
    date: dateStr,
    truckIds,
    requestPayload,
    createdBy: createdBy || null,
  });

  // Background: do not block the HTTP response.
  setImmediate(() => {
    startCompareGroupedOnPython(job, callbackUrl).catch(async (err) => {
      console.error(
        '[RouteOptimizer:groupedJob] start failed jobId=%s:',
        jobId,
        err.message
      );
      try {
        const fresh = await RouteOptimizerJob.findOne({ jobId });
        if (fresh && fresh.status === 'processing') {
          await completeGroupedJobFailure(fresh, err.message);
        }
      } catch (e) {
        console.error(
          '[RouteOptimizer:groupedJob] mark failed error:',
          e.message
        );
      }
    });
  });

  return job;
}

function assertCallbackSecret(req) {
  const expected = process.env.ROUTE_OPTIMIZER_CALLBACK_SECRET;
  if (!expected) return true;
  const got =
    req.get('x-route-optimizer-secret') ||
    req.body?.secret ||
    req.query?.secret;
  return got === expected;
}

module.exports = {
  newJobId,
  buildCallbackUrl,
  createAndKickCompareGroupedJob,
  claimGroupedJobForApply,
  completeGroupedJobSuccess,
  completeGroupedJobFailure,
  applyGroupedRoutesResult,
  notifyGroupedRoutesJob,
  assertCallbackSecret,
  START_TIMEOUT_MS,
};
