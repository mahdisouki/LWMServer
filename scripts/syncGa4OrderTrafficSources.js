/**
 * Manual only (no cron): match GA4 purchase transaction_id → Task.orderNumber
 * and stamp Direct onto Organic public orders when GA4 session channel is Direct.
 * Admin / broker orders are never updated.
 *
 * Usage:
 *   node scripts/syncGa4OrderTrafficSources.js --dry-run
 *   node scripts/syncGa4OrderTrafficSources.js
 *   node scripts/syncGa4OrderTrafficSources.js --days=30
 *   node scripts/syncGa4OrderTrafficSources.js --dry-run --days=7
 */
require('dotenv').config();
const mongoose = require('mongoose');
const {
  syncGa4OrderTrafficSources,
  DEFAULT_LOOKBACK_DAYS,
} = require('../services/analytics/ga4OrderTrafficSyncService');

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

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const daysMatch = arg.match(/^--days=(\d+)$/);
    if (daysMatch) {
      lookbackDays = Math.min(Math.max(parseInt(daysMatch[1], 10), 1), 90);
    }
  }

  return { dryRun, lookbackDays };
}

async function main() {
  const { dryRun, lookbackDays } = parseArgs();
  await connectDB();

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'} | lookbackDays=${lookbackDays}\n`);

  const summary = await syncGa4OrderTrafficSources({ lookbackDays, dryRun });
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
