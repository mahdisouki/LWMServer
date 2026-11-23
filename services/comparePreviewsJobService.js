const axios = require('axios');
const crypto = require('crypto');
const RouteOptimizerJob = require('../models/RouteOptimizerJob');

const EXTERNAL_ROUTE_OPTIMIZER_URL = (
  process.env.EXTERNAL_ROUTE_OPTIMIZER_URL || 'https://routeoptimiser.duckdns.org'
).replace(/\/$/, '');

const COMPARE_ROUTES_PATH =
  process.env.EXTERNAL_COMPARE_ROUTES_API_PATH || '/api/v1/compare-routes';

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

function buildComparePreviewsCallbackUrl(req) {
  return `${resolveCallbackBaseUrl(req)}/api/route-optimizer/external/compare-route-previews/callback`;
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

async function claimComparePreviewsJob(jobId) {
  return RouteOptimizerJob.findOneAndUpdate(
    { jobId, status: 'processing', kind: 'compare_previews' },
    { $set: { status: 'applying', updatedAt: new Date() } },
    { new: true }
  );
}

async function notifyComparePreviewsJob(job, extra = {}) {
  try {
    const { emitToUser, emitToAllOnlineAdmins } = require('../socket');
    const payload = {
      jobId: job.jobId,
      status: job.status,
      date: job.date,
      comparisonId: job.result?.comparisonId ?? null,
      compareMode: job.result?.compareMode ?? null,
      options: job.result?.options ?? null,
      comparison: job.result?.comparison ?? null,
      expiresAt: job.result?.expiresAt ?? null,
      error: job.error || null,
      ...extra,
    };
    if (job.createdBy) {
      emitToUser(job.createdBy, 'routeOptimizer:comparePreviewsDone', payload);
    }
    await emitToAllOnlineAdmins(
      'routeOptimizer:comparePreviewsDone',
      payload
    );
  } catch (err) {
    console.warn(
      '[RouteOptimizer:comparePreviews] socket notify failed:',
      err.message
    );
  }
}

async function completeComparePreviewsFailure(job, errorMessage) {
  job.status = 'failed';
  job.error = String(errorMessage || 'compare route previews failed');
  job.completedAt = new Date();
  await job.save();
  await notifyComparePreviewsJob(job);
  return job;
}

async function completeComparePreviewsSuccess(job, externalData) {
  // Lazy require avoids circular load with routeOptimizerCtrl.
  const {
    finalizeComparePreviewsFromExternalData,
  } = require('../controllers/routeOptimizerCtrl');

  const finalized = await finalizeComparePreviewsFromExternalData(
    job,
    externalData
  );

  job.status = 'done';
  job.result = finalized;
  job.error = '';
  job.completedAt = new Date();
  await job.save();

  await notifyComparePreviewsJob(job);
  return job;
}

/**
 * Kick Python compare-routes with job_id + callback_url.
 * Sync 200 response is finalized immediately; 202 waits for callback.
 * 404 → Node dual-fallback via controller helper.
 */
async function startComparePreviewsOnPython(job, callbackUrl) {
  const url = `${EXTERNAL_ROUTE_OPTIMIZER_URL}${COMPARE_ROUTES_PATH}`;
  const body = {
    ...(job.requestPayload || {}),
    job_id: job.jobId,
    callback_url: callbackUrl,
  };

  const headers = { 'Content-Type': 'application/json' };
  const secret = process.env.ROUTE_OPTIMIZER_CALLBACK_SECRET;
  if (secret) headers['x-route-optimizer-secret'] = secret;

  console.log(
    '[RouteOptimizer:comparePreviews] start python jobId=%s url=%s',
    job.jobId,
    url
  );

  const { data, status } = await axios.post(url, body, {
    timeout: SYNC_FALLBACK_TIMEOUT_MS,
    validateStatus: () => true,
    headers,
  });

  if (status === 202) {
    console.log(
      '[RouteOptimizer:comparePreviews] python accepted async jobId=%s',
      job.jobId
    );
    return { mode: 'async' };
  }

  if (status === 404 || status === 405) {
    console.log(
      '[RouteOptimizer:comparePreviews] compare-routes unavailable, dual-fallback jobId=%s',
      job.jobId
    );
    const claimed = await claimComparePreviewsJob(job.jobId);
    if (claimed) {
      const {
        finalizeComparePreviewsDualFallback,
      } = require('../controllers/routeOptimizerCtrl');
      const externalData = await finalizeComparePreviewsDualFallback(claimed);
      await completeComparePreviewsSuccess(claimed, externalData);
    }
    return { mode: 'dual-fallback' };
  }

  const hasCompareShape =
    data &&
    typeof data === 'object' &&
    ((data.calculate_routes && data.calculate_routes.routes) ||
      (data.custom && data.custom.routes) ||
      data.routes);

  if (status === 200 && hasCompareShape) {
    console.log(
      '[RouteOptimizer:comparePreviews] python returned sync result jobId=%s',
      job.jobId
    );
    const claimed = await claimComparePreviewsJob(job.jobId);
    if (claimed) {
      await completeComparePreviewsSuccess(claimed, data);
    }
    return { mode: 'sync' };
  }

  const message =
    data?.detail ||
    data?.message ||
    data?.error ||
    `Python compare-routes failed (HTTP ${status})`;
  throw new Error(
    typeof message === 'string' ? message : JSON.stringify(message)
  );
}

async function createAndKickComparePreviewsJob({
  dateStr,
  truckIds,
  requestPayload,
  jobContext,
  createdBy,
  callbackUrl,
}) {
  const jobId = newJobId();
  const job = await RouteOptimizerJob.create({
    jobId,
    kind: 'compare_previews',
    status: 'processing',
    date: dateStr,
    truckIds,
    requestPayload,
    jobContext: jobContext || {},
    createdBy: createdBy || null,
  });

  setImmediate(() => {
    startComparePreviewsOnPython(job, callbackUrl).catch(async (err) => {
      console.error(
        '[RouteOptimizer:comparePreviews] start failed jobId=%s:',
        jobId,
        err.message
      );
      try {
        const fresh = await RouteOptimizerJob.findOne({ jobId });
        if (fresh && fresh.status === 'processing') {
          await completeComparePreviewsFailure(fresh, err.message);
        }
      } catch (e) {
        console.error(
          '[RouteOptimizer:comparePreviews] mark failed error:',
          e.message
        );
      }
    });
  });

  return job;
}

module.exports = {
  newJobId,
  buildComparePreviewsCallbackUrl,
  assertCallbackSecret,
  claimComparePreviewsJob,
  createAndKickComparePreviewsJob,
  completeComparePreviewsSuccess,
  completeComparePreviewsFailure,
  notifyComparePreviewsJob,
};
