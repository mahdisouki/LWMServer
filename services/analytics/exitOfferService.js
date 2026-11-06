const BookingHold = require('../../models/BookingHold');
const ExitOfferView = require('../../models/ExitOfferView');
const Task = require('../../models/Task');
const {
  resolvePeriod,
  getPeriodLabels,
  eachDayKeyInPeriod,
  dayKeyInTimeZone,
} = require('../../utils/analyticsDateRange');

const HOLD_FIELDS = 'ip device createdAt usedAt taskId';
const TASK_FIELDS = 'customDiscountPercent discountSource paymentStatus bookingDiscountValue';

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function deviceKey(device) {
  return device === 'mobile' || device === 'desktop' ? device : 'unknown';
}

function emptyDevices() {
  return { total: 0, mobile: 0, desktop: 0, unknown: 0 };
}

function emptyMoney() {
  return { people: 0, value: 0 };
}

function emptyUsed() {
  return {
    people: 0,
    value: 0,
    mobile: emptyMoney(),
    desktop: emptyMoney(),
    unknown: emptyMoney(),
  };
}

function emptyDay() {
  return {
    sawPopup: emptyDevices(),
    received: emptyDevices(),
    unused: emptyDevices(),
    used10: emptyMoney(),
    used20: emptyMoney(),
    used: emptyUsed(),
    unvalued: 0,
  };
}

function addDevice(bucket, device) {
  bucket[deviceKey(device)] += 1;
  bucket.total += 1;
}

function addUse(bucket, device, value) {
  const key = deviceKey(device);
  bucket.people += 1;
  bucket[key].people += 1;
  if (value == null) return;
  const amount = roundMoney(value);
  bucket.value = roundMoney(bucket.value + amount);
  bucket[key].value = roundMoney(bucket[key].value + amount);
}

function savedDiscountValue(task) {
  if (task?.bookingDiscountValue == null) return null;
  const value = Number(task.bookingDiscountValue);
  if (!Number.isFinite(value) || value < 0) return null;
  return roundMoney(value);
}

function appliedPercent(task) {
  const percent = Number(task?.customDiscountPercent);
  if (percent === 10 || percent === 20) return percent;
  return 0;
}

function isSuccessfulUse(hold, task) {
  if (!hold.usedAt || !task) return false;
  if (task.discountSource !== 'booking-hold') return false;
  if (task.paymentStatus === 'Failed') return false;
  const percent = appliedPercent(task);
  return percent === 10 || percent === 20;
}

function rememberVisitor(store, ip, device) {
  if (!ip || store.has(ip)) return;
  store.set(ip, deviceKey(device));
}

function countVisitors(store) {
  const bucket = emptyDevices();
  for (const device of store.values()) addDevice(bucket, device);
  return bucket;
}

async function getExitOfferAnalytics({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });
  const dayKeys = eachDayKeyInPeriod(period.start, period.end, period);
  const daySet = new Set(dayKeys);

  const [views, createdHolds, usedHolds] = await Promise.all([
    ExitOfferView.find({ createdAt: { $gte: period.start, $lte: period.end } })
      .select('ip device createdAt')
      .lean(),
    BookingHold.find({ createdAt: { $gte: period.start, $lte: period.end } })
      .select(HOLD_FIELDS)
      .lean(),
    BookingHold.find({ usedAt: { $gte: period.start, $lte: period.end } })
      .select(HOLD_FIELDS)
      .lean(),
  ]);

  const holdsById = new Map();
  for (const hold of [...createdHolds, ...usedHolds]) {
    holdsById.set(String(hold._id), hold);
  }

  const taskIds = [...holdsById.values()].map((hold) => hold.taskId).filter(Boolean);
  const tasks = taskIds.length
    ? await Task.find({ _id: { $in: taskIds } }).select(TASK_FIELDS).lean()
    : [];
  const taskById = new Map(tasks.map((task) => [String(task._id), task]));

  const days = new Map(dayKeys.map((key) => [key, emptyDay()]));
  const summaryVisitors = new Map();
  const visitorsByDay = new Map(dayKeys.map((key) => [key, new Map()]));

  for (const view of views) {
    const day = dayKeyInTimeZone(new Date(view.createdAt));
    if (!daySet.has(day)) continue;
    rememberVisitor(summaryVisitors, view.ip, view.device);
    rememberVisitor(visitorsByDay.get(day), view.ip, view.device);
  }

  const summary = {
    sawPopup: countVisitors(summaryVisitors),
    received: emptyDevices(),
    unused: emptyDevices(),
    used10: emptyMoney(),
    used20: emptyMoney(),
    used: emptyUsed(),
    unvalued: 0,
  };

  for (const [day, visitors] of visitorsByDay) {
    days.get(day).sawPopup = countVisitors(visitors);
  }

  const createdIds = new Set(createdHolds.map((hold) => String(hold._id)));

  for (const hold of holdsById.values()) {
    const task = hold.taskId ? taskById.get(String(hold.taskId)) : null;
    const successful = isSuccessfulUse(hold, task);
    const createdDay = dayKeyInTimeZone(new Date(hold.createdAt));
    const inCreated = createdIds.has(String(hold._id)) && daySet.has(createdDay);

    if (inCreated) {
      addDevice(summary.received, hold.device);
      addDevice(days.get(createdDay).received, hold.device);
      if (!successful) {
        addDevice(summary.unused, hold.device);
        addDevice(days.get(createdDay).unused, hold.device);
      }
    }

    if (!successful || !hold.usedAt) continue;
    const usedDay = dayKeyInTimeZone(new Date(hold.usedAt));
    if (!daySet.has(usedDay)) continue;

    const percent = appliedPercent(task);
    const value = savedDiscountValue(task);
    const day = days.get(usedDay);
    addUse(summary.used, hold.device, value);
    addUse(day.used, hold.device, value);
    const tier = percent === 20 ? 'used20' : 'used10';
    summary[tier].people += 1;
    day[tier].people += 1;
    if (value == null) {
      summary.unvalued += 1;
      day.unvalued += 1;
    } else {
      summary[tier].value = roundMoney(summary[tier].value + value);
      day[tier].value = roundMoney(day[tier].value + value);
    }
  }

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    summary,
    daily: dayKeys.map((date) => ({ date, ...days.get(date) })),
  };
}

module.exports = {
  getExitOfferAnalytics,
};
