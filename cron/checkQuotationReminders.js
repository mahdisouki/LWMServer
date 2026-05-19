const cron = require('node-cron');
const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const {
  isQuotationEligibleForScheduledRetargeting,
  sendQuotationRetargetingEmailForQuotation,
} = require('../services/quotationRetargetingService');

async function checkQuotationReminders() {
  try {
    const now = new Date();
    console.log(`[Quotation Retargeting] Checking at ${now.toISOString()}`);

    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const quotationsDue = await QuotationRequest.find({
      reminderDate: {
        $lte: now,
        $gte: oneDayAgo,
        $ne: null,
      },
      retargetingEmailSent: { $ne: true },
    });

    console.log(
      `[Quotation Retargeting] Found ${quotationsDue.length} quotation(s) with due reminder dates`,
    );

    if (quotationsDue.length === 0) {
      return;
    }

    const quotationIds = quotationsDue.map((q) => q._id);
    const tasksWithQuotations = await Task.find({
      quotationId: { $in: quotationIds },
    }).select('quotationId');

    const quotationIdsWithOrders = new Set(
      tasksWithQuotations.map((t) => t.quotationId.toString()),
    );

    const eligibleQuotations = quotationsDue.filter((quotation) =>
      isQuotationEligibleForScheduledRetargeting(quotation, quotationIdsWithOrders),
    );

    console.log(
      `[Quotation Retargeting] ${eligibleQuotations.length} quotation(s) eligible to receive retargeting email`,
    );

    let emailsSent = 0;
    let emailsFailed = 0;

    for (const quotation of eligibleQuotations) {
      try {
        const { coupon20, coupon10 } = await sendQuotationRetargetingEmailForQuotation(quotation);
        emailsSent += 1;
        console.log(
          `[Quotation Retargeting] Sent retargeting email for quotation ${quotation._id} (${quotation.email}) - coupons ${coupon20.code}, ${coupon10.code}`,
        );
      } catch (error) {
        emailsFailed += 1;
        console.error(
          `[Quotation Retargeting] Failed for quotation ${quotation._id} (${quotation.email}):`,
          error.message,
        );
      }
    }

    const skipped = quotationsDue.length - eligibleQuotations.length;
    console.log(
      `[Quotation Retargeting] Completed: ${emailsSent} sent, ${emailsFailed} failed, ${skipped} skipped`,
    );
  } catch (error) {
    console.error('Error in checkQuotationReminders:', error);
  }
}

cron.schedule('*/5 * * * *', checkQuotationReminders);

console.log(
  'Quotation retargeting scheduler running (checks every 5 minutes for due reminderDate)...',
);

module.exports = { checkQuotationReminders };
