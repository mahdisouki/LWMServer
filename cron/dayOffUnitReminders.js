const cron = require('node-cron');
const { processDayOffUnitReminders } = require('../services/dayOffUnitReminderService');

async function runDayOffUnitReminders() {
  try {
    const summary = await processDayOffUnitReminders();
    console.log('[Day Off Unit Reminder] Completed:', JSON.stringify(summary));
  } catch (error) {
    console.error('[Day Off Unit Reminder] Error:', error);
  }
}

// Daily at 10:00 AM server local time
cron.schedule('00 10 * * *', runDayOffUnitReminders);

console.log(
  'Day off unit reminder scheduler running (10:00 daily; ~7d, ~2d, ~1d before leave by calendar day, with catch-up).',
);

module.exports = { runDayOffUnitReminders };
