const Task = require('../models/Task');
const Coupon = require('../models/Coupon');
const { sendRetargetingEmail } = require('../utils/sendRetargetingEmail');

function generateShortCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function hasAnyNonFailedTaskForEmail(email) {
  const emailNormalized = String(email).trim().toLowerCase();
  const emailExactCi = new RegExp(`^${escapeRegExp(emailNormalized)}$`, 'i');
  const count = await Task.countDocuments({
    email: emailExactCi,
    paymentStatus: { $ne: 'Failed' },
    createdBy: { $ne: 'MigrationScript' }, // Ignore CSV-migrated orders
  });
  return count > 0;
}

/**
 * Sends a retargeting email for a task and creates dedicated coupons.
 * Can enforce strict automation eligibility checks when requested.
 */
async function sendRetargetingEmailForTask(taskId, options = {}) {
  const { enforceAutomationEligibility = false } = options;

  if (!taskId) {
    throw new Error('Task ID is required');
  }

  const task = await Task.findById(taskId).populate('items.standardItemId');
  if (!task) {
    throw new Error('Task not found');
  }

  if (task.createdBy === 'MigrationScript') {
    throw new Error('Retargeting email is not available for migrated orders');
  }

  if (task.createdByType !== 'public') {
    throw new Error('This feature is only available for public orders');
  }

  if (task.paymentStatus !== 'Failed') {
    throw new Error('This feature is only available for orders with failed payment status');
  }

  if (!task.email) {
    throw new Error('Customer email is required to send retargeting email');
  }

  if (task.retargetingEmailSent) {
    throw new Error('Retargeting email has already been sent for this order');
  }

  if (enforceAutomationEligibility) {
    if (Number(task.repeatCustomer || 0) > 0) {
      throw new Error('Task is not eligible for automated retargeting: repeat customer');
    }

    const hasNonFailedTask = await hasAnyNonFailedTaskForEmail(task.email);
    if (hasNonFailedTask) {
      throw new Error('Task is not eligible for automated retargeting: customer has non-failed task');
    }
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
    description: `Retargeting coupon (20%) for order ${task.orderNumber}`,
    maxUsage: 1,
    isActive: true,
  });
  await coupon20.save();

  const coupon10 = new Coupon({
    code: coupon10Code.toUpperCase(),
    percentage: 10,
    expirationDuration: 72,
    expiresAt: expiresAt10Percent,
    description: `Retargeting coupon (10%) for order ${task.orderNumber}`,
    maxUsage: 1,
    isActive: true,
  });
  await coupon10.save();

  const originalTotal = task.totalPrice;
  const MINIMUM_TOTAL = 45;

  let discount20Amount = (originalTotal * 20) / 100;
  let discountedTotal20 = originalTotal - discount20Amount;
  let minFeeApplied20 = false;

  if (discountedTotal20 < MINIMUM_TOTAL) {
    discountedTotal20 = MINIMUM_TOTAL;
    discount20Amount = originalTotal - MINIMUM_TOTAL;
    minFeeApplied20 = true;
  }

  let discount10Amount = (originalTotal * 10) / 100;
  let discountedTotal10 = originalTotal - discount10Amount;
  let minFeeApplied10 = false;

  if (discountedTotal10 < MINIMUM_TOTAL) {
    discountedTotal10 = MINIMUM_TOTAL;
    discount10Amount = originalTotal - MINIMUM_TOTAL;
    minFeeApplied10 = true;
  }

  await sendRetargetingEmail({
    customerEmail: task.email,
    firstName: task.firstName,
    lastName: task.lastName,
    orderNumber: task.orderNumber,
    coupon20Code: coupon20.code,
    coupon10Code: coupon10.code,
    discount20Percentage: 20,
    discount10Percentage: 10,
    items: task.items,
    originalTotal,
    discountedTotal20,
    discountedTotal10,
    minFeeApplied20,
    minFeeApplied10,
    expirationHours20: 24,
    expirationHours10: 72,
    expiresAt20: expiresAt20Percent,
    expiresAt10: expiresAt10Percent,
  });

  task.retargetingEmailSent = true;
  task.retargetingEmailSentAt = new Date();
  task.retargetingCoupon20Id = coupon20._id;
  task.retargetingCoupon10Id = coupon10._id;
  await task.save();

  return {
    task,
    coupon20,
    coupon10,
  };
}

module.exports = {
  sendRetargetingEmailForTask,
  hasAnyNonFailedTaskForEmail,
};
