/**
 * Migration: Task.cashReceivedBy from username string → User ObjectId
 *
 * Legacy data stored the collector's username (e.g. "nardo", "Buza") while the schema
 * expects ObjectId ref User. This script updates those tasks using the users collection.
 *
 * Resolves:
 * - Non-empty string → User by exact username, then case-insensitive unique match
 * - 24-char hex string → User by _id if valid
 * - Whitespace-only → unsets cashReceivedBy
 *
 * Run: node scripts/migrateTaskCashReceivedByToUserId.js
 * Dry run (no writes): node scripts/migrateTaskCashReceivedByToUserId.js --dry-run
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('../models/User');
const Task = require('../models/Task');

const dryRun = process.argv.includes('--dry-run');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
};

async function resolveUserIdForCashReceivedBy(trimmed) {
  if (/^[a-f0-9]{24}$/i.test(trimmed)) {
    const byId = await User.findById(trimmed).select('_id').lean();
    if (byId) return { userId: byId._id, match: 'byId' };
  }

  const exact = await User.findOne({ username: trimmed }).select('_id').lean();
  if (exact) return { userId: exact._id, match: 'usernameExact' };

  const ciUsers = await User.find({
    username: new RegExp(`^${escapeRegex(trimmed)}$`, 'i'),
  })
    .select('_id username')
    .lean();

  if (ciUsers.length === 1) return { userId: ciUsers[0]._id, match: 'usernameCaseInsensitive' };
  if (ciUsers.length > 1) return { error: `ambiguous username (${ciUsers.length} users)` };

  return { error: 'no user found' };
}

const migrate = async () => {
  const col = mongoose.connection.db.collection(Task.collection.name);
  const cursor = col.find({
    cashReceivedBy: { $exists: true, $ne: null, $type: 'string' },
  });

  let updated = 0;
  let unsetEmpty = 0;
  const unresolved = [];

  for await (const doc of cursor) {
    const raw = doc.cashReceivedBy;
    const trimmed = String(raw).trim();

    if (!trimmed) {
      if (dryRun) {
        console.log(`[dry-run] would unset cashReceivedBy for task ${doc._id} (${doc.orderNumber || 'no order'})`);
        unsetEmpty += 1;
        continue;
      }
      await col.updateOne({ _id: doc._id }, { $unset: { cashReceivedBy: '' } });
      unsetEmpty += 1;
      updated += 1;
      continue;
    }

    const resolved = await resolveUserIdForCashReceivedBy(trimmed);
    if (resolved.error) {
      unresolved.push({
        taskId: String(doc._id),
        orderNumber: doc.orderNumber,
        cashReceivedBy: trimmed,
        reason: resolved.error,
      });
      continue;
    }

    if (dryRun) {
      console.log(
        `[dry-run] task ${doc._id} (${doc.orderNumber || 'no order'}): "${trimmed}" → ${resolved.userId} (${resolved.match})`,
      );
      updated += 1;
      continue;
    }

    await col.updateOne({ _id: doc._id }, { $set: { cashReceivedBy: resolved.userId } });
    updated += 1;
  }

  console.log(
    dryRun ? `Dry run: would update ${updated} task(s) (${unsetEmpty} unset empty).` : `Updated ${updated} task(s) (${unsetEmpty} unset empty).`,
  );

  if (unresolved.length > 0) {
    console.error('Unresolved cashReceivedBy values:', JSON.stringify(unresolved, null, 2));
    process.exitCode = 1;
  }
};

const run = async () => {
  try {
    await connectDB();
    await migrate();
    process.exit(process.exitCode || 0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
};

if (require.main === module) run();
