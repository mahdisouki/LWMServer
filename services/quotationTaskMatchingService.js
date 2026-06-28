const Task = require('../models/Task');
const QuotationRequest = require('../models/QuotationRequest');

const FAILED_PAYMENT_STATUS = 'Failed';

function isTaskEligibleForQuotationLink(task) {
  return task && String(task.paymentStatus) !== FAILED_PAYMENT_STATUS;
}

/** Mongo filter: tasks that count as linked to a quotation. */
function quotationLinkEligibleFilter() {
  return { paymentStatus: { $ne: FAILED_PAYMENT_STATUS } };
}

function quotationLinkIneligibleFilter() {
  return { paymentStatus: FAILED_PAYMENT_STATUS };
}

const AUTO_RETARGET_DAYS = 2;
const AUTO_RETARGET_HOUR = Number.parseInt(
  process.env.QUOTATION_AUTO_RETARGET_HOUR || '14',
  10,
);
const AUTO_RETARGET_DELAY_MS = AUTO_RETARGET_DAYS * 24 * 60 * 60 * 1000;

/**
 * Earliest moment the auto retargeting email may be sent: 2 calendar days after
 * creation, at AUTO_RETARGET_HOUR (default 14:00) in the server local timezone.
 */
function getAutoRetargetEligibleAt(createdAt) {
  const eligible = new Date(createdAt);
  eligible.setDate(eligible.getDate() + AUTO_RETARGET_DAYS);
  eligible.setHours(AUTO_RETARGET_HOUR, 0, 0, 0);
  return eligible;
}

function isAutoRetargetEligible(quotation, now = new Date()) {
  if (quotation?.reminderDate) {
    return false;
  }
  if (!quotation?.createdAt) {
    return false;
  }
  return now >= getAutoRetargetEligibleAt(quotation.createdAt);
}

/** Admin-set reminder: send at reminderDate (not the 2-day / 14:00 auto rule). */
function isReminderRetargetDue(quotation, now = new Date()) {
  if (!quotation?.reminderDate) {
    return false;
  }
  return now >= new Date(quotation.reminderDate);
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('44')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function taskFullName(task) {
  return normalizeName(`${task.firstName || ''} ${task.lastName || ''}`);
}

function taskMatchesQuotation(task, quotation) {
  if (!isTaskEligibleForQuotationLink(task)) {
    return false;
  }

  const qEmail = normalizeEmail(quotation.email);
  const qPhone = normalizePhone(quotation.phoneNumber);
  const qName = normalizeName(quotation.Name);

  if (qEmail && normalizeEmail(task.email) === qEmail) {
    return true;
  }

  if (qPhone) {
    if (normalizePhone(task.phoneNumber) === qPhone) {
      return true;
    }
    if (normalizePhone(task.phoneNumber2) === qPhone) {
      return true;
    }
  }

  if (qName) {
    const taskName = taskFullName(task);
    if (taskName && qName === taskName) {
      return true;
    }
  }

  return false;
}

function baseTaskQuery(quotation) {
  return {
    $and: [
      { quotationId: null },
      { createdAt: { $gte: quotation.createdAt } },
      quotationLinkEligibleFilter(),
    ],
  };
}

/**
 * Finds the earliest unlinked task created after the quotation that matches
 * email, phone, or client name.
 */
async function findMatchingTaskForQuotation(quotation) {
  const query = baseTaskQuery(quotation);
  const email = normalizeEmail(quotation.email);
  const phone = normalizePhone(quotation.phoneNumber);
  const name = normalizeName(quotation.Name);

  if (email) {
    const byEmail = await Task.find({
      ...query,
      email: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
    })
      .sort({ createdAt: 1 })
      .limit(10);

    const match = byEmail.find((t) => taskMatchesQuotation(t, quotation));
    if (match) {
      return match;
    }
  }

  if (phone) {
    const suffix = phone.length >= 9 ? phone.slice(-9) : phone;
    const byPhone = await Task.find({
      ...query,
      $or: [
        { phoneNumber: { $regex: suffix } },
        { phoneNumber2: { $regex: suffix } },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(20);

    const match = byPhone.find((t) => taskMatchesQuotation(t, quotation));
    if (match) {
      return match;
    }
  }

  if (name) {
    const parts = (quotation.Name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');

      const byName = await Task.find({
        ...query,
        firstName: { $regex: new RegExp(`^${escapeRegex(firstName)}$`, 'i') },
        lastName: { $regex: new RegExp(`^${escapeRegex(lastName)}$`, 'i') },
      })
        .sort({ createdAt: 1 })
        .limit(10);

      const match = byName.find((t) => taskMatchesQuotation(t, quotation));
      if (match) {
        return match;
      }
    }
  }

  return null;
}

async function applyQuotationTaskCreatedReason(quotation) {
  quotation.reason = 'task created';
  quotation.customReason = null;
  await quotation.save();
}

async function clearIneligibleTaskQuotationLinks(quotationId) {
  await Task.updateMany(
    { quotationId, ...quotationLinkIneligibleFilter() },
    { $set: { quotationId: null } },
  );
}

async function revertQuotationTaskCreatedReasonIfOrphaned(quotationId) {
  const stillLinked = await findLinkedTaskForQuotation(quotationId);
  if (stillLinked) {
    return;
  }
  const quotation = await QuotationRequest.findById(quotationId);
  if (quotation && quotation.reason === 'task created') {
    await QuotationRequest.updateOne(
      { _id: quotationId },
      { $unset: { reason: '' }, $set: { customReason: null } },
    );
  }
}

function copyClickIdsFromQuotationToTask(task, quotation) {
  if (!task || !quotation) {
    return { changed: false, before: {}, after: {} };
  }

  const before = {
    gclid: task.gclid || null,
    gbraid: task.gbraid || null,
    wbraid: task.wbraid || null,
  };

  if (!task.gclid && quotation.gclid) task.gclid = quotation.gclid;
  if (!task.gbraid && quotation.gbraid) task.gbraid = quotation.gbraid;
  if (!task.wbraid && quotation.wbraid) task.wbraid = quotation.wbraid;

  const after = {
    gclid: task.gclid || null,
    gbraid: task.gbraid || null,
    wbraid: task.wbraid || null,
  };

  const changed = before.gclid !== after.gclid
    || before.gbraid !== after.gbraid
    || before.wbraid !== after.wbraid;

  return { changed, before, after };
}

async function linkQuotationToTask(quotation, task) {
  if (!isTaskEligibleForQuotationLink(task)) {
    throw new Error('Cannot link quotation to a task with failed payment status');
  }

  if (task.quotationId) {
    throw new Error('Task is already linked to a quotation');
  }

  await clearIneligibleTaskQuotationLinks(quotation._id);

  task.quotationId = quotation._id;

  const { before: clickIdsBefore, after } = copyClickIdsFromQuotationToTask(task, quotation);
  await task.save();
  console.log('[Quotation Link] linkQuotationToTask click IDs', {
    taskId: task._id?.toString?.() || task._id,
    quotationId: quotation._id?.toString?.() || quotation._id,
    quotationGclid: quotation.gclid || null,
    before: clickIdsBefore,
    after,
  });
  await applyQuotationTaskCreatedReason(quotation);
  return task;
}

async function findLinkedTaskForQuotation(quotationId) {
  return Task.findOne({
    quotationId,
    ...quotationLinkEligibleFilter(),
  }).sort({ createdAt: 1 });
}

/**
 * Finds the newest unlinked quotation (before task creation) that matches this task.
 * Includes quotes that already received retargeting email (customer booked after reject).
 */
async function findMatchingQuotationForTask(task) {
  if (task.quotationId || !isTaskEligibleForQuotationLink(task)) {
    return null;
  }

  const candidates = await QuotationRequest.find({
    createdAt: { $lte: task.createdAt },
  })
    .sort({ createdAt: -1 })
    .limit(50);

  for (const quotation of candidates) {
    const existingLink = await findLinkedTaskForQuotation(quotation._id);
    if (existingLink) {
      continue;
    }
    if (taskMatchesQuotation(task, quotation)) {
      return quotation;
    }
  }

  return null;
}

/** Link only — no retargeting email (safe while waiting for reminderDate). */
async function tryLinkQuotationToMatchingTask(quotation) {
  const existingLink = await findLinkedTaskForQuotation(quotation._id);
  if (existingLink) {
    return { action: 'already_linked', taskId: existingLink._id };
  }

  const matchedTask = await findMatchingTaskForQuotation(quotation);
  if (!matchedTask) {
    return { action: 'no_match' };
  }

  await linkQuotationToTask(quotation, matchedTask);
  return { action: 'linked', taskId: matchedTask._id, quotationId: quotation._id.toString() };
}

/** When a job is created without quotationId, link to a matching open quotation. */
async function tryLinkTaskToMatchingQuotation(task) {
  if (task.quotationId) {
    return { action: 'already_has_quotation' };
  }

  const quotation = await findMatchingQuotationForTask(task);
  if (!quotation) {
    return { action: 'no_match' };
  }

  await linkQuotationToTask(quotation, task);
  return {
    action: 'linked',
    taskId: task._id,
    quotationId: quotation._id.toString(),
  };
}

/**
 * Keeps task↔quotation in sync with payment eligibility.
 * Unpaid / Paid / partial_Paid link normally; Failed tasks are never linked.
 */
async function syncTaskQuotationLink(task) {
  if (!task) {
    console.log('[Quotation Link] syncTaskQuotationLink skipped: no task');
    return { action: 'skipped' };
  }

  const taskId = task._id?.toString?.() || task._id;
  console.log('[Quotation Link] syncTaskQuotationLink start', {
    taskId,
    paymentStatus: task.paymentStatus,
    quotationId: task.quotationId?.toString?.() || task.quotationId || null,
    email: task.email || null,
    phoneNumber: task.phoneNumber || null,
  });

  if (!isTaskEligibleForQuotationLink(task)) {
    if (!task.quotationId) {
      console.log('[Quotation Link] syncTaskQuotationLink deferred: ineligible payment, no quotationId', {
        taskId,
        paymentStatus: task.paymentStatus,
      });
      return { action: 'deferred' };
    }

    const quotationId = task.quotationId;
    console.log('[Quotation Link] syncTaskQuotationLink unlinking: ineligible payment', {
      taskId,
      quotationId: quotationId.toString(),
      paymentStatus: task.paymentStatus,
    });
    task.quotationId = null;
    await task.save();
    await revertQuotationTaskCreatedReasonIfOrphaned(quotationId);
    return { action: 'unlinked', quotationId: quotationId.toString() };
  }

  if (task.quotationId) {
    const quotation = await QuotationRequest.findById(task.quotationId);
    if (quotation) {
      await applyQuotationTaskCreatedReason(quotation);
      const { changed, before, after } = copyClickIdsFromQuotationToTask(task, quotation);
      if (changed) {
        await task.save();
        console.log('[Quotation Link] syncTaskQuotationLink copied click IDs from quotation', {
          taskId,
          quotationId: task.quotationId.toString(),
          before,
          after,
        });
      }
    }
    console.log('[Quotation Link] syncTaskQuotationLink already_has_quotation', {
      taskId,
      quotationId: task.quotationId.toString(),
      quotationFound: Boolean(quotation),
    });
    return { action: 'already_has_quotation' };
  }

  const result = await tryLinkTaskToMatchingQuotation(task);
  console.log('[Quotation Link] syncTaskQuotationLink tryLinkTaskToMatchingQuotation', {
    taskId,
    action: result.action,
    matchedQuotationId: result.quotationId || null,
  });
  return result;
}

module.exports = {
  FAILED_PAYMENT_STATUS,
  isTaskEligibleForQuotationLink,
  quotationLinkEligibleFilter,
  quotationLinkIneligibleFilter,
  AUTO_RETARGET_DAYS,
  AUTO_RETARGET_HOUR,
  AUTO_RETARGET_DELAY_MS,
  getAutoRetargetEligibleAt,
  isAutoRetargetEligible,
  isReminderRetargetDue,
  normalizeEmail,
  normalizePhone,
  normalizeName,
  taskMatchesQuotation,
  findMatchingTaskForQuotation,
  findMatchingQuotationForTask,
  linkQuotationToTask,
  copyClickIdsFromQuotationToTask,
  findLinkedTaskForQuotation,
  tryLinkQuotationToMatchingTask,
  tryLinkTaskToMatchingQuotation,
  syncTaskQuotationLink,
  applyQuotationTaskCreatedReason,
  revertQuotationTaskCreatedReasonIfOrphaned,
};
