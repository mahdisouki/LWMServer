const BlockingDays = require('../models/BlockingDays');
const Task = require('../models/Task');

const ALL_TIME_SLOTS = ['AnyTime', '7am-12pm', '12pm-5pm'];
const MAX_ORDERS_PER_DAY = 200;
const DEFAULT_SUGGESTION_DAYS = 14;

function parseDayBounds(dateInput) {
  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) {
    return null;
  }

  const dayStart = new Date(parsed);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  return {
    dayStart,
    dayEnd,
    dateKey: dayStart.toISOString().slice(0, 10),
  };
}

function getAvailableSlotsFromBlocked(blockedSlots = []) {
  return ALL_TIME_SLOTS.filter((slot) => !blockedSlots.includes(slot));
}

function toDateKey(dateValue) {
  const d = new Date(dateValue);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function getBlockingDayForRange(dayStart, dayEnd) {
  return BlockingDays.findOne({ date: { $gte: dayStart, $lt: dayEnd } }).lean();
}

async function countTasksForDay(dayStart, dayEnd) {
  return Task.countDocuments({
    date: { $gte: dayStart, $lt: dayEnd },
    taskStatus: { $ne: 'Cancelled' },
  });
}

async function getDayAvailability(dayStart, dayEnd) {
  const [blockingDay, taskCount] = await Promise.all([
    getBlockingDayForRange(dayStart, dayEnd),
    countTasksForDay(dayStart, dayEnd),
  ]);

  const blockedTimeSlots = blockingDay?.timeSlots || [];
  const availableTimeSlots = getAvailableSlotsFromBlocked(blockedTimeSlots);

  return {
    blockedTimeSlots,
    availableTimeSlots,
    taskCount,
    isFullyBlocked: availableTimeSlots.length === 0,
    isOverCapacity: taskCount > MAX_ORDERS_PER_DAY,
  };
}

function evaluateAvailability(dayInfo, timeSlot) {
  const { availableTimeSlots, isFullyBlocked, isOverCapacity } = dayInfo;
  const reasons = [];

  if (isFullyBlocked) {
    reasons.push('ALL_TIME_SLOTS_BLOCKED');
  }
  if (isOverCapacity) {
    reasons.push('MAX_ORDERS_REACHED');
  }

  if (timeSlot) {
    if (!ALL_TIME_SLOTS.includes(timeSlot)) {
      return { available: false, reasons: ['INVALID_TIME_SLOT'] };
    }
    if (!availableTimeSlots.includes(timeSlot)) {
      reasons.push('TIME_SLOT_BLOCKED');
    }
  }

  const slotOk = timeSlot
    ? availableTimeSlots.includes(timeSlot)
    : availableTimeSlots.length > 0;
  const available = slotOk && !isOverCapacity;

  return { available, reasons: available ? [] : reasons };
}

async function findSuggestedDays({ fromDayStart, suggestionDays, timeSlot }) {
  const lookStart = new Date(fromDayStart);
  lookStart.setUTCDate(lookStart.getUTCDate() + 1);
  const lookEnd = new Date(lookStart);
  lookEnd.setUTCDate(lookEnd.getUTCDate() + suggestionDays);

  const [blockingDaysInRange, taskCountsAgg] = await Promise.all([
    BlockingDays.find({ date: { $gte: lookStart, $lt: lookEnd } }).lean(),
    Task.aggregate([
      {
        $match: {
          date: { $gte: lookStart, $lt: lookEnd },
          taskStatus: { $ne: 'Cancelled' },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'UTC' },
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const blockingByDate = new Map();
  for (const blockingDay of blockingDaysInRange) {
    blockingByDate.set(toDateKey(blockingDay.date), blockingDay.timeSlots || []);
  }

  const countsByDate = new Map(taskCountsAgg.map((row) => [row._id, row.count]));
  const suggestedDays = [];

  for (let offset = 0; offset < suggestionDays; offset += 1) {
    const candidateStart = new Date(lookStart);
    candidateStart.setUTCDate(candidateStart.getUTCDate() + offset);
    const dateKey = candidateStart.toISOString().slice(0, 10);
    const blockedTimeSlots = blockingByDate.get(dateKey) || [];
    const availableTimeSlots = getAvailableSlotsFromBlocked(blockedTimeSlots);
    const taskCount = countsByDate.get(dateKey) || 0;

    if (availableTimeSlots.length === 0 || taskCount > MAX_ORDERS_PER_DAY) {
      continue;
    }

    const slotsForSuggestion = timeSlot
      ? (availableTimeSlots.includes(timeSlot) ? [timeSlot] : [])
      : availableTimeSlots;

    if (slotsForSuggestion.length === 0) {
      continue;
    }

    suggestedDays.push({
      date: dateKey,
      availableTimeSlots: slotsForSuggestion,
      taskCount,
    });
  }

  return suggestedDays;
}

async function checkAvailability(dateInput, options = {}) {
  const { timeSlot, suggestionDays = DEFAULT_SUGGESTION_DAYS } = options;
  const bounds = parseDayBounds(dateInput);

  if (!bounds) {
    return { error: 'INVALID_DATE' };
  }

  const dayInfo = await getDayAvailability(bounds.dayStart, bounds.dayEnd);
  const { available, reasons } = evaluateAvailability(dayInfo, timeSlot);

  const suggestedDays = available
    ? []
    : await findSuggestedDays({
      fromDayStart: bounds.dayStart,
      suggestionDays,
      timeSlot,
    });

  return {
    date: bounds.dateKey,
    available,
    taskCount: dayInfo.taskCount,
    maxOrdersPerDay: MAX_ORDERS_PER_DAY,
    availableTimeSlots: dayInfo.availableTimeSlots,
    blockedTimeSlots: dayInfo.blockedTimeSlots,
    reasons,
    suggestedDays,
  };
}

module.exports = {
  ALL_TIME_SLOTS,
  MAX_ORDERS_PER_DAY,
  DEFAULT_SUGGESTION_DAYS,
  checkAvailability,
};
