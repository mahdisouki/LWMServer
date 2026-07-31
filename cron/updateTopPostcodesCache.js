const cron = require('node-cron');
const {
  updateTopPostcodesCache,
  isTopPostcodesCacheStale,
} = require('../services/analytics/topPostcodesService');

const TOP_POSTCODES_CRON_TIMEZONE =
  process.env.TOP_POSTCODES_CRON_TIMEZONE || 'Europe/London';

/** 1st and 15th of each month at 02:00 — practical biweekly refresh. */
const TOP_POSTCODES_CRON_EXPRESSION =
  process.env.TOP_POSTCODES_CRON_EXPRESSION || '0 2 1,15 * *';

async function runTopPostcodesCacheUpdate(reason = 'scheduled') {
  try {
    const result = await updateTopPostcodesCache();
    const scan = result.scanStats || {};
    console.log(
      `[Top Postcodes Cron] ${reason}: cached ${result.rowsCached} row(s) ` +
        `(orders=${result.totals.orders}, quotes=${result.totals.quotes}) ` +
        `via ${scan.orderChunks || 0} order chunk(s) + ${scan.quoteChunks || 0} quote chunk(s) ` +
        `(size=${scan.chunkSize}, delay=${scan.chunkDelayMs}ms) ` +
        `at ${result.computedAt.toISOString()}`,
    );
    return result;
  } catch (error) {
    console.error(`[Top Postcodes Cron] ${reason} failed:`, error);
    throw error;
  }
}

cron.schedule(
  TOP_POSTCODES_CRON_EXPRESSION,
  () => runTopPostcodesCacheUpdate('scheduled'),
  { timezone: TOP_POSTCODES_CRON_TIMEZONE },
);

setImmediate(async () => {
  try {
    const stale = await isTopPostcodesCacheStale();
    if (stale) {
      await runTopPostcodesCacheUpdate('startup');
    } else {
      console.log('[Top Postcodes Cron] Cache is fresh — skipping startup run');
    }
  } catch (error) {
    console.error('[Top Postcodes Cron] Startup check failed:', error);
  }
});

console.log(
  `[Top Postcodes Cron] Scheduler running — ${TOP_POSTCODES_CRON_EXPRESSION} (${TOP_POSTCODES_CRON_TIMEZONE})`,
);

module.exports = { runTopPostcodesCacheUpdate };
