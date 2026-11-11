/**
 * Migrate task priority values:
 *   high   → critical
 *   medium → high
 * low stays low.
 *
 * Run: node scripts/migrateTaskPriorityTiers.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function run() {
  if (!MONGO_URI) throw new Error('MONGO_URI is not set');
  await mongoose.connect(MONGO_URI);

  // Order matters: rename high → critical before medium → high
  const highToCritical = await Task.updateMany(
    { priority: 'high' },
    { $set: { priority: 'critical' } },
  );
  const mediumToHigh = await Task.updateMany(
    { priority: 'medium' },
    { $set: { priority: 'high' } },
  );

  console.log(`high → critical: ${highToCritical.modifiedCount}`);
  console.log(`medium → high: ${mediumToHigh.modifiedCount}`);

  const leftover = await Task.countDocuments({
    priority: { $nin: ['low', 'high', 'critical', null] },
  });
  if (leftover > 0) {
    throw new Error(`Found ${leftover} tasks with unexpected priority values`);
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
