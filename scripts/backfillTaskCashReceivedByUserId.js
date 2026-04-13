require('dotenv').config();
const mongoose = require('mongoose');
const connectToDatabase = require('../config/db');
const Task = require('../models/Task');
const { User } = require('../models/User');
const payrollCtrl = require('../controllers/payrollCtrl');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveUserIdFromString(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return { skip: 'empty' };

  const exact = await User.findOne({ username: value }).select('_id').lean();
  if (exact) return { userId: exact._id, by: 'username-exact' };

  const caseInsensitive = await User.find({
    username: new RegExp(`^${escapeRegex(value)}$`, 'i'),
  })
    .select('_id username')
    .lean();

  if (caseInsensitive.length === 1) {
    return { userId: caseInsensitive[0]._id, by: 'username-case-insensitive' };
  }

  if (caseInsensitive.length > 1) {
    return { error: `ambiguous username (${caseInsensitive.length} matches)` };
  }

  return { error: 'user not found by username' };
}

async function backfillTaskCashReceivedByUserId({ dryRun = false } = {}) {
  const collection = mongoose.connection.db.collection(Task.collection.name);

  const query = {
    $or: [
      { cashReceivedBy: { $type: 'string' } },
      { cashRecivedBy: { $type: 'string' } }, // legacy typo support
    ],
  };

  const total = await collection.countDocuments(query);
  console.log(`Tasks to scan: ${total}${dryRun ? ' [DRY RUN]' : ''}`);

  let scanned = 0;
  let updated = 0;
  let skippedEmpty = 0;
  const unresolved = [];
  const ops = [];
  const recalcTargets = new Map(); // key: userId|YYYY-MM-DD => { userId, date }

  const cursor = collection.find(query);
  for await (const task of cursor) {
    scanned += 1;

    const hasCorrect = typeof task.cashReceivedBy === 'string';
    const hasLegacy = typeof task.cashRecivedBy === 'string';
    const sourceField = hasCorrect ? 'cashReceivedBy' : hasLegacy ? 'cashRecivedBy' : null;

    if (!sourceField) continue;

    const rawValue = task[sourceField];
    const resolved = await resolveUserIdFromString(rawValue);

    if (resolved.skip === 'empty') {
      skippedEmpty += 1;
      if (!dryRun) {
        ops.push({
          updateOne: {
            filter: { _id: task._id },
            update: {
              $unset: {
                cashReceivedBy: '',
                cashRecivedBy: '',
              },
            },
          },
        });
      }
      continue;
    }

    if (resolved.error) {
      unresolved.push({
        taskId: String(task._id),
        orderNumber: task.orderNumber || null,
        value: String(rawValue).trim(),
        sourceField,
        reason: resolved.error,
      });
      continue;
    }

    updated += 1;
    const taskDate = task.date ? new Date(task.date) : null;
    if (taskDate && !Number.isNaN(taskDate.getTime())) {
      const dayKey = taskDate.toISOString().slice(0, 10);
      const userIdString = String(resolved.userId);
      recalcTargets.set(`${userIdString}|${dayKey}`, {
        userId: resolved.userId,
        date: taskDate,
      });
    }

    if (!dryRun) {
      ops.push({
        updateOne: {
          filter: { _id: task._id },
          update: {
            $set: { cashReceivedBy: resolved.userId },
            $unset: { cashRecivedBy: '' },
          },
        },
      });
    }

    if (scanned % 200 === 0) {
      console.log(`Processed ${scanned}/${total} | resolved=${updated} | unresolved=${unresolved.length}`);
    }
  }

  if (!dryRun && ops.length > 0) {
    const result = await collection.bulkWrite(ops, { ordered: false });
    console.log(`Bulk updated ${result.modifiedCount} task(s).`);

    let recalculated = 0;
    for (const { date, userId } of recalcTargets.values()) {
      // eslint-disable-next-line no-await-in-loop
      await payrollCtrl.recalculatePayrollTotalCash(date, userId);
      recalculated += 1;
    }
    console.log(`Payroll totalCash recalculated for ${recalculated} user/day target(s).`);
  }

  console.log('Backfill completed.');
  console.log(`Scanned: ${scanned}`);
  console.log(`Resolved to userId: ${updated}${dryRun ? ' (would update)' : ''}`);
  console.log(`Skipped empty values: ${skippedEmpty}`);
  console.log(`Unresolved: ${unresolved.length}`);
  console.log(`Payroll recalc targets: ${recalcTargets.size}${dryRun ? ' (would recalculate)' : ''}`);

  if (unresolved.length > 0) {
    console.log('Unresolved entries:');
    console.log(JSON.stringify(unresolved, null, 2));
  }
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');

  try {
    await connectToDatabase();
    await backfillTaskCashReceivedByUserId({ dryRun });
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

module.exports = { backfillTaskCashReceivedByUserId };
