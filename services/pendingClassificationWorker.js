const PendingClassification = require('../models/PendingClassification');

const MAX_ATTEMPTS = (() => {
  const n = Number(process.env.PENDING_CLASSIFY_MAX_ATTEMPTS);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return 5;
})();

const DRAIN_GAP_MS = (() => {
  const n = Number(process.env.PENDING_CLASSIFY_DRAIN_GAP_MS);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 250;
})();

let draining = false;
let drainTimer = null;
let started = false;

async function enqueuePendingClassification(adminId, threadId) {
  const tid = String(threadId || '').trim();
  if (!tid || !adminId) return null;

  const doc = await PendingClassification.findOneAndUpdate(
    { threadId: tid },
    {
      $set: {
        adminId,
        status: 'pending',
        updatedAt: new Date(),
      },
      $setOnInsert: {
        threadId: tid,
        attempts: 0,
      },
      $unset: { lastError: '' },
    },
    { upsert: true, new: true }
  );

  scheduleDrain();
  return doc;
}

function scheduleDrain(delayMs = 50) {
  if (drainTimer) return;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    drainPendingClassifications().catch((err) => {
      console.error('[PendingClassify] drain error:', err.message);
    });
  }, delayMs);
}

async function claimNextPending() {
  return PendingClassification.findOneAndUpdate(
    { status: 'pending' },
    { $set: { status: 'processing', updatedAt: new Date() } },
    { sort: { createdAt: 1 }, new: true }
  );
}

async function processOne(job) {
  const threadId = job.threadId;
  const adminId = job.adminId;

  try {
    // Lazy require avoids cycle with emailClassifierService.
    const { classifyAndStoreThread } = require('./emailClassifierService');
    const stored = await classifyAndStoreThread(adminId, threadId);
    if (!stored?.aiCategory || stored.status !== 'done') {
      throw new Error(
        stored?.reason ||
          `classification status=${stored?.status || 'unknown'}`
      );
    }
    await PendingClassification.deleteOne({ _id: job._id });
    console.log(`[PendingClassify] done thread=${threadId}`);
  } catch (err) {
    const attempts = (Number(job.attempts) || 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await PendingClassification.updateOne(
      { _id: job._id },
      {
        $set: {
          status: failed ? 'failed' : 'pending',
          attempts,
          lastError: err.message || String(err),
          updatedAt: new Date(),
        },
      }
    );
    console.warn(
      `[PendingClassify] ${failed ? 'failed' : 'retry'} thread=${threadId} attempts=${attempts}:`,
      err.message
    );
  }
}

async function drainPendingClassifications() {
  if (draining) return;
  draining = true;

  try {
    while (true) {
      const job = await claimNextPending();
      if (!job) break;

      await processOne(job);

      if (DRAIN_GAP_MS > 0) {
        await new Promise((r) => setTimeout(r, DRAIN_GAP_MS));
      }
    }
  } finally {
    draining = false;

    const stillPending = await PendingClassification.exists({
      status: 'pending',
    });
    if (stillPending) scheduleDrain(DRAIN_GAP_MS || 50);
  }
}

/** On boot: re-queue interrupted jobs, then drain. */
async function startPendingClassificationWorker() {
  if (started) {
    scheduleDrain();
    return;
  }
  started = true;

  const reset = await PendingClassification.updateMany(
    { status: 'processing' },
    { $set: { status: 'pending', updatedAt: new Date() } }
  );

  const pendingCount = await PendingClassification.countDocuments({
    status: 'pending',
  });

  console.log(
    `[PendingClassify] worker started; requeued=${reset.modifiedCount || 0} pending=${pendingCount}`
  );

  scheduleDrain(100);
}

module.exports = {
  enqueuePendingClassification,
  drainPendingClassifications,
  scheduleDrain,
  startPendingClassificationWorker,
};
