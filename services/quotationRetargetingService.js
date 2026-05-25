const Coupon = require('../models/Coupon');
const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const { sendQuotationRetargetingEmail } = require('../utils/sendQuotationRetargetingEmail');
const {
  findLinkedTaskForQuotation,
  tryLinkQuotationToMatchingTask,
} = require('./quotationTaskMatchingService');

function generateShortCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function isQuotationEligibleForScheduledRetargeting(quotation, quotationIdsWithOrders) {
  if (!quotation.email) {
    return false;
  }

  if (quotation.retargetingEmailSent) {
    return false;
  }

  const quotationIdStr = quotation._id.toString();
  if (quotationIdsWithOrders.has(quotationIdStr)) {
    return false;
  }

  return true;
}

/**
 * Creates coupons, sends the quotation retargeting email, and updates the quotation record.
 */
async function sendQuotationRetargetingEmailForQuotation(quotation) {
  if (!quotation.email) {
    throw new Error('Customer email is required to send retargeting email');
  }

  if (quotation.retargetingEmailSent) {
    throw new Error('Retargeting email has already been sent for this quotation');
  }

  const linkedTask = await findLinkedTaskForQuotation(quotation._id);
  if (linkedTask) {
    throw new Error('Quotation is already linked to a task');
  }

  const coupon20Code = generateShortCode();
  const coupon10Code = generateShortCode();

  const emailSentAt = new Date();
  const expiresAt20Percent = new Date(emailSentAt);
  expiresAt20Percent.setHours(expiresAt20Percent.getHours() + 24);

  const expiresAt10Percent = new Date(emailSentAt);
  expiresAt10Percent.setHours(expiresAt10Percent.getHours() + 72);

  const coupon20 = new Coupon({
    code: coupon20Code.toUpperCase(),
    percentage: 20,
    expirationDuration: 24,
    expiresAt: expiresAt20Percent,
    description: `Quotation retargeting coupon (20%) for quotation ${quotation._id}`,
    maxUsage: 1,
    isActive: true,
  });
  await coupon20.save();

  const coupon10 = new Coupon({
    code: coupon10Code.toUpperCase(),
    percentage: 10,
    expirationDuration: 72,
    expiresAt: expiresAt10Percent,
    description: `Quotation retargeting coupon (10%) for quotation ${quotation._id}`,
    maxUsage: 1,
    isActive: true,
  });
  await coupon10.save();

  await sendQuotationRetargetingEmail({
    customerEmail: quotation.email,
    customerName: quotation.Name,
    coupon20Code: coupon20.code,
    coupon10Code: coupon10.code,
    expiresAt20: expiresAt20Percent,
    expiresAt10: expiresAt10Percent,
  });

  quotation.retargetingEmailSent = true;
  quotation.retargetingEmailSentAt = emailSentAt;
  quotation.retargetingCoupon20Id = coupon20._id;
  quotation.retargetingCoupon10Id = coupon10._id;
  quotation.reminderSent = true;
  quotation.reason = 'no response';
  quotation.customReason = null;
  await quotation.save();

  return { quotation, coupon20, coupon10 };
}

/**
 * Attempts to link quotations without a non-failed linked task (pending or rejected-after-email).
 */
async function linkPendingQuotationsToTasks() {
  const linkedQuotationIds = await Task.distinct('quotationId', {
    quotationId: { $ne: null },
    paymentStatus: { $ne: 'Failed' },
  });

  const unlinked = await QuotationRequest.find({
    _id: { $nin: linkedQuotationIds },
  }).sort({ createdAt: -1 });

  let linked = 0;
  for (const quotation of unlinked) {
    const result = await tryLinkQuotationToMatchingTask(quotation);
    if (result.action === 'linked') {
      linked += 1;
    }
  }
  return linked;
}

/**
 * Links quotation to an existing matching task, or sends retargeting email if none found.
 */
async function processQuotationForRetargeting(quotation, quotationIdsWithOrders) {
  const quotationIdStr = quotation._id.toString();

  if (!isQuotationEligibleForScheduledRetargeting(quotation, quotationIdsWithOrders)) {
    return { action: 'skipped', quotationId: quotationIdStr };
  }

  const existingLink = await findLinkedTaskForQuotation(quotation._id);
  if (existingLink) {
    quotationIdsWithOrders.add(quotationIdStr);
    return { action: 'already_linked', taskId: existingLink._id, quotationId: quotationIdStr };
  }

  const linkResult = await tryLinkQuotationToMatchingTask(quotation);
  if (linkResult.action === 'linked') {
    quotationIdsWithOrders.add(quotationIdStr);
    return {
      action: 'linked',
      taskId: linkResult.taskId,
      quotationId: quotationIdStr,
    };
  }

  const result = await sendQuotationRetargetingEmailForQuotation(quotation);
  return {
    action: 'retargeting_sent',
    quotationId: quotationIdStr,
    coupon20: result.coupon20,
    coupon10: result.coupon10,
  };
}

module.exports = {
  isQuotationEligibleForScheduledRetargeting,
  sendQuotationRetargetingEmailForQuotation,
  linkPendingQuotationsToTasks,
  processQuotationForRetargeting,
};
