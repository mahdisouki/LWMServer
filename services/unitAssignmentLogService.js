const UnitAssignmentLog = require('../models/UnitAssignmentLog');
const UnitAssignmentLogRange = require('../models/UnitAssignmentLogRange');
const Truck = require('../models/Truck');

/**
 * Create a unit assignment log entry and push it onto the truck's assignmentLogs.
 * Also creates/updates UnitAssignmentLogRange: assigned = new range (startAt, no endAt); deassigned = close latest open range.
 */
async function logUnitAssignment({ truckId, type, refId, event, by, note, startAt, endAt }) {
  const now = new Date();
  const doc = {
    truckId,
    type,
    refId,
    event,
    by: by || undefined,
    note: note || undefined,
  };
  if (event === 'assigned') {
    doc.startAt = startAt || now;
  } else {
    doc.endAt = endAt || now;
  }
  const log = await UnitAssignmentLog.create(doc);
  const at = doc.startAt || doc.endAt || now;
  await Truck.findByIdAndUpdate(truckId, {
    $push: { assignmentLogs: { logId: log._id, at } },
  });

  // Keep UnitAssignmentLogRange in sync: one range per continuous assignment (start → end).
  if (event === 'assigned') {
    await UnitAssignmentLogRange.create({
      truckId,
      type,
      refId,
      startAt: doc.startAt,
      endAt: null,
      by: doc.by,
      note: doc.note,
    });
  } else {
    const rangeEnd = doc.endAt || now;
    await UnitAssignmentLogRange.findOneAndUpdate(
      { truckId, type, refId, endAt: null },
      { $set: { endAt: rangeEnd } },
      { sort: { startAt: -1 } }
    );
  }
}

/**
 * Get start and end of day in UTC for a given date (Date or YYYY-MM-DD string).
 */
function getDayBounds(date) {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00.000Z') : new Date(date);
  const startOfDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return { startOfDay, endOfDay };
}

/**
 * Who was on unit X on day D? Returns events overlapping the day and a summary of unique refIds per type.
 */
async function getAssignmentsForUnitOnDay(unitId, date) {
  const { startOfDay, endOfDay } = getDayBounds(date);
  const logs = await UnitAssignmentLog.find({
    truckId: unitId,
    $or: [
      { startAt: { $lte: endOfDay } },
      { endAt: { $gte: startOfDay } },
    ],
  })
    .sort({ createdAt: 1 })
    .lean();

  const summary = { van: [], driver: [], helper: [] };
  const seen = { van: new Set(), driver: new Set(), helper: new Set() };
  const events = logs.map((log) => ({
    type: log.type,
    refId: log.refId,
    event: log.event,
    startAt: log.startAt,
    endAt: log.endAt,
    createdAt: log.createdAt,
  }));

  for (const log of logs) {
    const refStr = log.refId.toString();
    if (!seen[log.type].has(refStr)) {
      seen[log.type].add(refStr);
      summary[log.type].push(log.refId);
    }
  }

  return { date: startOfDay, startOfDay, endOfDay, events, summary };
}

/**
 * Who was assigned to truck on the given day (from UnitAssignmentLogRange)?
 * Returns { vanId, driverId, helperId } — the refId for each type that had a range overlapping the day.
 * Picks the range with latest startAt that still overlaps the day (most recent assignment active that day).
 */
async function getAssignedForDayFromRanges(truckId, date) {
  const { startOfDay, endOfDay } = getDayBounds(date);
  const result = { vanId: null, driverId: null, helperId: null };

  for (const type of ['van', 'driver', 'helper']) {
    const range = await UnitAssignmentLogRange.findOne({
      truckId,
      type,
      startAt: { $lte: endOfDay },
      $or: [{ endAt: null }, { endAt: { $gte: startOfDay } }],
    })
      .sort({ startAt: -1 })
      .lean();
    if (range) {
      const key = type === 'van' ? 'vanId' : type === 'driver' ? 'driverId' : 'helperId';
      result[key] = range.refId;
    }
  }
  return result;
}

/**
 * Who was on unit X at date/time T? Returns { vanId, driverId, helperId } (or null for each).
 */
async function getAssignmentAtTime(unitId, dateTime) {
  const T = dateTime instanceof Date ? dateTime : new Date(dateTime);
  const result = { vanId: null, driverId: null, helperId: null };

  for (const type of ['van', 'driver', 'helper']) {
    const assigned = await UnitAssignmentLog.findOne({
      truckId: unitId,
      type,
      event: 'assigned',
      startAt: { $lte: T },
    })
      .sort({ startAt: -1 })
      .lean();

    if (!assigned) continue;

    const deassigned = await UnitAssignmentLog.findOne({
      truckId: unitId,
      type,
      refId: assigned.refId,
      event: 'deassigned',
    })
      .sort({ endAt: -1 })
      .lean();

    if (!deassigned || deassigned.endAt > T) {
      result[type === 'van' ? 'vanId' : type === 'driver' ? 'driverId' : 'helperId'] = assigned.refId;
    }
  }

  return result;
}

module.exports = { logUnitAssignment, getAssignmentsForUnitOnDay, getAssignedForDayFromRanges, getAssignmentAtTime };
