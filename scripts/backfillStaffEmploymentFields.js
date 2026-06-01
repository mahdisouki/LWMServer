/**
 * Backfill `isStillWorking` and `terminationReason` on User documents (all staff types).
 *
 * - Missing or null `isStillWorking` → true (still employed)
 * - Missing or null `terminationReason` → ''
 *
 * Documents that already have both fields set are left unchanged.
 *
 * Usage (from repo root):
 *   node scripts/backfillStaffEmploymentFields.js
 *   node scripts/backfillStaffEmploymentFields.js --dry-run
 *
 * Requires MONGODB_URI or MONGO_URI in .env (same as the rest of the app).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('../models/User');

async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI or MONGO_URI must be set in .env');
  }
  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

function missingFieldFilter(fieldName) {
  return {
    $or: [{ [fieldName]: { $exists: false } }, { [fieldName]: null }],
  };
}

async function backfillStaffEmploymentFields({ dryRun = false } = {}) {
  const total = await User.countDocuments({});
  const missingIsStillWorking = await User.countDocuments(
    missingFieldFilter('isStillWorking'),
  );
  const missingTerminationReason = await User.countDocuments(
    missingFieldFilter('terminationReason'),
  );

  console.log(`Total users: ${total}`);
  console.log(`Missing isStillWorking: ${missingIsStillWorking}`);
  console.log(`Missing terminationReason: ${missingTerminationReason}`);

  if (missingIsStillWorking === 0 && missingTerminationReason === 0) {
    console.log('Nothing to update.');
    return {
      isStillWorking: { matchedCount: 0, modifiedCount: 0 },
      terminationReason: { matchedCount: 0, modifiedCount: 0 },
    };
  }

  if (dryRun) {
    console.log('[DRY RUN] No writes performed.');
    return {
      isStillWorking: { matchedCount: missingIsStillWorking, modifiedCount: 0 },
      terminationReason: {
        matchedCount: missingTerminationReason,
        modifiedCount: 0,
      },
    };
  }

  const isStillWorkingResult = await User.updateMany(
    missingFieldFilter('isStillWorking'),
    { $set: { isStillWorking: true } },
  );

  const terminationReasonResult = await User.updateMany(
    missingFieldFilter('terminationReason'),
    { $set: { terminationReason: '' } },
  );

  const isStillWorking = {
    matchedCount:
      isStillWorkingResult.matchedCount ?? isStillWorkingResult.n ?? 0,
    modifiedCount:
      isStillWorkingResult.modifiedCount ?? isStillWorkingResult.nModified ?? 0,
  };

  const terminationReason = {
    matchedCount:
      terminationReasonResult.matchedCount ?? terminationReasonResult.n ?? 0,
    modifiedCount:
      terminationReasonResult.modifiedCount ??
      terminationReasonResult.nModified ??
      0,
  };

  console.log(
    `isStillWorking — matched: ${isStillWorking.matchedCount}, modified: ${isStillWorking.modifiedCount}`,
  );
  console.log(
    `terminationReason — matched: ${terminationReason.matchedCount}, modified: ${terminationReason.modifiedCount}`,
  );

  return { isStillWorking, terminationReason };
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');

  try {
    await connectDB();
    console.log('Connected to MongoDB');
    if (dryRun) {
      console.log('Running in dry-run mode\n');
    }
    await backfillStaffEmploymentFields({ dryRun });
    await mongoose.connection.close();
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Script failed:', err.message);
    try {
      await mongoose.connection.close();
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { backfillStaffEmploymentFields, connectDB };
