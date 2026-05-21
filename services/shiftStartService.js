const Payroll = require('../models/Payroll');
const Truck = require('../models/Truck');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const DriverHelperProximityState = require('../models/DriverHelperProximityState');
const pcnDamageController = require('../controllers/pcnDamageController');
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

async function getTruckForDriver(driverId) {
  return Truck.findOne({ driverId }).select('_id driverId helperId');
}

async function getEffectiveHelperId(truck, dateKey) {
  if (!truck) return null;
  const assigned = await getAssignedForDayFromRanges(truck._id, dateKey);
  return assigned?.helperId || truck.helperId || null;
}

async function driverHasHelperToday(driverId, dateKey = getTodayDateKeyLocal()) {
  const truck = await getTruckForDriver(driverId);
  if (!truck) return { truck: null, effectiveHelperId: null };
  const effectiveHelperId = await getEffectiveHelperId(truck, dateKey);
  return { truck, effectiveHelperId };
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

async function findActivePayrollForDay(userId, dateKey = getTodayDateKeyLocal()) {
  const { startOfDay, endOfDay } = getDayBounds(dateKey);
  return Payroll.findOne({
    userId,
    startTime: { $gte: startOfDay, $lte: endOfDay },
    endTime: null,
  });
}

async function createShiftPayroll(userId, startTime = new Date()) {
  const existing = await Payroll.findOne({ userId, endTime: null });
  if (existing) {
    return { ok: false, status: 400, message: 'You have already started work for the day.', payroll: existing };
  }

  const truck =
    (await Truck.findOne({ driverId: userId })) ||
    (await Truck.findOne({ helperId: userId }));

  const newPayroll = new Payroll({
    userId,
    startTime: new Date(startTime),
    truckId: truck?._id,
  });

  await newPayroll.save();
  await pcnDamageController.recalculatePayrollPcnDamages(newPayroll.startTime, userId);
  await newPayroll.populate('pcnDamages');

  return { ok: true, payroll: newPayroll };
}

async function markShiftStartRequested(driverId, dateKey = getTodayDateKeyLocal()) {
  const { truck, effectiveHelperId } = await driverHasHelperToday(driverId, dateKey);
  if (!truck || !effectiveHelperId) {
    return { ok: false, status: 404, message: 'No truck or helper assignment found for today.' };
  }

  const activePayroll = await findActivePayrollForDay(driverId, dateKey);
  if (activePayroll) {
    return {
      ok: false,
      status: 400,
      message: 'You have already started work for the day.',
      payroll: activePayroll,
    };
  }

  const state = await getOrCreateProximityState(truck, dateKey, effectiveHelperId);
  if (state.shiftStartRequestedAt) {
    return {
      ok: true,
      alreadyRequested: true,
      state,
      truck,
      effectiveHelperId,
    };
  }

  state.shiftStartRequestedAt = new Date();
  await state.save();

  return {
    ok: true,
    alreadyRequested: false,
    state,
    truck,
    effectiveHelperId,
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

async function notifyDriverShiftStarted(driverId, payroll, dateKey) {
  try {
    const { emitNotificationToUser, emitEvent, getIo } = require('../socket');
    const message = 'Your shift has now started';
    await emitNotificationToUser(
      driverId.toString(),
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

    const io = getIo();
    if (io) {
      io.emit('driverShiftAutoStarted', {
        driverId: driverId.toString(),
        payrollId: payroll._id.toString(),
        startTime: payroll.startTime,
        dateKey,
        message,
      });
    } else {
      emitEvent('driverShiftAutoStarted', {
        driverId: driverId.toString(),
        payrollId: payroll._id.toString(),
        startTime: payroll.startTime,
        dateKey,
        message,
      });
    }
  } catch (err) {
    console.error('[shiftStartService] notifyDriverShiftStarted:', err.message);
  }
}

async function autoStartShiftOnArrival({
  driverId,
  truck,
  state,
  dateKey = getTodayDateKeyLocal(),
}) {
  if (!state?.shiftStartRequestedAt || state.shiftAutoStartedAt) {
    return { started: false, reason: 'not-pending-or-already-started' };
  }

  const activePayroll = await findActivePayrollForDay(driverId, dateKey);
  if (activePayroll) {
    state.shiftAutoStartedAt = activePayroll.startTime || new Date();
    state.autoStartTriggered = true;
    await state.save();
    return { started: false, reason: 'payroll-already-active', payroll: activePayroll };
  }

  const result = await createShiftPayroll(driverId);
  if (!result.ok) {
    return { started: false, reason: 'create-failed', message: result.message };
  }

  state.shiftAutoStartedAt = result.payroll.startTime;
  state.autoStartTriggered = true;
  state.arrivalTriggeredAt = state.arrivalTriggeredAt || new Date();
  await state.save();

  await notifyDriverShiftStarted(driverId, result.payroll, dateKey);

  return {
    started: true,
    payroll: result.payroll,
    startTime: result.payroll.startTime,
  };
}

module.exports = {
  getTodayDateKeyLocal,
  getDayBounds,
  driverHasHelperToday,
  findActivePayrollForDay,
  createShiftPayroll,
  markShiftStartRequested,
  autoStartShiftOnArrival,
  notifyDriverShiftStarted,
  isDriverAtHelperStart,
};
