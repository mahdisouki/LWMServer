const { pollNewMessages } = require('./gmailService');
const { enrichNewMessagesWithAiCategory } = require('./emailClassifierService');

const adminSyncState = new Map();

function resolveDebounceMs() {
  const fromEnv = Number(process.env.GMAIL_WEBHOOK_DEBOUNCE_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) {
    return Math.floor(fromEnv);
  }
  return 1000;
}

function resolveBatchSize() {
  const fromEnv = Number(process.env.GMAIL_WEBHOOK_BATCH_SIZE);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return 10;
}

function resolveQuotaBackoffMs() {
  const fromEnv = Number(process.env.GMAIL_WEBHOOK_QUOTA_BACKOFF_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return 60000;
}

function isRateLimitError(error) {
  if (!error) return false;
  if (error.code === 403 || error.status === 403) {
    const reasons = (error.errors || []).map((e) => e.reason);
    if (
      reasons.includes('rateLimitExceeded') ||
      reasons.includes('userRateLimitExceeded')
    ) {
      return true;
    }
    const message = String(error.message || '');
    if (/quota exceeded|rate limit/i.test(message)) return true;
  }
  return false;
}

function getAdminState(adminId) {
  const key = String(adminId);
  let state = adminSyncState.get(key);
  if (!state) {
    state = {
      running: false,
      pending: false,
      debounceTimer: null,
      handlers: null,
    };
    adminSyncState.set(key, state);
  }
  return state;
}

/** Poll Gmail history and classify new INBOX threads via Python. */
async function pollNewMessagesWithClassification(adminId, options = {}) {
  const batchSize = resolveBatchSize();
  const externalOnBatch =
    typeof options.onBatch === 'function' ? options.onBatch : null;

  const result = await pollNewMessages(adminId, {
    batchSize,
    batchDelayMs: options.batchDelayMs,
    onBatch: async (messages, meta) => {
      if (!messages?.length) return;

      const enriched = await enrichNewMessagesWithAiCategory(
        adminId,
        messages
      );

      if (externalOnBatch) {
        await externalOnBatch(enriched, meta);
      }
    },
  });

  // Messages were already classified in onBatch; re-enrich only if no onBatch
  // was provided (direct callers still get classified results).
  if (!externalOnBatch && result.newMessages?.length) {
    result.newMessages = await enrichNewMessagesWithAiCategory(
      adminId,
      result.newMessages
    );
  }

  return result;
}

async function runQueuedSync(adminId) {
  const state = getAdminState(adminId);
  if (state.running) return;

  state.running = true;
  state.pending = false;

  const handlers = state.handlers || {};
  let retryAlreadyScheduled = false;

  try {
    console.log(
      `[Gmail Sync Queue] Start admin=${adminId} batchSize=${resolveBatchSize()}`
    );

    const result = await pollNewMessagesWithClassification(adminId, {
      onBatch: handlers.onBatch,
    });

    if (typeof handlers.onComplete === 'function') {
      await handlers.onComplete(result);
    }

    console.log(
      `[Gmail Sync Queue] Done admin=${adminId} newMessages=${result.newMessages?.length || 0}`
    );
  } catch (error) {
    console.error(`[Gmail Sync Queue] Error admin=${adminId}:`, error.message);

    if (isRateLimitError(error)) {
      const backoffMs = resolveQuotaBackoffMs();
      console.warn(
        `[Gmail Sync Queue] Quota hit for admin=${adminId}; retry in ${backoffMs}ms`
      );
      state.pending = true;
      retryAlreadyScheduled = true;
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null;
        runQueuedSync(adminId);
      }, backoffMs);
    } else if (typeof handlers.onError === 'function') {
      await handlers.onError(error);
    }
  } finally {
    state.running = false;

    if (state.pending && !retryAlreadyScheduled) {
      const debounceMs = resolveDebounceMs();
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null;
        runQueuedSync(adminId);
      }, debounceMs);
    }
  }
}

/**
 * Coalesce webhook notifications per admin into a single serial sync.
 * Multiple rapid pings collapse into one run; a ping during a run schedules
 * exactly one follow-up.
 */
function enqueueGmailInboxSync(adminId, handlers = {}) {
  const state = getAdminState(adminId);
  state.handlers = handlers;
  state.pending = true;

  if (state.running) {
    console.log(
      `[Gmail Sync Queue] Coalesced notification for admin=${adminId} (sync already running)`
    );
    return;
  }

  const debounceMs = resolveDebounceMs();
  if (state.debounceTimer) clearTimeout(state.debounceTimer);

  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    runQueuedSync(adminId);
  }, debounceMs);

  console.log(
    `[Gmail Sync Queue] Scheduled admin=${adminId} in ${debounceMs}ms`
  );
}

module.exports = {
  pollNewMessagesWithClassification,
  enqueueGmailInboxSync,
};
