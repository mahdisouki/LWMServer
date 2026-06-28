/**
 * Backfill gclid/gbraid/wbraid on paid tasks from their linked quotation.
 *
 * Usage:
 *   node scripts/backfillTaskClickIdsFromQuotations.js --dry-run
 *   node scripts/backfillTaskClickIdsFromQuotations.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const QuotationRequest = require('../models/QuotationRequest');
const { copyClickIdsFromQuotationToTask } = require('../services/quotationTaskMatchingService');

const PAID_STATUSES = ['Paid', 'partial_Paid'];

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

function taskMissingClickIds(task) {
  return !task.gclid && !task.gbraid && !task.wbraid;
}

function quotationHasClickIds(quotation) {
  return Boolean(quotation.gclid || quotation.gbraid || quotation.wbraid);
}

async function main() {
  const { dryRun } = parseArgs();
  await connectDB();

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Paid statuses: ${PAID_STATUSES.join(', ')}\n`);

  const tasks = await Task.find({
    quotationId: { $ne: null },
    paymentStatus: { $in: PAID_STATUSES },
  }).select('orderNumber quotationId paymentStatus gclid gbraid wbraid email');

  const summary = {
    totalPaidLinked: tasks.length,
    alreadyHasClickIds: 0,
    quotationNotFound: 0,
    quotationNoClickIds: 0,
    updated: 0,
    skippedNoChange: 0,
    errors: 0,
  };

  const updates = [];

  for (const task of tasks) {
    if (!taskMissingClickIds(task)) {
      summary.alreadyHasClickIds += 1;
      continue;
    }

    const quotation = await QuotationRequest.findById(task.quotationId)
      .select('gclid gbraid wbraid email createdAt');

    if (!quotation) {
      summary.quotationNotFound += 1;
      console.warn(`[skip] ${task.orderNumber || task._id}: quotation not found`);
      continue;
    }

    if (!quotationHasClickIds(quotation)) {
      summary.quotationNoClickIds += 1;
      continue;
    }

    const { changed, before, after } = copyClickIdsFromQuotationToTask(task, quotation);
    if (!changed) {
      summary.skippedNoChange += 1;
      continue;
    }

    updates.push({
      task,
      quotation,
      before,
      after,
    });
  }

  console.log('--- Scan summary ---');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nEligible for update: ${updates.length}\n`);

  for (const row of updates) {
    const label = row.task.orderNumber || row.task._id.toString();
    console.log(`[update] ${label} (${row.task.paymentStatus})`, {
      quotationId: row.task.quotationId.toString(),
      before: row.before,
      after: row.after,
    });

    if (!dryRun) {
      try {
        await Task.updateOne(
          { _id: row.task._id },
          {
            $set: {
              ...(row.after.gclid ? { gclid: row.after.gclid } : {}),
              ...(row.after.gbraid ? { gbraid: row.after.gbraid } : {}),
              ...(row.after.wbraid ? { wbraid: row.after.wbraid } : {}),
            },
          },
        );
        summary.updated += 1;
      } catch (error) {
        summary.errors += 1;
        console.error(`[error] ${label}:`, error.message);
      }
    } else {
      summary.updated += 1;
    }
  }

  console.log('\n--- Final ---');
  console.log(JSON.stringify({
    ...summary,
    dryRun,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
