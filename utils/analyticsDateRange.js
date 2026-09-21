const ANALYTICS_TIMEZONE = process.env.GA4_TIMEZONE || 'Europe/London';

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dayKeyInTimeZone(date, timeZone = ANALYTICS_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Some engines report midnight as hour "24"
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

/** Convert a wall-clock time on a calendar day in `timeZone` to a UTC Date. */
function zonedWallTimeToUtc(dayKey, hours, minutes, seconds, ms, timeZone = ANALYTICS_TIMEZONE) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hours, minutes, seconds, ms);
  let instant = new Date(utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timeZone));
  // Recompute once so DST transition days land on the correct offset
  instant = new Date(utcGuess - getTimeZoneOffsetMs(instant, timeZone));
  return instant;
}

function startOfLabeledDay(dayKey) {
  if (!ISO_DATE_ONLY.test(dayKey)) {
    throw new Error(`Invalid date label: ${dayKey}`);
  }
  return zonedWallTimeToUtc(dayKey, 0, 0, 0, 0, ANALYTICS_TIMEZONE);
}

function endOfLabeledDay(dayKey) {
  if (!ISO_DATE_ONLY.test(dayKey)) {
    throw new Error(`Invalid date label: ${dayKey}`);
  }
  // Next local midnight minus 1ms — avoids Intl second/ms rounding issues
  return new Date(startOfLabeledDay(addDaysToDayKey(dayKey, 1)).getTime() - 1);
}

function addDaysToDayKey(dayKey, days) {
  if (!ISO_DATE_ONLY.test(dayKey)) {
    throw new Error(`Invalid date label: ${dayKey}`);
  }
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function startOfTimeZoneDay(date, timeZone = ANALYTICS_TIMEZONE) {
  return zonedWallTimeToUtc(dayKeyInTimeZone(date, timeZone), 0, 0, 0, 0, timeZone);
}

function endOfTimeZoneDay(date, timeZone = ANALYTICS_TIMEZONE) {
  const dayKey = dayKeyInTimeZone(date, timeZone);
  const nextMidnight = zonedWallTimeToUtc(addDaysToDayKey(dayKey, 1), 0, 0, 0, 0, timeZone);
  return new Date(nextMidnight.getTime() - 1);
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

  // Full ISO timestamps (same as Quotations module) are used as exact instants
  return parsed;
}

function daysBetweenInclusive(startKey, endKey) {
  const [startYear, startMonth, startDay] = startKey.split('-').map(Number);
  const [endYear, endMonth, endDay] = endKey.split('-').map(Number);
  const ms =
    Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay);
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
  addDaysToDayKey,
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
