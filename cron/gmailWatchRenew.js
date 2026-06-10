const cron = require('node-cron');
const { renewAllWatches } = require('../services/gmailWatchService');

async function runRenewal() {
  if (!process.env.GMAIL_PUBSUB_TOPIC) {
    console.warn(
      '[Gmail Watch Renew] Skipped: GMAIL_PUBSUB_TOPIC is not configured'
    );
    return;
  }

  try {
    console.log('[Gmail Watch Renew] Checking watches...');
    await renewAllWatches();
    console.log('[Gmail Watch Renew] Done');
  } catch (error) {
    console.error('[Gmail Watch Renew] Error:', error.message);
  }
}

// Run daily at 3:00 AM to renew watches expiring within 24h
cron.schedule('0 3 * * *', runRenewal);

// Run once shortly after server start to catch missing/expired watches
setTimeout(runRenewal, 30 * 1000);

console.log('[Gmail Watch Renew] Scheduler running (daily 03:00 + on startup)');

module.exports = { runRenewal };
