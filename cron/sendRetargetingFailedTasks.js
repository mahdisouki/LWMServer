const cron = require('node-cron');
const Task = require('../models/Task');
const {
  sendRetargetingEmailForTask,
  hasAnyNonFailedTaskForEmail,
} = require('../services/retargetingService');

const RETARGETING_BATCH_SIZE = 10;

function pendingRetargetingFilter(todayLondon, afterCreatedAt) {
  const createdBeforeToday = {
    $lt: [
      {
        $dateToString: {
          format: '%Y-%m-%d',
          date: '$createdAt',
          timezone: 'Europe/London',
        },
      },
      todayLondon,
    ],
  };

  const filter = {
    createdByType: 'public',
    createdBy: { $ne: 'MigrationScript' },
    paymentStatus: 'Failed',
    retargetingEmailSent: { $ne: true },
    repeatCustomer: 0,
    email: { $exists: true, $nin: [null, ''] },
    $expr: createdBeforeToday,
  };

  if (!afterCreatedAt) return filter;

  // Next page starts after this created time. Jobs that share a created time
  // are loaded together, so the page split does not drop one of them.
  delete filter.$expr;
  filter.$and = [
    { $expr: createdBeforeToday },
    { createdAt: { $gt: afterCreatedAt } },
  ];
  return filter;
}

async function sendScheduledRetargetingEmails() {
  try {
    // Day after creation in London, plus any earlier failed job that was never emailed.
    const todayLondon = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    let emailsSent = 0;
    let emailsSkipped = 0;
    let scanned = 0;
    const processedEmails = new Set();
    let afterCreatedAt = null;

    while (true) {
      const page = await Task.find(pendingRetargetingFilter(todayLondon, afterCreatedAt))
        .select('_id email orderNumber createdAt')
        .sort({ createdAt: 1 })
        .limit(RETARGETING_BATCH_SIZE);

      if (!page.length) break;

      let tasksToProcess = page;
      const boundary = page[page.length - 1].createdAt;

      // Same sort as before: created time only. When the page stops in the
      // middle of one created time, load the rest of that time too.
      if (page.length === RETARGETING_BATCH_SIZE) {
        const earlier = page.filter((task) => task.createdAt.getTime() !== boundary.getTime());
        const sameTime = await Task.find({
          ...pendingRetargetingFilter(todayLondon),
          createdAt: boundary,
        })
          .select('_id email orderNumber createdAt')
          .sort({ createdAt: 1 });
        tasksToProcess = earlier.concat(sameTime);
      }

      afterCreatedAt = boundary;
      scanned += tasksToProcess.length;
      console.log(`[Retargeting Cron] Batch of ${tasksToProcess.length} (${scanned} scanned)`);

      for (const task of tasksToProcess) {
        const emailNormalized = String(task.email).trim().toLowerCase();

        if (processedEmails.has(emailNormalized)) {
          emailsSkipped++;
          continue;
        }

        const hasNonFailedTask = await hasAnyNonFailedTaskForEmail(task.email);
        if (hasNonFailedTask) {
          console.log(
            `[Retargeting Cron] Skipping ${task.orderNumber} (${task.email}) - customer has non-failed task`,
          );
          emailsSkipped++;
          processedEmails.add(emailNormalized);
          continue;
        }

        try {
          await sendRetargetingEmailForTask(task._id, {
            enforceAutomationEligibility: true,
          });
          console.log(
            `[Retargeting Cron] Sent retargeting email for ${task.orderNumber} (${task.email})`,
          );
          emailsSent++;
          processedEmails.add(emailNormalized);
        } catch (error) {
          console.error(
            `[Retargeting Cron] Failed for ${task.orderNumber} (${task.email}):`,
            error.message,
          );
        }
      }

      if (page.length < RETARGETING_BATCH_SIZE) break;
    }

    console.log(
      `[Retargeting Cron] Completed: ${emailsSent} email(s) sent, ${emailsSkipped} skipped, ${scanned} scanned`,
    );
  } catch (error) {
    console.error('[Retargeting Cron] Error in sendScheduledRetargetingEmails:', error);
  }
}

// Runs daily at 1:00 PM London time.
cron.schedule('0 13 * * *', sendScheduledRetargetingEmails, {
  timezone: 'Europe/London',
});

console.log('[Retargeting Cron] Scheduler running - daily at 13:00 Europe/London');

module.exports = { sendScheduledRetargetingEmails };
