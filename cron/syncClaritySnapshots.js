const cron = require('node-cron');
const { syncDailySnapshots } = require('../services/clarity/claritySnapshotService');
const { isClarityEnabled } = require('../config/clarityConfig');

const CLARITY_CRON_TIMEZONE = process.env.CLARITY_CRON_TIMEZONE || 'Europe/London';

async function runClaritySnapshotSync(reason = 'scheduled') {
  if (!isClarityEnabled()) {
    console.log('[Clarity Snapshot] Skipped — Clarity is not configured');
    return null;
  }

  try {
    const result = await syncDailySnapshots();
    console.log(
      `[Clarity Snapshot] ${reason}: saved ${result.synced} snapshot(s) for ${result.snapshotDate.toISOString().slice(0, 10)}`,
    );
    return result;
  } catch (error) {
    console.error(`[Clarity Snapshot] ${reason} failed:`, error.message);
    throw error;
  }
}

// Daily at 6:00 AM (Europe/London by default)
cron.schedule('0 6 * * *', () => runClaritySnapshotSync('scheduled'), {
  timezone: CLARITY_CRON_TIMEZONE,
});

console.log(
  `[Clarity Snapshot] Scheduler running — daily sync at 6:00 AM (${CLARITY_CRON_TIMEZONE})`,
);

module.exports = { runClaritySnapshotSync };
