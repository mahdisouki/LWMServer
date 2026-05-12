/**
 * Backfill `redflag` on all Task documents that do not have the field yet.
 * Sets `redflag: false` so every task has an explicit value (MongoDB + app consistency).
 *
 * Tasks that already have `redflag` set (true or false) are left unchanged.
 *
 * Usage (from repo root):
 *   node scripts/backfillTaskRedflag.js
 *
 * Requires MONGODB_URI or MONGO_URI in .env (same as the rest of the app).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');

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

async function backfillRedflag() {
  const total = await Task.countDocuments({});
  const missing = await Task.countDocuments({ redflag: { $exists: false } });

  console.log(`Total tasks: ${total}`);
  console.log(`Tasks without redflag field: ${missing}`);

  if (missing === 0) {
    console.log('Nothing to update.');
    return { matchedCount: 0, modifiedCount: 0 };
  }

  const result = await Task.updateMany(
    { redflag: { $exists: false } },
    { $set: { redflag: false } },
  );

  const matchedCount = result.matchedCount ?? result.n ?? 0;
  const modifiedCount = result.modifiedCount ?? result.nModified ?? 0;

  console.log(`Matched: ${matchedCount}, Modified: ${modifiedCount}`);
  return { matchedCount, modifiedCount };
}

async function run() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');
    await backfillRedflag();
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

module.exports = { backfillRedflag, connectDB };
