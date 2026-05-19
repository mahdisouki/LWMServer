const Coupon = require('../models/Coupon');
const { sendQuotationRetargetingEmail } = require('../utils/sendQuotationRetargetingEmail');

function generateShortCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

const RETARGETING_REASONS = ['no response', 'price too high'];

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

  const reason = quotation.reason && quotation.reason.trim();
  if (!reason) {
    return true;
  }

  return RETARGETING_REASONS.includes(reason);
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
  await quotation.save();

  return { quotation, coupon20, coupon10 };
}

module.exports = {
  RETARGETING_REASONS,
  isQuotationEligibleForScheduledRetargeting,
  sendQuotationRetargetingEmailForQuotation,
};
