const cron = require('node-cron');
const { refreshInstagramToken } = require('../services/instagramService');

/**
 * Auto-refresh Instagram token every 30 days
 * This ensures the token is refreshed before the 60-day expiration
 * Runs on the 1st of every month at 2:00 AM
 */
async function refreshInstagramTokenJob() {
  try {
    console.log('[Instagram Token Refresh] Starting scheduled token refresh...');
    await refreshInstagramToken();
    console.log('[Instagram Token Refresh] ✅ Token refresh completed successfully');
  } catch (error) {
    console.error('[Instagram Token Refresh] ❌ Error refreshing token:', error.message);
  }
}

// Schedule to run on the 1st of every month at 2:00 AM
// Cron format: minute hour day month dayOfWeek
// '0 2 1 * *' means: at minute 0 of hour 2 (2 AM) on day 1 of every month
cron.schedule('0 2 1 * *', refreshInstagramTokenJob);

// Also run immediately on server start (optional - comment out if you don't want this)
// refreshInstagramTokenJob();

console.log('[Instagram Token Refresh] Scheduler running - will refresh token on the 1st of every month at 2:00 AM');

module.exports = { refreshInstagramTokenJob };
