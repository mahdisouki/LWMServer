/**
 * Backfill Waste Transfer Notes for completed partial_Paid tasks where
 * deposit + remaining are both Paid, but wasteTransferNoteSent is still false.
 *
 * Usage (from repo root):
 *   node scripts/backfillWasteTransferNotesPartialPaid.js --dry-run
 *   node scripts/backfillWasteTransferNotesPartialPaid.js
 *
 * Requires MONGODB_URI or MONGO_URI in .env.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const { sendWasteTransferNoteEmail } = require('../services/emailsService');

const dryRun = process.argv.includes('--dry-run');

const QUERY = {
  taskStatus: 'Completed',
  paymentStatus: 'partial_Paid',
  'paidAmount.status': 'Paid',
  'remainingAmount.status': 'Paid',
  wasteTransferNoteSent: { $ne: true },
  email: { $exists: true, $ne: null, $ne: '' },
  createdBy: { $ne: 'MigrationScript' },
};

async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI or MONGO_URI must be set in .env');
  }
  await mongoose.connect(uri);
}

async function backfill() {
  const tasks = await Task.find(QUERY)
    .select('_id orderNumber email')
    .sort({ finishDate: 1, createdAt: 1 });

  console.log(`Found ${tasks.length} task(s) matching criteria`);
  if (dryRun) {
    console.log('Dry run — no emails will be sent.');
    for (const task of tasks) {
      console.log(`  would send: order ${task.orderNumber} (${task.email})`);
    }
    return { sentCount: 0, failedCount: 0, dryRun: true };
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const task of tasks) {
    try {
      await sendWasteTransferNoteEmail(task._id);
      sentCount++;
      console.log(`Sent WTN for order ${task.orderNumber}`);
    } catch (error) {
      failedCount++;
      console.error(`Failed for order ${task.orderNumber}:`, error.message);
    }
  }

  console.log(`Done: ${sentCount} sent, ${failedCount} failed`);
  return { sentCount, failedCount, dryRun: false };
}

async function run() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');
    await backfill();
    await mongoose.connection.close();
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

module.exports = { backfill, QUERY };
