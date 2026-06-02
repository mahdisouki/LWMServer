const Payroll = require('../models/Payroll');
const Truck = require('../models/Truck');
const Van = require('../models/Van');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const DriverHelperProximityState = require('../models/DriverHelperProximityState');
const pcnDamageController = require('../controllers/pcnDamageController');
const { recalculatePayrollExpenses } = require('../controllers/expenseController');
const { getAssignedForDayFromRanges } = require('./unitAssignmentLogService');

function getTodayDateKeyLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDayBounds(dateKey = getTodayDateKeyLocal()) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
  const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { startOfDay, endOfDay };
}

function idsMatch(a, b) {
  return a && b && a.toString() === b.toString();
}

async function getEffectiveHelperId(truck, dateKey) {
  if (!truck) return null;
  const assigned = await getAssignedForDayFromRanges(truck._id, dateKey);
  return assigned?.helperId || truck.helperId || null;
}

async function getTruckTeamForUser(userId, dateKey = getTodayDateKeyLocal()) {
  let truck =
    (await Truck.findOne({ driverId: userId }).select('_id driverId helperId')) ||
    (await Truck.findOne({ helperId: userId }).select('_id driverId helperId')) ||
    (await Truck.findOne({ 'extraDrivers.driverId': userId }).select(
      '_id driverId helperId'
    )) ||
    (await Truck.findOne({ 'extraHelpers.helperId': userId }).select(
      '_id driverId helperId'
    ));

  if (!truck) {
    return { truck: null, driverId: null, effectiveHelperId: null };
  }

  const effectiveHelperId = await getEffectiveHelperId(truck, dateKey);
  return {
    truck,
    driverId: truck.driverId,
    effectiveHelperId,
  };
}

function isPairedDriverHelperTeam({ truck, driverId, effectiveHelperId }) {
  return Boolean(truck && driverId && effectiveHelperId);
}

function getUserTeamRole(userId, driverId, effectiveHelperId) {
  if (idsMatch(userId, driverId)) return 'driver';
  if (idsMatch(userId, effectiveHelperId)) return 'helper';
  return null;
}

/** @deprecated use getTruckTeamForUser */
async function driverHasHelperToday(driverId, dateKey = getTodayDateKeyLocal()) {
  const team = await getTruckTeamForUser(driverId, dateKey);
  return {
    truck: team.truck,
    effectiveHelperId: team.effectiveHelperId,
  };
}

async function getOrCreateProximityState(truck, dateKey, effectiveHelperId) {
  const state =
    (await DriverHelperProximityState.findOne({
      truckId: truck._id,
      dateKey,
    })) ||
    new DriverHelperProximityState({
      truckId: truck._id,
      dateKey,
      driverId: truck.driverId,
      helperId: effectiveHelperId || truck.driverId,
      milestonesReached: [],
    });

  state.driverId = truck.driverId;
  state.helperId = effectiveHelperId || truck.driverId;
  return state;
}

function getShiftPendingStatusForUser(state, userId, driverId, effectiveHelperId, activePayroll) {
  const role = getUserTeamRole(userId, driverId, effectiveHelperId);
  if (role === 'helper') {
    const pendingArrival = Boolean(
      state?.helperShiftStartRequestedAt &&
        !state?.helperShiftAutoStartedAt &&
        !activePayroll
    );
    return {
      role,
      pendingArrival,
      shiftStartRequestedAt: state?.helperShiftStartRequestedAt || null,
      shiftAutoStartedAt: state?.helperShiftAutoStartedAt || null,
      waitingForDriverArrival: pendingArrival,
    };
  }

  const pendingArrival = Boolean(
    state?.shiftStartRequestedAt && !state?.shiftAutoStartedAt && !activePayroll
  );
  return {
    role: role || 'driver',
    pendingArrival,
    shiftStartRequestedAt: state?.shiftStartRequestedAt || null,
    shiftAutoStartedAt: state?.shiftAutoStartedAt || null,
    waitingForDriverArrival: pendingArrival,
  };
}

function hasPendingShiftStart(state) {
  const driverPending =
    state?.shiftStartRequestedAt && !state?.shiftAutoStartedAt;
  const helperPending =
    state?.helperShiftStartRequestedAt && !state?.helperShiftAutoStartedAt;
  return Boolean(driverPending || helperPending);
}

async function findActivePayrollForDay(userId, dateKey = getTodayDateKeyLocal()) {
  const { startOfDay, endOfDay } = getDayBounds(dateKey);
  return Payroll.findOne({
    userId,
    startTime: { $gte: startOfDay, $lte: endOfDay },
    endTime: null,
  });
}

/** Today's payroll with both start and end (shift already finished). */
async function findCompletedPayrollForDay(userId, dateKey = getTodayDateKeyLocal()) {
  const { startOfDay, endOfDay } = getDayBounds(dateKey);
  return Payroll.findOne({
    userId,
    startTime: { $gte: startOfDay, $lte: endOfDay },
    endTime: { $exists: true, $ne: null },
  }).sort({ startTime: -1 });
}

/** Van registration (matricule) for the unit on this calendar day. */
async function resolveVanRegForTruck(truckId, dateKey = getTodayDateKeyLocal()) {
  if (!truckId) return undefined;

  const assigned = await getAssignedForDayFromRanges(truckId, dateKey);
  let vanId = assigned?.vanId || null;
  if (!vanId) {
    const truck = await Truck.findById(truckId).select('vanId').lean();
    vanId = truck?.vanId || null;
  }
  if (!vanId) return undefined;

  const van = await Van.findById(vanId).select('matricule name').lean();
  const reg = van?.matricule || van?.name;
  return reg ? String(reg).trim() : undefined;
}

async function createShiftPayroll(userId, startTime = new Date(), options = {}) {
  const dateKey = options.dateKey || getTodayDateKeyLocal();
  const completedToday = await findCompletedPayrollForDay(userId, dateKey);
  if (completedToday) {
    return {
      ok: false,
      status: 400,
      message: 'You Already start a shift today',
      payroll: completedToday,
      shiftCompleted: true,
    };
  }

  const existing = await Payroll.findOne({ userId, endTime: null });
  if (existing) {
    return {
      ok: false,
      status: 400,
      message: 'You have already started work for the day.',
      payroll: existing,
    };
  }

  let truck = options.truck || null;
  if (!truck && options.truckId) {
    truck = await Truck.findById(options.truckId).select('_id driverId helperId vanId');
  }
  if (!truck) {
    truck =
      (await Truck.findOne({ driverId: userId })) ||
      (await Truck.findOne({ helperId: userId }));
  }

  const vanReg =
    options.vanReg !== undefined && options.vanReg !== null && String(options.vanReg).trim()
      ? String(options.vanReg).trim()
      : truck?._id
        ? await resolveVanRegForTruck(truck._id, dateKey)
        : undefined;

  const newPayroll = new Payroll({
    userId,
    startTime: new Date(startTime),
    truckId: truck?._id,
    ...(vanReg ? { vanReg } : {}),
  });

  await newPayroll.save();
  await pcnDamageController.recalculatePayrollPcnDamages(newPayroll.startTime, userId);
  await recalculatePayrollExpenses(newPayroll.startTime, userId);
  const payrollForResponse = (await Payroll.findById(newPayroll._id)) || newPayroll;
  await payrollForResponse.populate(['pcnDamages', 'expenses']);

  return { ok: true, payroll: payrollForResponse };
}

async function markShiftStartRequested(userId, dateKey = getTodayDateKeyLocal()) {
  const { truck, driverId, effectiveHelperId } = await getTruckTeamForUser(
    userId,
    dateKey
  );

  if (!isPairedDriverHelperTeam({ truck, driverId, effectiveHelperId })) {
    return {
      ok: false,
      status: 404,
      message: 'No truck or driver/helper assignment found for today.',
    };
  }

  const role = getUserTeamRole(userId, driverId, effectiveHelperId);
  if (!role) {
    return { ok: false, status: 403, message: 'User is not on this truck team for today.' };
  }

  const activePayroll = await findActivePayrollForDay(userId, dateKey);
  if (activePayroll) {
    return {
      ok: false,
      status: 400,
      message: 'You have already started work for the day.',
      payroll: activePayroll,
    };
  }

  const completedPayroll = await findCompletedPayrollForDay(userId, dateKey);
  if (completedPayroll) {
    return {
      ok: false,
      status: 400,
      message: 'You Already start a shift today',
      payroll: completedPayroll,
      shiftCompleted: true,
    };
  }

  const state = await getOrCreateProximityState(truck, dateKey, effectiveHelperId);
  let alreadyRequested = false;

  if (role === 'driver') {
    alreadyRequested = Boolean(state.shiftStartRequestedAt);
    if (!alreadyRequested) {
      state.shiftStartRequestedAt = new Date();
    }
  } else {
    alreadyRequested = Boolean(state.helperShiftStartRequestedAt);
    if (!alreadyRequested) {
      state.helperShiftStartRequestedAt = new Date();
    }
  }

  await state.save();

  return {
    ok: true,
    alreadyRequested,
    state,
    truck,
    driverId,
    effectiveHelperId,
    role,
  };
}

const ARRIVAL_METERS = Number(process.env.DRIVER_HELPER_ARRIVAL_METERS || 80);

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

async function isDriverAtHelperStart(driverId, effectiveHelperId) {
  const [driver, helper] = await Promise.all([
    Driver.findById(driverId).select('location'),
    Helper.findById(effectiveHelperId).select('start_location'),
  ]);
  const driverCoords = driver?.location?.coordinates;
  const helperCoords = helper?.start_location?.coordinates;
  if (!Array.isArray(driverCoords) || driverCoords.length < 2) return false;
  if (!Array.isArray(helperCoords) || helperCoords.length < 2) return false;

  const driverLng = Number(driverCoords[0]);
  const driverLat = Number(driverCoords[1]);
  const helperLng = Number(helperCoords[0]);
  const helperLat = Number(helperCoords[1]);
  if (
    !Number.isFinite(driverLat) ||
    !Number.isFinite(driverLng) ||
    !Number.isFinite(helperLat) ||
    !Number.isFinite(helperLng)
  ) {
    return false;
  }

  return (
    haversineMeters(driverLat, driverLng, helperLat, helperLng) <= ARRIVAL_METERS
  );
}

async function notifyUserShiftStarted(userId, payroll, dateKey) {
  try {
    const { emitNotificationToUser } = require('../socket');
    const message = 'Your shift has now started';
    await emitNotificationToUser(
      userId.toString(),
      'Payroll',
      message,
      'London Waste Management',
      {
        kind: 'ShiftAutoStarted',
        payrollId: payroll._id.toString(),
        dateKey,
        startTime: payroll.startTime?.toISOString?.() ?? payroll.startTime,
      }
    );
  } catch (err) {
    console.error('[shiftStartService] notifyUserShiftStarted:', err.message);
  }
}

async function emitPairShiftAutoStarted({
  driverId,
  helperId,
  dateKey,
  startTime,
  driverPayroll,
  helperPayroll,
}) {
  try {
    const { getIo, emitEvent } = require('../socket');
    const message = 'Your shift has now started';
    const payload = {
      driverId: driverId?.toString(),
      helperId: helperId?.toString(),
      dateKey,
      startTime,
      message,
      driverPayrollId: driverPayroll?._id?.toString() || null,
      helperPayrollId: helperPayroll?._id?.toString() || null,
    };

    const io = getIo();
    if (io) {
      io.emit('pairShiftAutoStarted', payload);
      if (driverPayroll) {
        io.emit('driverShiftAutoStarted', {
          ...payload,
          payrollId: payload.driverPayrollId,
        });
      }
      if (helperPayroll) {
        io.emit('helperShiftAutoStarted', {
          ...payload,
          payrollId: payload.helperPayrollId,
        });
      }
    } else {
      emitEvent('pairShiftAutoStarted', payload);
    }
  } catch (err) {
    console.error('[shiftStartService] emitPairShiftAutoStarted:', err.message);
  }
}

async function startPayrollForTeamMember(
  userId,
  dateKey,
  sharedStartTime,
  state,
  role,
  truck
) {
  const requestedField =
    role === 'driver' ? 'shiftStartRequestedAt' : 'helperShiftStartRequestedAt';
  const startedField =
    role === 'driver' ? 'shiftAutoStartedAt' : 'helperShiftAutoStartedAt';

  if (!state[requestedField] || state[startedField]) {
    return { started: false, role, reason: 'not-pending' };
  }

  const activePayroll = await findActivePayrollForDay(userId, dateKey);
  if (activePayroll) {
    state[startedField] = activePayroll.startTime || sharedStartTime;
    return { started: true, role, payroll: activePayroll, alreadyActive: true };
  }

  const result = await createShiftPayroll(userId, sharedStartTime, { truck, dateKey });
  if (!result.ok) {
    return { started: false, role, reason: 'create-failed', message: result.message };
  }

  state[startedField] = result.payroll.startTime;
  await notifyUserShiftStarted(userId, result.payroll, dateKey);
  return { started: true, role, payroll: result.payroll };
}

async function autoStartShiftsOnArrival({
  truck,
  state,
  dateKey = getTodayDateKeyLocal(),
}) {
  if (!hasPendingShiftStart(state)) {
    return { started: false, reason: 'nothing-pending' };
  }

  const driverId = truck.driverId;
  const helperId = state.helperId;
  const sharedStartTime = new Date();

  state.arrivalTriggeredAt = state.arrivalTriggeredAt || sharedStartTime;
  state.autoStartTriggered = true;

  const outcomes = [];
  const driverPending = state.shiftStartRequestedAt && !state.shiftAutoStartedAt;
  const helperPending =
    state.helperShiftStartRequestedAt && !state.helperShiftAutoStartedAt;

  if (driverPending) {
    outcomes.push(
      await startPayrollForTeamMember(
        driverId,
        dateKey,
        sharedStartTime,
        state,
        'driver',
        truck
      )
    );
  }
  if (helperPending) {
    outcomes.push(
      await startPayrollForTeamMember(
        helperId,
        dateKey,
        sharedStartTime,
        state,
        'helper',
        truck
      )
    );
  }

  await state.save();

  const driverOutcome = outcomes.find((o) => o.role === 'driver');
  const helperOutcome = outcomes.find((o) => o.role === 'helper');
  const anyStarted = outcomes.some((o) => o.started);

  if (anyStarted) {
    await emitPairShiftAutoStarted({
      driverId,
      helperId,
      dateKey,
      startTime: sharedStartTime,
      driverPayroll: driverOutcome?.payroll || null,
      helperPayroll: helperOutcome?.payroll || null,
    });
  }

  return {
    started: anyStarted,
    startTime: sharedStartTime,
    driver: driverOutcome || null,
    helper: helperOutcome || null,
    payroll: driverOutcome?.payroll || helperOutcome?.payroll || null,
    driverPayroll: driverOutcome?.payroll || null,
    helperPayroll: helperOutcome?.payroll || null,
  };
}

async function tryAutoStartIfDriverArrived({ truck, state, dateKey, driverId, effectiveHelperId }) {
  if (!(await isDriverAtHelperStart(driverId, effectiveHelperId))) {
    return null;
  }
  state.arrivalTriggeredAt = state.arrivalTriggeredAt || new Date();
  state.autoStartTriggered = true;
  await state.save();
  return autoStartShiftsOnArrival({ truck, state, dateKey });
}

/** @deprecated use autoStartShiftsOnArrival */
async function autoStartShiftOnArrival(opts) {
  return autoStartShiftsOnArrival(opts);
}

module.exports = {
  getTodayDateKeyLocal,
  getDayBounds,
  getTruckTeamForUser,
  driverHasHelperToday,
  isPairedDriverHelperTeam,
  getUserTeamRole,
  getShiftPendingStatusForUser,
  hasPendingShiftStart,
  findActivePayrollForDay,
  findCompletedPayrollForDay,
  createShiftPayroll,
  resolveVanRegForTruck,
  markShiftStartRequested,
  autoStartShiftsOnArrival,
  autoStartShiftOnArrival,
  tryAutoStartIfDriverArrived,
  notifyUserShiftStarted,
  isDriverAtHelperStart,
};
