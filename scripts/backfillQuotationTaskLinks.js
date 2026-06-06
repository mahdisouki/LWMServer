require('dotenv').config();
const mongoose = require('mongoose');
const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const {
  AUTO_RETARGET_DELAY_MS,
  AUTO_RETARGET_HOUR,
  AUTO_RETARGET_DAYS,
  isAutoRetargetEligible,
  findLinkedTaskForQuotation,
  findMatchingTaskForQuotation,
  tryLinkQuotationToMatchingTask,
  isTaskEligibleForQuotationLink,
  normalizeEmail,
} = require('../services/quotationTaskMatchingService');
const {
  processQuotationForRetargeting,
  hasRetargetingEmailSentForQuotationEmail,
} = require('../services/quotationRetargetingService');

const BATCH_SIZE = Number.parseInt(
  process.env.QUOTATION_RETARGETING_BATCH_SIZE || '10',
  10,
);
const BATCH_DELAY_MS = Number.parseInt(
  process.env.QUOTATION_RETARGETING_BATCH_DELAY_MS || '5000',
  10,
);

const connectDB = async () => {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('MONGO_URI or MONGODB_URI missing in .env');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected');
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  return {
    dryRun: process.argv.includes('--dry-run'),
    acceptedOnly: process.argv.includes('--accepted-only'),
    linksOnly: process.argv.includes('--links-only'),
    retargetingOnly: process.argv.includes('--retargeting-only'),
  };
}

function isPendingQuotation(quotation) {
  const reason = quotation.reason;
  return !reason || String(reason).trim() === '';
}

async function buildQuotationIdsWithOrders(quotationIds) {
  if (quotationIds.length === 0) {
    return new Set();
  }
  const tasksWithQuotations = await Task.find({
    quotationId: { $in: quotationIds },
    paymentStatus: { $ne: 'Failed' },
  }).select('quotationId');

  return new Set(tasksWithQuotations.map((t) => t.quotationId.toString()));
}

/**
 * Phase 1: link historical quotations to matching tasks.
 */
async function backfillQuotationTaskLinks({ dryRun = false, acceptedOnly = false } = {}) {
  const query = acceptedOnly ? { reason: 'task created' } : {};

  const quotations = await QuotationRequest.find(query)
    .sort({ createdAt: 1 })
    .select('_id Name email phoneNumber reason createdAt');

  const summary = {
    scanned: quotations.length,
    alreadyLinked: 0,
    linked: 0,
    noMatch: 0,
    skippedIneligibleTask: 0,
    errors: 0,
  };

  for (const quotation of quotations) {
    const existingLink = await findLinkedTaskForQuotation(quotation._id);
    if (existingLink) {
      summary.alreadyLinked += 1;
      continue;
    }

    try {
      if (dryRun) {
        const matchedTask = await findMatchingTaskForQuotation(quotation);
        if (!matchedTask) {
          summary.noMatch += 1;
          continue;
        }
        if (!isTaskEligibleForQuotationLink(matchedTask)) {
          summary.skippedIneligibleTask += 1;
          continue;
        }
        summary.linked += 1;
        console.log(
          `[link dry-run] quotation ${quotation._id} → task ${matchedTask.orderNumber || matchedTask._id}`,
        );
        continue;
      }

      const result = await tryLinkQuotationToMatchingTask(quotation);
      if (result.action === 'linked') {
        summary.linked += 1;
        const task = await Task.findById(result.taskId).select('orderNumber email paymentStatus');
        console.log(
          `[linked] quotation ${quotation._id} → task ${task?.orderNumber || result.taskId}`,
        );
      } else if (result.action === 'already_linked') {
        summary.alreadyLinked += 1;
      } else {
        summary.noMatch += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`[link error] quotation ${quotation._id}:`, error.message);
    }
  }

  return summary;
}

/**
 * Phase 2: retargeting emails for pending quotes (2+ days, no reminderDate, not yet sent).
 * One email per customer address; duplicates marked without sending.
 */
async function backfillPendingRetargetingEmails({ dryRun = false } = {}) {
  const now = new Date();
  const autoCutoff = new Date(now.getTime() - AUTO_RETARGET_DELAY_MS);

  const candidates = await QuotationRequest.find({
    retargetingEmailSent: { $ne: true },
    reminderDate: null,
    email: { $exists: true, $nin: [null, ''] },
    createdAt: { $lte: autoCutoff },
    $or: [{ reason: { $exists: false } }, { reason: null }, { reason: '' }],
  }).sort({ createdAt: 1 });

  const due = candidates.filter(
    (q) => isPendingQuotation(q) && isAutoRetargetEligible(q, now),
  );

  const summary = {
    scanned: candidates.length,
    eligible: due.length,
    linked: 0,
    emailsSent: 0,
    duplicateEmailsSkipped: 0,
    alreadyLinked: 0,
    skipped: 0,
    errors: 0,
  };

  if (due.length === 0) {
    console.log('[retargeting] No pending quotations eligible for auto retargeting.');
    return summary;
  }

  console.log(
    `[retargeting] ${due.length} pending quotation(s) eligible ` +
      `(>= ${AUTO_RETARGET_DAYS} days, no reminderDate, not yet emailed)`,
  );

  const quotationIdsWithOrders = await buildQuotationIdsWithOrders(
    due.map((q) => q._id),
  );
  const processedEmails = new Set();
  const totalBatches = Math.ceil(due.length / BATCH_SIZE);

  for (let i = 0; i < due.length; i += BATCH_SIZE) {
    const chunk = due.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    console.log(
      `[retargeting] Chunk ${batchNum}/${totalBatches} (${chunk.length} quotation(s))`,
    );

    for (const quotation of chunk) {
      const emailKey = normalizeEmail(quotation.email);

      try {
        if (dryRun) {
          if (emailKey && processedEmails.has(emailKey)) {
            summary.duplicateEmailsSkipped += 1;
            console.log(
              `[retargeting dry-run] duplicate skip ${quotation._id} (${quotation.email})`,
            );
            continue;
          }
          if (
            emailKey
            && (await hasRetargetingEmailSentForQuotationEmail(quotation.email, quotation._id))
          ) {
            summary.duplicateEmailsSkipped += 1;
            processedEmails.add(emailKey);
            console.log(
              `[retargeting dry-run] duplicate skip ${quotation._id} (${quotation.email}) — already sent`,
            );
            continue;
          }

          const existingLink = await findLinkedTaskForQuotation(quotation._id);
          if (existingLink || quotationIdsWithOrders.has(quotation._id.toString())) {
            summary.alreadyLinked += 1;
            continue;
          }

          const matchedTask = await findMatchingTaskForQuotation(quotation);
          if (matchedTask) {
            summary.linked += 1;
            console.log(
              `[retargeting dry-run] would link ${quotation._id} → ${matchedTask.orderNumber || matchedTask._id}`,
            );
          } else {
            summary.emailsSent += 1;
            if (emailKey) {
              processedEmails.add(emailKey);
            }
            console.log(
              `[retargeting dry-run] would send email for ${quotation._id} (${quotation.email})`,
            );
          }
          continue;
        }

        const result = await processQuotationForRetargeting(
          quotation,
          quotationIdsWithOrders,
          processedEmails,
        );

        if (result.action === 'linked') {
          summary.linked += 1;
          console.log(
            `[retargeting] linked ${quotation._id} → task ${result.taskId} (${quotation.email})`,
          );
        } else if (result.action === 'retargeting_sent') {
          summary.emailsSent += 1;
          console.log(
            `[retargeting] sent email for ${quotation._id} (${quotation.email})`,
          );
        } else if (result.action === 'skipped_duplicate_email') {
          summary.duplicateEmailsSkipped += 1;
          console.log(
            `[retargeting] duplicate skip ${quotation._id} (${quotation.email})`,
          );
        } else if (result.action === 'already_linked') {
          summary.alreadyLinked += 1;
        } else {
          summary.skipped += 1;
        }
      } catch (error) {
        summary.errors += 1;
        console.error(
          `[retargeting error] quotation ${quotation._id} (${quotation.email}):`,
          error.message,
        );
      }
    }

    const hasMore = i + BATCH_SIZE < due.length;
    if (hasMore && BATCH_DELAY_MS > 0 && !dryRun) {
      console.log(`[retargeting] Waiting ${BATCH_DELAY_MS}ms before next chunk...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  return summary;
}

const run = async () => {
  const { dryRun, acceptedOnly, linksOnly, retargetingOnly } = parseArgs();
  const runLinks = !retargetingOnly;
  const runRetargeting = !linksOnly;

  try {
    await connectDB();

    console.log('Backfill quotation links + pending retargeting emails');
    console.log(`  dry-run: ${dryRun}`);
    if (runLinks) {
      console.log(`  link phase: on${acceptedOnly ? ' (accepted-only)' : ''}`);
    }
    if (runRetargeting) {
      console.log(
        `  retargeting phase: pending, >= ${AUTO_RETARGET_DAYS} days @ ${AUTO_RETARGET_HOUR}:00, ` +
          `no reminderDate, one email per address, chunks of ${BATCH_SIZE}\n`,
      );
    } else {
      console.log('');
    }

    let exitCode = 0;

    if (runLinks) {
      console.log('--- Phase 1: Link quotations to tasks ---\n');
      const linkSummary = await backfillQuotationTaskLinks({ dryRun, acceptedOnly });
      console.log('\nLink phase done');
      console.log(`  Scanned: ${linkSummary.scanned}`);
      console.log(`  Linked${dryRun ? ' (would)' : ''}: ${linkSummary.linked}`);
      console.log(`  Already linked: ${linkSummary.alreadyLinked}`);
      console.log(`  No match: ${linkSummary.noMatch}`);
      console.log(`  Errors: ${linkSummary.errors}`);
      if (linkSummary.errors > 0) {
        exitCode = 1;
      }
    }

    if (runRetargeting) {
      console.log('\n--- Phase 2: Retargeting emails (pending, due) ---\n');
      const retargetSummary = await backfillPendingRetargetingEmails({ dryRun });
      console.log('\nRetargeting phase done');
      console.log(`  Candidates scanned: ${retargetSummary.scanned}`);
      console.log(`  Eligible (2+ day rule): ${retargetSummary.eligible}`);
      console.log(`  Linked${dryRun ? ' (would)' : ''}: ${retargetSummary.linked}`);
      console.log(`  Emails sent${dryRun ? ' (would)' : ''}: ${retargetSummary.emailsSent}`);
      console.log(`  Duplicate email skipped: ${retargetSummary.duplicateEmailsSkipped}`);
      console.log(`  Already linked: ${retargetSummary.alreadyLinked}`);
      console.log(`  Other skipped: ${retargetSummary.skipped}`);
      console.log(`  Errors: ${retargetSummary.errors}`);
      if (retargetSummary.errors > 0) {
        exitCode = 1;
      }
    }

    process.exit(exitCode);
  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  run();
}

module.exports = {
  backfillQuotationTaskLinks,
  backfillPendingRetargetingEmails,
};
