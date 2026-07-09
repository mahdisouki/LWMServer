const ANALYTICS_TIMEZONE = process.env.CLARITY_CRON_TIMEZONE || 'Europe/London';

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dayKeyInTimeZone(date, timeZone = ANALYTICS_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function startOfLabeledDay(dayKey) {
  if (!ISO_DATE_ONLY.test(dayKey)) {
    throw new Error(`Invalid date label: ${dayKey}`);
  }
  return new Date(`${dayKey}T00:00:00.000Z`);
}

function endOfLabeledDay(dayKey) {
  if (!ISO_DATE_ONLY.test(dayKey)) {
    throw new Error(`Invalid date label: ${dayKey}`);
  }
  return new Date(`${dayKey}T23:59:59.999Z`);
}

function addDaysToDayKey(dayKey, days) {
  const date = startOfLabeledDay(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfTimeZoneDay(date, timeZone = ANALYTICS_TIMEZONE) {
  return startOfLabeledDay(dayKeyInTimeZone(date, timeZone));
}

function endOfTimeZoneDay(date, timeZone = ANALYTICS_TIMEZONE) {
  return endOfLabeledDay(dayKeyInTimeZone(date, timeZone));
}

function toDateString(date) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid date');
  }
  return dayKeyInTimeZone(parsed, ANALYTICS_TIMEZONE);
}

function parseDateInput(value, endOfDay = false) {
  if (ISO_DATE_ONLY.test(value)) {
    return endOfDay ? endOfLabeledDay(value) : startOfLabeledDay(value);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }

  return endOfDay ? endOfTimeZoneDay(parsed) : startOfTimeZoneDay(parsed);
}

function daysBetweenInclusive(startKey, endKey) {
  const ms = startOfLabeledDay(endKey).getTime() - startOfLabeledDay(startKey).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

function resolvePeriod({ preset, startDate, endDate } = {}) {
  if (startDate && endDate) {
    const start = parseDateInput(startDate, false);
    const end = parseDateInput(endDate, true);
    if (start > end) {
      throw new Error('startDate must be before or equal to endDate');
    }

    const startKey = ISO_DATE_ONLY.test(startDate)
      ? startDate
      : dayKeyInTimeZone(start, ANALYTICS_TIMEZONE);
    const endKey = ISO_DATE_ONLY.test(endDate)
      ? endDate
      : dayKeyInTimeZone(end, ANALYTICS_TIMEZONE);

    return { start, end, startKey, endKey, preset: 'custom' };
  }

  const daysMap = { today: 1, '7d': 7, '30d': 30, '90d': 90 };
  const key = preset || '30d';
  const days = daysMap[key];
  if (!days) {
    throw new Error('preset must be one of: today, 7d, 30d, 90d');
  }

  const endDayKey = dayKeyInTimeZone(new Date(), ANALYTICS_TIMEZONE);
  const startDayKey = addDaysToDayKey(endDayKey, -(days - 1));

  return {
    start: startOfLabeledDay(startDayKey),
    end: endOfLabeledDay(endDayKey),
    startKey: startDayKey,
    endKey: endDayKey,
    preset: key,
  };
}

function getPreviousPeriod(start, end, { startKey, endKey } = {}) {
  const rangeStartKey = startKey || start.toISOString().slice(0, 10);
  const rangeEndKey = endKey || end.toISOString().slice(0, 10);
  const dayCount = daysBetweenInclusive(rangeStartKey, rangeEndKey);
  const prevEndKey = addDaysToDayKey(rangeStartKey, -1);
  const prevStartKey = addDaysToDayKey(prevEndKey, -(dayCount - 1));

  return {
    start: startOfLabeledDay(prevStartKey),
    end: endOfLabeledDay(prevEndKey),
    startKey: prevStartKey,
    endKey: prevEndKey,
  };
}

function getPeriodLabels(period) {
  return {
    startDate: period.startKey || toDateString(period.start),
    endDate: period.endKey || toDateString(period.end),
  };
}

function eachDayKeyInPeriod(start, end, { startKey, endKey } = {}) {
  const keys = [];
  const endLabel = endKey || start.toISOString().slice(0, 10);
  let cursor = startKey || start.toISOString().slice(0, 10);

  while (cursor <= endLabel) {
    keys.push(cursor);
    if (cursor === endLabel) {
      break;
    }
    cursor = addDaysToDayKey(cursor, 1);
  }

  return keys;
}

module.exports = {
  ANALYTICS_TIMEZONE,
  dayKeyInTimeZone,
  startOfLabeledDay,
  endOfLabeledDay,
  startOfTimeZoneDay,
  endOfTimeZoneDay,
  toDateString,
  parseDateInput,
  resolvePeriod,
  getPreviousPeriod,
  getPeriodLabels,
  eachDayKeyInPeriod,
};
