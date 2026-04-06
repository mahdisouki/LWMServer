const cron = require('node-cron');
const Task = require('../models/Task');
const {
  sendRetargetingEmailForTask,
  hasAnyNonFailedTaskForEmail,
} = require('../services/retargetingService');

async function sendScheduledRetargetingEmails() {
  try {
    const tasksToProcess = await Task.find({
      createdByType: 'public',
      paymentStatus: 'Failed',
      retargetingEmailSent: { $ne: true },
      repeatCustomer: 0,
      email: { $exists: true, $nin: [null, ''] },
    }).sort({ createdAt: 1 });

    console.log(`[Retargeting Cron] Found ${tasksToProcess.length} failed task(s) to process`);

    let emailsSent = 0;
    let emailsSkipped = 0;
    const processedEmails = new Set();

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

    console.log(
      `[Retargeting Cron] Completed: ${emailsSent} email(s) sent, ${emailsSkipped} skipped`,
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
