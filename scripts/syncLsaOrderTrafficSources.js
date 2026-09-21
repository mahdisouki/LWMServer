/**
 * Match Google Ads LSA leads → Task.trafficSource = LSA.
 *
 * Usage:
 *   node scripts/syncLsaOrderTrafficSources.js --dry-run
 *   node scripts/syncLsaOrderTrafficSources.js
 *   node scripts/syncLsaOrderTrafficSources.js --dry-run --days=21 --window=7
 */
require('dotenv').config();
const mongoose = require('mongoose');
const {
  syncLsaOrderTrafficSources,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_WINDOW_DAYS,
} = require('../services/analytics/lsaOrderTrafficSyncService');

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI missing in .env');
  }
  await mongoose.connect(uri);
}

function parseArgs(argv = process.argv.slice(2)) {
  let dryRun = false;
  let lookbackDays = DEFAULT_LOOKBACK_DAYS;
  let windowDays = DEFAULT_WINDOW_DAYS;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const daysMatch = arg.match(/^--days=(\d+)$/);
    if (daysMatch) {
      lookbackDays = Math.min(Math.max(parseInt(daysMatch[1], 10), 7), 90);
      continue;
    }
    const windowMatch = arg.match(/^--window=(\d+)$/);
    if (windowMatch) {
      windowDays = Math.min(Math.max(parseInt(windowMatch[1], 10), 1), 30);
    }
  }

  return { dryRun, lookbackDays, windowDays };
}

async function main() {
  const { dryRun, lookbackDays, windowDays } = parseArgs();
  await connectDB();

  console.log(
    `Mode: ${dryRun ? 'DRY RUN' : 'APPLY'} | lookbackDays=${lookbackDays} | windowDays=${windowDays}\n`,
  );

  const summary = await syncLsaOrderTrafficSources({
    lookbackDays,
    windowDays,
    dryRun,
  });
  console.log('\n--- Summary ---');
  console.log(JSON.stringify(summary, null, 2));

  await mongoose.disconnect();

  if (summary.skipped) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
