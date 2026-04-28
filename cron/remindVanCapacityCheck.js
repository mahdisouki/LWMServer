const cron = require('node-cron');
const Admin = require('../models/Admin');
const { emitNotificationToUser } = require('../socket');

const NOTIFICATION_TYPE = 'Truck';
const REMINDER_MESSAGE = 'Daily reminder: please check vans capacities.';
const SENDER_NAME = 'System';

async function sendVanCapacityReminderToAdmins() {
  try {
    const admins = await Admin.find({}, '_id');

    if (!admins.length) {
      console.warn('[Van Capacity Reminder] No admins found to notify.');
      return;
    }

    const results = await Promise.allSettled(
      admins.map((admin) =>
        emitNotificationToUser(
          admin._id.toString(),
          NOTIFICATION_TYPE,
          REMINDER_MESSAGE,
          SENDER_NAME,
          { type: NOTIFICATION_TYPE, source: 'van-capacity-daily-reminder' }
        )
      )
    );

    const sentCount = results.filter((result) => result.status === 'fulfilled').length;
    const failedCount = results.length - sentCount;
    console.log(
      `[Van Capacity Reminder] Notification sent to ${sentCount}/${admins.length} admins.${failedCount ? ` Failed: ${failedCount}.` : ''}`
    );
  } catch (error) {
    console.error('[Van Capacity Reminder] Error sending reminder:', error);
  }
}

// Run every day at 12:30 PM (server local time)
cron.schedule('30 12 * * *', sendVanCapacityReminderToAdmins);

console.log('Van capacity reminder scheduler running (12:30 PM daily).');

module.exports = { sendVanCapacityReminderToAdmins };
