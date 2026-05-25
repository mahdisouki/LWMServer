const cron = require('node-cron');
const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const {
  AUTO_RETARGET_DELAY_MS,
  AUTO_RETARGET_HOUR,
  isAutoRetargetEligible,
  isReminderRetargetDue,
} = require('../services/quotationTaskMatchingService');
const {
  linkPendingQuotationsToTasks,
  processQuotationForRetargeting,
} = require('../services/quotationRetargetingService');

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

  for (const quotation of quotations) {
    try {
      const result = await processQuotationForRetargeting(
        quotation,
        quotationIdsWithOrders,
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

  return { linked, emailsSent, emailsFailed, skipped };
}

async function checkQuotationReminders() {
  try {
    const now = new Date();
    console.log(`[Quotation Retargeting] Checking at ${now.toISOString()}`);

    const proactiveLinked = await linkPendingQuotationsToTasks();
    if (proactiveLinked > 0) {
      console.log(
        `[Quotation Retargeting] Proactively linked ${proactiveLinked} quotation(s) to matching task(s) (before send window)`,
      );
    }

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

    const quotationsToProcess = dedupeQuotationsById([...reminderDue, ...autoDue]);

    console.log(
      `[Quotation Retargeting] ${reminderDue.length} admin reminder(s) due (send at reminderDate), ${autoDue.length} auto (2-day @ ${AUTO_RETARGET_HOUR}:00), ${quotationsToProcess.length} unique to process`,
    );

    if (quotationsToProcess.length === 0) {
      return;
    }

    const quotationIdsWithOrders = await buildQuotationIdsWithOrders(
      quotationsToProcess.map((q) => q._id),
    );

    const totals = await runRetargetingBatch(
      quotationsToProcess,
      quotationIdsWithOrders,
      'batch',
    );

    console.log(
      `[Quotation Retargeting] Completed: ${totals.linked} linked, ${totals.emailsSent} sent, ${totals.emailsFailed} failed, ${totals.skipped} skipped`,
    );
  } catch (error) {
    console.error('Error in checkQuotationReminders:', error);
  }
}

cron.schedule('*/5 * * * *', checkQuotationReminders);

console.log(
  `Quotation retargeting scheduler running (every 5 min: admin reminderDate when due, or auto 2 days at ${AUTO_RETARGET_HOUR}:00 if no reminder)...`,
);

module.exports = { checkQuotationReminders };
