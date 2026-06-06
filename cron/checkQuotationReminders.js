const cron = require('node-cron');
const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const {
  AUTO_RETARGET_DAYS,
  AUTO_RETARGET_DELAY_MS,
  AUTO_RETARGET_HOUR,
  isAutoRetargetEligible,
  isReminderRetargetDue,
} = require('../services/quotationTaskMatchingService');
const {
  processQuotationForRetargeting,
} = require('../services/quotationRetargetingService');

/** Daily send window — 20:00 (8 PM) in QUOTATION_RETARGETING_TIMEZONE. */
const RETARGETING_CRON_HOUR = Number.parseInt(
  process.env.QUOTATION_RETARGETING_CRON_HOUR || '20',
  10,
);
const RETARGETING_CRON_TIMEZONE =
  process.env.QUOTATION_RETARGETING_TIMEZONE || 'Europe/London';
const RETARGETING_BATCH_SIZE = Number.parseInt(
  process.env.QUOTATION_RETARGETING_BATCH_SIZE || '10',
  10,
);
const RETARGETING_BATCH_DELAY_MS = Number.parseInt(
  process.env.QUOTATION_RETARGETING_BATCH_DELAY_MS || '5000',
  10,
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeQuotationsById(quotations) {
  const seen = new Set();
  return quotations.filter((q) => {
    const id = q._id.toString();
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

async function buildQuotationIdsWithOrders(quotationIds) {
  const tasksWithQuotations = await Task.find({
    quotationId: { $in: quotationIds },
    paymentStatus: { $ne: 'Failed' },
  }).select('quotationId');

  return new Set(tasksWithQuotations.map((t) => t.quotationId.toString()));
}

async function runRetargetingBatch(quotations, quotationIdsWithOrders, label) {
  let linked = 0;
  let emailsSent = 0;
  let emailsFailed = 0;
  let skipped = 0;
  let duplicateEmailsSkipped = 0;
  const processedEmails = new Set();

  for (const quotation of quotations) {
    try {
      const result = await processQuotationForRetargeting(
        quotation,
        quotationIdsWithOrders,
        processedEmails,
      );

      if (result.action === 'linked') {
        linked += 1;
        console.log(
          `[Quotation Retargeting] [${label}] Linked quotation ${quotation._id} to task ${result.taskId}`,
        );
      } else if (result.action === 'retargeting_sent') {
        emailsSent += 1;
        console.log(
          `[Quotation Retargeting] [${label}] Sent retargeting email for quotation ${quotation._id} (${quotation.email})`,
        );
      } else if (result.action === 'already_linked') {
        linked += 1;
      } else if (result.action === 'skipped_duplicate_email') {
        duplicateEmailsSkipped += 1;
        console.log(
          `[Quotation Retargeting] [${label}] Skipped duplicate email for quotation ${quotation._id} (${quotation.email}) — already sent for this customer`,
        );
      } else {
        skipped += 1;
      }
    } catch (error) {
      emailsFailed += 1;
      console.error(
        `[Quotation Retargeting] [${label}] Failed for quotation ${quotation._id} (${quotation.email}):`,
        error.message,
      );
    }
  }

  return { linked, emailsSent, emailsFailed, skipped, duplicateEmailsSkipped };
}

function mergeTotals(into, from) {
  into.linked += from.linked;
  into.emailsSent += from.emailsSent;
  into.emailsFailed += from.emailsFailed;
  into.skipped += from.skipped;
  into.duplicateEmailsSkipped += from.duplicateEmailsSkipped;
}

/** Process due quotations in small chunks with pauses between chunks. */
async function runRetargetingInChunks(quotations, quotationIdsWithOrders) {
  const totals = {
    linked: 0,
    emailsSent: 0,
    emailsFailed: 0,
    skipped: 0,
    duplicateEmailsSkipped: 0,
  };

  if (quotations.length === 0) {
    return totals;
  }

  const totalBatches = Math.ceil(quotations.length / RETARGETING_BATCH_SIZE);

  for (let i = 0; i < quotations.length; i += RETARGETING_BATCH_SIZE) {
    const chunk = quotations.slice(i, i + RETARGETING_BATCH_SIZE);
    const batchNum = Math.floor(i / RETARGETING_BATCH_SIZE) + 1;

    console.log(
      `[Quotation Retargeting] Chunk ${batchNum}/${totalBatches} (${chunk.length} quotation(s), batch size ${RETARGETING_BATCH_SIZE})`,
    );

    const batchTotals = await runRetargetingBatch(
      chunk,
      quotationIdsWithOrders,
      `chunk-${batchNum}`,
    );
    mergeTotals(totals, batchTotals);

    const hasMore = i + RETARGETING_BATCH_SIZE < quotations.length;
    if (hasMore && RETARGETING_BATCH_DELAY_MS > 0) {
      console.log(
        `[Quotation Retargeting] Waiting ${RETARGETING_BATCH_DELAY_MS}ms before next chunk...`,
      );
      await sleep(RETARGETING_BATCH_DELAY_MS);
    }
  }

  return totals;
}

async function checkQuotationReminders() {
  try {
    const now = new Date();
    console.log(`[Quotation Retargeting] Checking at ${now.toISOString()}`);

    const autoCutoff = new Date(now.getTime() - AUTO_RETARGET_DELAY_MS);

    const [reminderCandidates, autoCandidates] = await Promise.all([
      QuotationRequest.find({
        reminderDate: { $ne: null },
        retargetingEmailSent: { $ne: true },
      }),
      QuotationRequest.find({
        reminderDate: null,
        retargetingEmailSent: { $ne: true },
        createdAt: { $lte: autoCutoff },
      }),
    ]);

    const reminderDue = reminderCandidates.filter((q) =>
      isReminderRetargetDue(q, now),
    );
    const autoDue = autoCandidates.filter((q) => isAutoRetargetEligible(q, now));

    const quotationsToProcess = dedupeQuotationsById([...reminderDue, ...autoDue]).sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    );

    console.log(
      `[Quotation Retargeting] ${reminderDue.length} admin reminder(s) due (send at reminderDate), ${autoDue.length} auto (2-day @ ${AUTO_RETARGET_HOUR}:00), ${quotationsToProcess.length} unique to process`,
    );

    if (quotationsToProcess.length === 0) {
      return;
    }

    const quotationIdsWithOrders = await buildQuotationIdsWithOrders(
      quotationsToProcess.map((q) => q._id),
    );

    const totals = await runRetargetingInChunks(
      quotationsToProcess,
      quotationIdsWithOrders,
    );

    console.log(
      `[Quotation Retargeting] Completed: ${totals.linked} linked, ${totals.emailsSent} sent, ${totals.emailsFailed} failed, ${totals.skipped} skipped, ${totals.duplicateEmailsSkipped} duplicate-email skipped`,
    );
  } catch (error) {
    console.error('Error in checkQuotationReminders:', error);
  }
}

// Once daily at 8 PM (configurable) — Europe/London by default.
cron.schedule(`0 ${RETARGETING_CRON_HOUR} * * *`, checkQuotationReminders, {
  timezone: RETARGETING_CRON_TIMEZONE,
});

console.log(
  `[Quotation Retargeting] Scheduler running daily at ${RETARGETING_CRON_HOUR}:00 ${RETARGETING_CRON_TIMEZONE} ` +
    `(due quotations only: link-if-match then retarget email in chunks of ${RETARGETING_BATCH_SIZE}, ${RETARGETING_BATCH_DELAY_MS}ms pause; ` +
    `auto eligible ${AUTO_RETARGET_DAYS}d after creation @ ${AUTO_RETARGET_HOUR}:00 if no admin reminder)`,
);

module.exports = { checkQuotationReminders };
