const cron = require('node-cron');
const {
  syncLsaOrderTrafficSources,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_WINDOW_DAYS,
} = require('../services/analytics/lsaOrderTrafficSyncService');

const LSA_ORDER_TRAFFIC_CRON_TIMEZONE =
  process.env.LSA_ORDER_TRAFFIC_CRON_TIMEZONE || 'Europe/London';

/** Sunday 04:00 — weekly, off-peak. */
const LSA_ORDER_TRAFFIC_CRON_EXPRESSION =
  process.env.LSA_ORDER_TRAFFIC_CRON_EXPRESSION || '0 4 * * 0';

async function runLsaOrderTrafficSync(reason = 'scheduled') {
  try {
    const summary = await syncLsaOrderTrafficSources({
      lookbackDays: DEFAULT_LOOKBACK_DAYS,
      windowDays: DEFAULT_WINDOW_DAYS,
      dryRun: false,
    });

    if (summary.skipped) {
      console.log(
        `[LSA Order Traffic Cron] ${reason}: skipped (${summary.reason || 'unknown'})` +
          (summary.error ? ` — ${summary.error}` : ''),
      );
      return summary;
    }

    console.log(
      `[LSA Order Traffic Cron] ${reason}: ` +
        `leads=${summary.leadsFetched} candidates=${summary.candidates} ` +
        `matched=${summary.matched} updated=${summary.updated} ` +
        `noMatch=${summary.noMatch} ambiguous=${summary.ambiguous} ` +
        `errors=${summary.errors} ` +
        `(lookback=${summary.lookbackDays}d window=${summary.windowDays}d ` +
        `${summary.startKey}→${summary.endKey})`,
    );
    return summary;
  } catch (error) {
    console.error(`[LSA Order Traffic Cron] ${reason} failed:`, error);
    throw error;
  }
}

cron.schedule(
  LSA_ORDER_TRAFFIC_CRON_EXPRESSION,
  () => {
    runLsaOrderTrafficSync('scheduled').catch((error) => {
      console.error('[LSA Order Traffic Cron] Unhandled schedule error:', error);
    });
  },
  { timezone: LSA_ORDER_TRAFFIC_CRON_TIMEZONE },
);

console.log(
  `[LSA Order Traffic Cron] Scheduler running — ${LSA_ORDER_TRAFFIC_CRON_EXPRESSION} ` +
    `(${LSA_ORDER_TRAFFIC_CRON_TIMEZONE})`,
);

module.exports = { runLsaOrderTrafficSync };
