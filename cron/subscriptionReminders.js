const cron = require('node-cron');
const { processSubscriptionReminders } = require('../services/subscriptionReminderService');

async function runSubscriptionReminders() {
  try {
    const summary = await processSubscriptionReminders();
    console.log('[Subscription Reminders] Completed:', JSON.stringify(summary));
  } catch (error) {
    console.error('[Subscription Reminders] Error:', error);
  }
}

// Daily at 09:00 server local time
cron.schedule('0 9 * * *', runSubscriptionReminders);

console.log('Subscription reminder scheduler running (09:00 daily).');

module.exports = { runSubscriptionReminders };
