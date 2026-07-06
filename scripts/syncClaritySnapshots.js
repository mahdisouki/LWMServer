/**
 * Fetch Clarity metrics and store daily snapshots in MongoDB.
 *
 * Usage:
 *   node scripts/syncClaritySnapshots.js
 *   node scripts/syncClaritySnapshots.js --date=2026-07-01
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { syncDailySnapshots } = require('../services/clarity/claritySnapshotService');

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI missing in .env');
  }
  await mongoose.connect(uri);
}

function parseDateArg() {
  const dateArg = process.argv.find((arg) => arg.startsWith('--date='));
  if (!dateArg) {
    return new Date();
  }
  const value = dateArg.slice('--date='.length);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --date value: ${value}`);
  }
  return parsed;
}

async function main() {
  const snapshotDate = parseDateArg();
  await connectDB();

  console.log(`Syncing Clarity snapshots for ${snapshotDate.toISOString().slice(0, 10)}...`);
  const result = await syncDailySnapshots({ snapshotDate });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => mongoose.disconnect())
  .catch((error) => {
    console.error(error.message);
    mongoose.disconnect();
    process.exit(1);
  });
