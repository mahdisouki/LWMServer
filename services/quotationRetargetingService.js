const Coupon = require('../models/Coupon');
const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const { sendQuotationRetargetingEmail } = require('../utils/sendQuotationRetargetingEmail');
const {
  findLinkedTaskForQuotation,
  tryLinkQuotationToMatchingTask,
  normalizeEmail,
} = require('./quotationTaskMatchingService');

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

function generateShortCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if any other quotation for this email already received a retargeting email. */
async function hasRetargetingEmailSentForQuotationEmail(email, excludeQuotationId = null) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }

  const query = {
    email: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, 'i') },
    retargetingEmailSent: true,
  };
  if (excludeQuotationId) {
    query._id = { $ne: excludeQuotationId };
  }

  return Boolean(await QuotationRequest.exists(query));
}

/**
 * Marks a quotation as retargeted without sending another email (same customer).
 */
async function suppressQuotationRetargetingAsDuplicate(quotation) {
  if (quotation.retargetingEmailSent) {
    return quotation;
  }

  quotation.retargetingEmailSent = true;
  quotation.retargetingEmailSentAt = new Date();
  quotation.reminderSent = true;
  quotation.customReason = null;
  if (!quotation.reason || String(quotation.reason).trim() === '') {
    quotation.reason = 'no response';
  }
  await quotation.save();
  return quotation;
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

  if (await hasRetargetingEmailSentForQuotationEmail(quotation.email, quotation._id)) {
    throw new Error('Retargeting email already sent to this customer email via another quotation');
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
 * Processes in chunks with pauses to avoid overloading the server.
 */
async function linkPendingQuotationsToTasks(options = {}) {
  const batchSize = options.batchSize ?? RETARGETING_BATCH_SIZE;
  const batchDelayMs = options.batchDelayMs ?? RETARGETING_BATCH_DELAY_MS;

  const linkedQuotationIds = await Task.distinct('quotationId', {
    quotationId: { $ne: null },
    paymentStatus: { $ne: 'Failed' },
  });

  const unlinked = await QuotationRequest.find({
    _id: { $nin: linkedQuotationIds },
  }).sort({ createdAt: -1 });

  if (unlinked.length === 0) {
    return 0;
  }

  let linked = 0;
  const totalBatches = Math.ceil(unlinked.length / batchSize);

  for (let i = 0; i < unlinked.length; i += batchSize) {
    const chunk = unlinked.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    if (unlinked.length > batchSize) {
      console.log(
        `[Quotation Link] Proactive chunk ${batchNum}/${totalBatches} (${chunk.length} quotation(s))`,
      );
    }

    for (const quotation of chunk) {
      const result = await tryLinkQuotationToMatchingTask(quotation);
      if (result.action === 'linked') {
        linked += 1;
        console.log(
          `[Quotation Link] Linked quotation ${quotation._id} to task ${result.taskId}`,
        );
      }
    }

    const hasMore = i + batchSize < unlinked.length;
    if (hasMore && batchDelayMs > 0) {
      console.log(`[Quotation Link] Waiting ${batchDelayMs}ms before next chunk...`);
      await sleep(batchDelayMs);
    }
  }

  return linked;
}

/**
 * Links quotation to an existing matching task, or sends retargeting email if none found.
 */
async function processQuotationForRetargeting(
  quotation,
  quotationIdsWithOrders,
  processedEmails = null,
) {
  const quotationIdStr = quotation._id.toString();
  const emailKey = normalizeEmail(quotation.email);

  if (!isQuotationEligibleForScheduledRetargeting(quotation, quotationIdsWithOrders)) {
    return { action: 'skipped', quotationId: quotationIdStr };
  }

  if (emailKey && processedEmails?.has(emailKey)) {
    await suppressQuotationRetargetingAsDuplicate(quotation);
    return { action: 'skipped_duplicate_email', quotationId: quotationIdStr };
  }

  if (emailKey && await hasRetargetingEmailSentForQuotationEmail(quotation.email, quotation._id)) {
    await suppressQuotationRetargetingAsDuplicate(quotation);
    if (processedEmails) {
      processedEmails.add(emailKey);
    }
    return { action: 'skipped_duplicate_email', quotationId: quotationIdStr };
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
  if (emailKey && processedEmails) {
    processedEmails.add(emailKey);
  }
  return {
    action: 'retargeting_sent',
    quotationId: quotationIdStr,
    coupon20: result.coupon20,
    coupon10: result.coupon10,
  };
}

module.exports = {
  isQuotationEligibleForScheduledRetargeting,
  hasRetargetingEmailSentForQuotationEmail,
  suppressQuotationRetargetingAsDuplicate,
  sendQuotationRetargetingEmailForQuotation,
  linkPendingQuotationsToTasks,
  processQuotationForRetargeting,
};
