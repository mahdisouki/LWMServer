const Dayoff = require('../models/Dayoff');
const Admin = require('../models/Admin');
const Truck = require('../models/Truck');
const UnitAssignmentLogRange = require('../models/UnitAssignmentLogRange');
const { User } = require('../models/User');
const { emitNotificationToUser } = require('../socket');
const { getDayBounds } = require('./unitAssignmentLogService');

const NOTIFICATION_TYPE = 'Unit_Management';
const SENDER_NAME = 'System';

/** First reminder in (2,7] days before start; then (1,2]; then [0,1]. Catches up if a day was missed. */
const REMINDER_TIERS = [
  { flagKey: 'sevenDays', maxDaysUntil: 7, minDaysUntil: 2 },
  { flagKey: 'twoDays', maxDaysUntil: 2, minDaysUntil: 1 },
  { flagKey: 'oneDay', maxDaysUntil: 1, minDaysUntil: -1 },
];

const PERMISSION_KEYS = ['Truck', 'Staff', 'Day_Off'];

function startOfLocalDay(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from today (local) until leave start; ignores time-of-day on stored dates. */
function getCalendarDaysUntilStart(startDate, fromDate = new Date()) {
  const start = startOfLocalDay(startDate);
  const from = startOfLocalDay(fromDate);
  return Math.round((start - from) / 86400000);
}

function tierApplies(daysUntil, { maxDaysUntil, minDaysUntil }) {
  return daysUntil <= maxDaysUntil && daysUntil > minDaysUntil;
}

function formatDateRange(startDate, endDate) {
  const startFormatted = new Date(startDate).toLocaleDateString();
  const endFormatted = new Date(endDate).toLocaleDateString();
  return startFormatted === endFormatted
    ? startFormatted
    : `${startFormatted} to ${endFormatted}`;
}

function getUserDisplayName(user) {
  if (!user) return 'Staff member';
  return (
    user.username ||
    `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
    'Staff member'
  );
}

function adminCanReceiveUnitDayOffReminders(admin) {
  return PERMISSION_KEYS.some((key) => {
    const perms = admin.permissions?.[key];
    return Array.isArray(perms) && (perms.includes('View') || perms.includes('Edit'));
  });
}

async function getAdminRecipientIds() {
  const admins = await Admin.find({}).select('_id permissions').lean();
  const filtered = admins.filter(adminCanReceiveUnitDayOffReminders);
  const list = filtered.length > 0 ? filtered : admins;
  return list.map((a) => a._id.toString());
}

async function getUnitNamesForUserDuringLeave(userId, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const truckIdSet = new Set();

  while (cursor <= last) {
    const { startOfDay, endOfDay } = getDayBounds(cursor);
    const ranges = await UnitAssignmentLogRange.find({
      refId: userId,
      type: { $in: ['driver', 'helper'] },
      startAt: { $lte: endOfDay },
      $or: [{ endAt: null }, { endAt: { $gte: startOfDay } }],
    })
      .select('truckId')
      .lean();

    for (const range of ranges) {
      truckIdSet.add(range.truckId.toString());
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (truckIdSet.size === 0) {
    return [];
  }

  const trucks = await Truck.find({ _id: { $in: [...truckIdSet] } })
    .select('name')
    .lean();
  return trucks.map((t) => t.name || 'Unit').filter(Boolean);
}

function buildUnitAssignmentSuffix(unitNames) {
  if (!unitNames.length) {
    return ' No current unit assignment on those dates.';
  }
  const list = unitNames.join(', ');
  const noun = unitNames.length === 1 ? 'unit' : 'units';
  return ` Still assigned to ${noun}: ${list}. Please review unit assignments.`;
}

function buildReminderMessage({ userName, dateRange, daysUntil, unitNames }) {
  const prefix =
    daysUntil === 0
      ? 'Reminder (today)'
      : daysUntil === 1
        ? 'Reminder (1 day)'
        : `Reminder (${daysUntil} days)`;
  return `${prefix}: ${userName} is off ${dateRange}.${buildUnitAssignmentSuffix(unitNames)}`;
}

async function notifyAdmins(message, metadata) {
  const adminIds = await getAdminRecipientIds();
  if (!adminIds.length) {
    console.warn('[Day Off Unit Reminder] No admin recipients found.');
    return 0;
  }

  const results = await Promise.allSettled(
    adminIds.map((adminId) =>
      emitNotificationToUser(adminId, NOTIFICATION_TYPE, message, SENDER_NAME, metadata),
    ),
  );
  return results.filter((r) => r.status === 'fulfilled').length;
}

async function buildContextForDayOff(dayOff) {
  const user = await User.findById(dayOff.userId)
    .select('username firstName lastName')
    .lean();
  const userName = getUserDisplayName(user);
  const dateRange = formatDateRange(dayOff.startDate, dayOff.endDate);
  const unitNames = await getUnitNamesForUserDuringLeave(
    dayOff.userId,
    dayOff.startDate,
    dayOff.endDate,
  );
  return { userName, dateRange, unitNames };
}

async function processDayOffUnitReminders() {
  const todayStart = startOfLocalDay(new Date());
  const dayOffs = await Dayoff.find({
    status: 'Approved',
    startDate: { $gte: todayStart },
  }).lean();

  const summary = {
    sevenDays: { candidates: 0, processed: 0 },
    twoDays: { candidates: 0, processed: 0 },
    oneDay: { candidates: 0, processed: 0 },
  };

  for (const dayOff of dayOffs) {
    const daysUntil = getCalendarDaysUntilStart(dayOff.startDate);
    if (daysUntil > 7) continue;

    for (const tier of REMINDER_TIERS) {
      if (!tierApplies(daysUntil, tier)) continue;

      const flagPath = `remindersSent.${tier.flagKey}`;
      if (dayOff.remindersSent?.[tier.flagKey]) continue;

      summary[tier.flagKey].candidates += 1;
      try {
        const { userName, dateRange, unitNames } = await buildContextForDayOff(dayOff);
        const message = buildReminderMessage({
          userName,
          dateRange,
          daysUntil,
          unitNames,
        });
        const adminsNotified = await notifyAdmins(message, {
          type: NOTIFICATION_TYPE,
          source: 'day-off-unit-reminder',
          dayOffId: dayOff._id.toString(),
          daysUntil,
          tier: tier.flagKey,
        });
        await Dayoff.findByIdAndUpdate(dayOff._id, { $set: { [flagPath]: true } });
        dayOff.remindersSent = { ...dayOff.remindersSent, [tier.flagKey]: true };
        summary[tier.flagKey].processed += 1;
        console.log(
          `[Day Off Unit Reminder] ${tier.flagKey} (${daysUntil}d until start) for ${dayOff._id}: ${adminsNotified} admin(s)`,
        );
      } catch (error) {
        console.error(
          `[Day Off Unit Reminder] Failed ${tier.flagKey} for ${dayOff._id}:`,
          error,
        );
      }
    }
  }

  return summary;
}

module.exports = {
  processDayOffUnitReminders,
};
