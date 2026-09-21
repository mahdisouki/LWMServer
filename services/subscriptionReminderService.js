const Subscription = require('../models/Subscription');
const { emitNotificationToUser } = require('../socket');
const { sendSubscriptionReminderEmail } = require('../utils/sendSubscriptionReminderEmail');

function startOfUtcDay(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addMonthsUtc(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

function advanceRenewalDate(nextRenewalDate, billingFrequency) {
  if (!nextRenewalDate) return null;
  if (billingFrequency === 'Monthly') return addMonthsUtc(nextRenewalDate, 1);
  if (billingFrequency === 'Yearly') return addMonthsUtc(nextRenewalDate, 12);
  return nextRenewalDate;
}

function adminDisplayName(admin) {
  if (!admin) return 'there';
  const full = [admin.firstName, admin.lastName].filter(Boolean).join(' ').trim();
  return full || admin.username || 'there';
}

/**
 * Daily reminder pass:
 * - Active + Monthly/Yearly + nextRenewalDate + reminderAdminId
 * - Send once when today >= (nextRenewalDate - remindDaysBefore)
 * - After renewal day has passed, advance nextRenewalDate for the next cycle
 */
async function processSubscriptionReminders(now = new Date()) {
  const today = startOfUtcDay(now);
  const summary = {
    checked: 0,
    reminded: 0,
    advanced: 0,
    skipped: 0,
    errors: [],
  };

  const subscriptions = await Subscription.find({
    status: 'Active',
    billingFrequency: { $in: ['Monthly', 'Yearly'] },
    nextRenewalDate: { $ne: null },
    reminderAdminId: { $ne: null },
  }).populate('reminderAdminId', 'username email firstName lastName officialEmail');

  summary.checked = subscriptions.length;

  for (const sub of subscriptions) {
    try {
      const renewalDay = startOfUtcDay(sub.nextRenewalDate);
      const remindDays = Number(sub.remindDaysBefore) || 0;
      const remindOn = new Date(renewalDay);
      remindOn.setUTCDate(remindOn.getUTCDate() - remindDays);

      const alreadySentThisCycle =
        sub.lastReminderSentAt &&
        startOfUtcDay(sub.lastReminderSentAt).getTime() >= remindOn.getTime();

      if (today.getTime() >= remindOn.getTime() && !alreadySentThisCycle) {
        const admin = sub.reminderAdminId;
        const message = `Subscription "${sub.name}" renews on ${renewalDay.toISOString().slice(0, 10)} (${sub.billingFrequency}).`;

        if (admin?._id) {
          await emitNotificationToUser(
            admin._id.toString(),
            'Subscriptions',
            message,
            'System',
            {
              type: 'Subscriptions',
              subscriptionId: sub._id.toString(),
              nextRenewalDate: sub.nextRenewalDate,
            },
          );

          const emailTo = admin.officialEmail || admin.email;
          if (emailTo) {
            await sendSubscriptionReminderEmail({
              to: emailTo,
              adminName: adminDisplayName(admin),
              subscription: sub,
            });
          }
        }

        sub.lastReminderSentAt = now;
        summary.reminded += 1;
      } else {
        summary.skipped += 1;
      }

      // Advance after the renewal day has passed so the UI keeps showing the real upcoming date
      if (today.getTime() > renewalDay.getTime()) {
        const advanced = advanceRenewalDate(sub.nextRenewalDate, sub.billingFrequency);
        if (advanced && advanced.getTime() !== sub.nextRenewalDate.getTime()) {
          sub.nextRenewalDate = advanced;
          summary.advanced += 1;
        }
      }

      await sub.save();
    } catch (error) {
      summary.errors.push({
        id: sub._id?.toString?.(),
        name: sub.name,
        error: error.message,
      });
    }
  }

  return summary;
}

module.exports = {
  processSubscriptionReminders,
  advanceRenewalDate,
  startOfUtcDay,
};
