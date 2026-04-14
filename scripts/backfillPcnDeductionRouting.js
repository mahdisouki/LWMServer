require('dotenv').config();
const mongoose = require('mongoose');
const connectToDatabase = require('../config/db');
const PcnDamage = require('../models/PcnDamage');
const pcnDamageController = require('../controllers/pcnDamageController');

function firstDayOfMonth(year, month) {
  return new Date(year, month - 1, 1, 12, 0, 0, 0);
}

async function getUserMonthPairs() {
  const pairs = await PcnDamage.aggregate([
    {
      $match: {
        deductedFromUserId: { $exists: true, $ne: null },
        createdAt: { $exists: true, $ne: null },
      },
    },
    {
      $project: {
        userId: '$deductedFromUserId',
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' },
      },
    },
    {
      $group: {
        _id: {
          userId: '$userId',
          year: '$year',
          month: '$month',
        },
      },
    },
    {
      $project: {
        _id: 0,
        userId: '$_id.userId',
        year: '$_id.year',
        month: '$_id.month',
      },
    },
    { $sort: { userId: 1, year: 1, month: 1 } },
  ]);

  return pairs;
}

async function backfillPcnDeductionRouting({ dryRun = false } = {}) {
  const pairs = await getUserMonthPairs();
  console.log(
    `Found ${pairs.length} user/month pair(s) with PCNs${dryRun ? ' [DRY RUN]' : ''}.`,
  );

  let processed = 0;
  let failed = 0;

  for (const pair of pairs) {
    const runDate = firstDayOfMonth(pair.year, pair.month);
    const label = `${String(pair.userId)} ${pair.year}-${String(pair.month).padStart(2, '0')}`;

    if (dryRun) {
      console.log(`[DRY RUN] would recalculate: ${label}`);
      processed += 1;
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await pcnDamageController.recalculatePayrollPcnDamages(runDate, pair.userId);
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed recalculation for ${label}:`, error.message);
    }

    if (processed % 100 === 0) {
      console.log(`Progress: ${processed}/${pairs.length} processed, failures=${failed}`);
    }
  }

  console.log('Backfill completed.');
  console.log(`Processed: ${processed}`);
  console.log(`Failures: ${failed}`);
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  try {
    await connectToDatabase();
    console.log('MongoDB connected');
    await backfillPcnDeductionRouting({ dryRun });
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Backfill failed:', error);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  }
}

if (require.main === module) run();

module.exports = { backfillPcnDeductionRouting };
