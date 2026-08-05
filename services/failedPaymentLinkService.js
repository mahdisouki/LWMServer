const Task = require('../models/Task');
const PendingPaymentLinkEmail = require('../models/PendingPaymentLinkEmail');

const PAYMENT_LINK_RETRY_DELAY_MINUTES = 5;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_ERROR_MS = 5 * 60 * 1000;

function getDelayMs() {
  return PAYMENT_LINK_RETRY_DELAY_MINUTES * 60 * 1000;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRetryIntroText(orderNumber) {
  const orderRef = orderNumber ? ` for order #${orderNumber}` : '';
  return (
    `We noticed that your payment was not completed${orderRef}. ` +
    'Please use the secure Stripe or PayPal links below to complete your booking. ' +
    'If you need help, contact us at hello@londonwastemanagement.com.'
  );
}

function buildRetryEmailTitle(paymentType) {
  const normalized = String(paymentType || 'total').toLowerCase();
  if (normalized === 'deposit') return 'Complete Your Deposit Payment';
  if (normalized === 'remaining') return 'Complete Your Remaining Payment';
  return 'Complete Your Payment';
}

async function findLatestEligibleFailedTaskId(customerEmail) {
  const normalized = normalizeEmail(customerEmail);
  const emailRegex = new RegExp(`^${escapeRegExp(normalized)}$`, 'i');

  const latest = await Task.findOne({
    email: emailRegex,
    paymentStatus: 'Failed',
    createdByType: 'public',
    paymentLinkRetryEmailSent: { $ne: true },
    createdBy: { $ne: 'MigrationScript' },
  })
    .sort({ createdAt: -1 })
    .select('_id');

  return latest?._id || null;
}

/** Any later paid order for the same email (admin or public) suppresses the retry. */
async function hasNewerPaidOrderForEmail(customerEmail, afterDate) {
  if (!afterDate) return false;

  const normalized = normalizeEmail(customerEmail);
  const emailRegex = new RegExp(`^${escapeRegExp(normalized)}$`, 'i');

  const newerPaid = await Task.findOne({
    email: emailRegex,
    paymentStatus: { $in: ['Paid', 'partial_Paid', 'Unpaid'] },
    createdAt: { $gt: afterDate },
    createdBy: { $ne: 'MigrationScript' },
  }).select('_id');

  return Boolean(newerPaid);
}

/**
 * One active (pending/processing) slot per customer email.
 * Newer checkout updates that slot and resets the timer.
 * Sent / cancelled / skipped / failed rows are kept for history.
 */
async function schedulePaymentLinkRetry(taskId, { paymentType = 'total' } = {}) {
  if (!taskId) return { scheduled: false, reason: 'missing_task_id' };

  const task = await Task.findById(taskId).select(
    'email createdByType createdBy paymentStatus paymentLinkRetryEmailSent createdAt',
  );
  if (!task) return { scheduled: false, reason: 'task_not_found' };
  if (task.createdByType !== 'public') return { scheduled: false, reason: 'not_public' };
  if (task.createdBy === 'MigrationScript') return { scheduled: false, reason: 'migrated' };
  if (task.paymentStatus !== 'Failed') return { scheduled: false, reason: 'not_failed' };
  if (task.paymentLinkRetryEmailSent) return { scheduled: false, reason: 'already_sent' };

  const customerEmail = String(task.email || '').trim();
  if (!customerEmail) return { scheduled: false, reason: 'no_email' };

  const normalized = normalizeEmail(customerEmail);
  const scheduledAt = new Date(Date.now() + getDelayMs());
  const slotFields = {
    taskId,
    customerEmail: normalized,
    taskCreatedAt: task.createdAt,
    scheduledAt,
    paymentType,
    status: 'pending',
    attempts: 0,
    lastError: null,
    sentAt: null,
  };

  const existingActive = await PendingPaymentLinkEmail.findOneAndUpdate(
    {
      customerEmail: normalized,
      status: { $in: ['pending', 'processing'] },
    },
    { $set: slotFields },
    { new: true, sort: { updatedAt: -1 } },
  );

  if (!existingActive) {
    await PendingPaymentLinkEmail.create(slotFields);
  }

  return { scheduled: true, scheduledAt };
}

async function cancelScheduledPaymentLinkRetry(taskId) {
  if (!taskId) return;
  await PendingPaymentLinkEmail.updateMany(
    { taskId, status: { $in: ['pending', 'processing'] } },
    { status: 'cancelled', lastError: 'payment_settled' },
  );
}

async function processOne(item) {
  const id = item._id;

  try {
    const task = await Task.findById(item.taskId).select(
      'paymentStatus paymentLinkRetryEmailSent email createdByType createdBy orderNumber createdAt',
    );

    if (!task) {
      await PendingPaymentLinkEmail.updateOne(
        { _id: id },
        { status: 'cancelled', lastError: 'task_not_found' },
      );
      return;
    }

    if (task.createdBy === 'MigrationScript') {
      await PendingPaymentLinkEmail.updateOne(
        { _id: id },
        { status: 'skipped', lastError: 'migrated' },
      );
      return;
    }

    if (task.paymentStatus !== 'Failed') {
      await PendingPaymentLinkEmail.updateOne(
        { _id: id },
        { status: 'cancelled', lastError: 'payment_no_longer_failed' },
      );
      return;
    }

    if (task.paymentLinkRetryEmailSent) {
      await PendingPaymentLinkEmail.updateOne(
        { _id: id },
        { status: 'skipped', lastError: 'already_sent' },
      );
      return;
    }

    if (!String(task.email || '').trim()) {
      await PendingPaymentLinkEmail.updateOne(
        { _id: id },
        { status: 'skipped', lastError: 'no_email' },
      );
      return;
    }

    if (await hasNewerPaidOrderForEmail(task.email, task.createdAt)) {
      await PendingPaymentLinkEmail.updateOne(
        { _id: id },
        { status: 'skipped', lastError: 'newer_paid_order' },
      );
      return;
    }

    const latestTaskId = await findLatestEligibleFailedTaskId(task.email);
    if (!latestTaskId || String(latestTaskId) !== String(item.taskId)) {
      await PendingPaymentLinkEmail.updateOne(
        { _id: id },
        { status: 'skipped', lastError: 'superseded_by_newer_order' },
      );
      return;
    }

    const { deliverPaymentLinksForTask } = require('../controllers/taskCtrl');
    const paymentType = item.paymentType || 'total';
    const result = await deliverPaymentLinksForTask(item.taskId, {
      paymentType,
      introText: buildRetryIntroText(task.orderNumber),
      emailTitle: buildRetryEmailTitle(paymentType),
    });

    if (result.sent) {
      await Task.updateOne(
        { _id: item.taskId },
        {
          paymentLinkRetryEmailSent: true,
          paymentLinkRetryEmailSentAt: new Date(),
        },
      );

      await PendingPaymentLinkEmail.updateOne(
        { _id: id },
        { status: 'sent', sentAt: new Date(), lastError: null },
      );
      console.log(
        `[Payment Link Retry] Sent for order #${task.orderNumber || item.taskId}`,
      );
      return;
    }

    await PendingPaymentLinkEmail.updateOne(
      { _id: id },
      { status: 'skipped', lastError: result.reason || 'send_failed' },
    );
  } catch (error) {
    const attempts = (item.attempts || 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;

    await PendingPaymentLinkEmail.updateOne(
      { _id: id },
      {
        status: failed ? 'failed' : 'pending',
        attempts,
        lastError: error.message,
        ...(failed ? {} : { scheduledAt: new Date(Date.now() + RETRY_AFTER_ERROR_MS) }),
      },
    );

    console.error(
      `[Payment Link Retry] Failed for task ${item.taskId} (attempt ${attempts}/${MAX_ATTEMPTS}):`,
      error.message,
    );
  }
}

async function processDuePaymentLinkEmails() {
  const now = new Date();

  while (true) {
    const item = await PendingPaymentLinkEmail.findOneAndUpdate(
      { status: 'pending', scheduledAt: { $lte: now } },
      { status: 'processing' },
      { sort: { scheduledAt: 1 }, new: true },
    );
    if (!item) break;
    await processOne(item);
  }
}

module.exports = {
  schedulePaymentLinkRetry,
  cancelScheduledPaymentLinkRetry,
  processDuePaymentLinkEmails,
  buildRetryIntroText,
  buildRetryEmailTitle,
};
