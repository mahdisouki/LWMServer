/**
 * Backfill trafficSource on all tasks from gclid/gbraid/wbraid.
 *
 * Usage:
 *   node scripts/backfillTaskTrafficSource.js --dry-run
 *   node scripts/backfillTaskTrafficSource.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const { resolveTrafficSource, TRAFFIC_SOURCES } = require('../utils/trafficSource');

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI missing in .env');
  }
  await mongoose.connect(uri);
}

function parseArgs() {
  return { dryRun: process.argv.includes('--dry-run') };
}

async function main() {
  const { dryRun } = parseArgs();
  await connectDB();

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}\n`);

  const summary = {
    total: 0,
    alreadyCorrect: 0,
    setGoogleAds: 0,
    setOrganic: 0,
    errors: 0,
  };

  const cursor = Task.find({})
    .select('_id orderNumber gclid gbraid wbraid trafficSource')
    .cursor();

  for await (const task of cursor) {
    summary.total += 1;

    const next = resolveTrafficSource({
      gclid: task.gclid,
      gbraid: task.gbraid,
      wbraid: task.wbraid,
    });

    if (task.trafficSource === next) {
      summary.alreadyCorrect += 1;
      continue;
    }

    const label = task.orderNumber || task._id.toString();
    console.log(`[update] ${label}: ${task.trafficSource ?? '(missing)'} -> ${next}`);

    if (dryRun) {
      if (next === TRAFFIC_SOURCES.GOOGLE_ADS) {
        summary.setGoogleAds += 1;
      } else {
        summary.setOrganic += 1;
      }
      continue;
    }

    try {
      await Task.updateOne({ _id: task._id }, { $set: { trafficSource: next } });
      if (next === TRAFFIC_SOURCES.GOOGLE_ADS) {
        summary.setGoogleAds += 1;
      } else {
        summary.setOrganic += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`[error] ${label}:`, error.message);
    }
  }

  console.log('\n--- Summary ---');
  console.log(JSON.stringify({ ...summary, dryRun }, null, 2));

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
