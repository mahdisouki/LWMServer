const Truck = require('../models/Truck');
const Helper = require('../models/Helper');
const Driver = require('../models/Driver');
const DriverHelperProximityState = require('../models/DriverHelperProximityState');
const loggingService = require('./loggingService');
const { getAssignedForDayFromRanges } = require('./unitAssignmentLogService');

const THROTTLE_MS = Number(process.env.DRIVER_HELPER_PROXIMITY_THROTTLE_MS || 15000);
const ARRIVAL_METERS = Number(process.env.DRIVER_HELPER_ARRIVAL_METERS || 80);
const DEFAULT_MILESTONES = [5000, 2000, 1000, 500, 100];
const inMemoryLastRunByDriver = new Map();

function parseMilestonesFromEnv() {
  const raw = process.env.DRIVER_HELPER_DISTANCE_MILESTONES_METERS;
  if (!raw || typeof raw !== 'string') return DEFAULT_MILESTONES;

  const parsed = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!parsed.length) return DEFAULT_MILESTONES;
  return Array.from(new Set(parsed)).sort((a, b) => b - a);
}

function isRole(user, roleName) {
  if (!user) return false;
  if (user.roleType === roleName) return true;
  if (Array.isArray(user.role) && user.role.includes(roleName)) return true;
  return false;
}

function getTodayDateKeyLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

async function logProximityEvent({
  actorUserId,
  actorUsername,
  truckId,
  details,
}) {
  try {
    await loggingService.createLog({
      userId: actorUserId,
      username: actorUsername || 'system',
      action: 'OTHER',
      entityType: 'TRUCK',
      entityId: truckId,
      changes: details,
    });
  } catch (error) {
    // Do not block location flow if logging fails.
    console.error('[proximityAutoStart] Failed to create log:', error.message);
  }
}

async function processDriverLocationUpdate({
  actorUserId,
  actorUsername,
  latitude,
  longitude,
}) {
  const lastRunAt = inMemoryLastRunByDriver.get(String(actorUserId)) || 0;
  const now = Date.now();
  if (now - lastRunAt < THROTTLE_MS) {
    return { skipped: true, reason: 'throttled' };
  }
  inMemoryLastRunByDriver.set(String(actorUserId), now);

  const driver = await Driver.findById(actorUserId).select(
    '_id username role roleType'
  );
  if (!driver || !isRole(driver, 'Driver')) {
    return { skipped: true, reason: 'not-driver' };
  }

  const truck = await Truck.findOne({ driverId: actorUserId }).select(
    '_id driverId helperId'
  );
  if (!truck) {
    return { skipped: true, reason: 'missing-truck' };
  }

  const dateKey = getTodayDateKeyLocal();
  const assigned = await getAssignedForDayFromRanges(truck._id, dateKey);
  const effectiveHelperId = assigned?.helperId || truck.helperId || null;
  const hasHelperAssigned = Boolean(effectiveHelperId);
  let targetCoords = null;

  if (hasHelperAssigned) {
    const helper = await Helper.findById(effectiveHelperId).select(
      '_id username role roleType start_location'
    );
    targetCoords = helper?.start_location?.coordinates;

    if (!helper || !Array.isArray(targetCoords) || targetCoords.length < 2) {
      return { skipped: true, reason: 'helper-start-location-missing' };
    }
  } else {
    const soloDriver = await Driver.findById(actorUserId).select('start_location');
    targetCoords = soloDriver?.start_location?.coordinates;

    if (!soloDriver || !Array.isArray(targetCoords) || targetCoords.length < 2) {
      return { skipped: true, reason: 'driver-start-location-missing' };
    }
  }

  const targetLng = Number(targetCoords[0]);
  const targetLat = Number(targetCoords[1]);
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
    return {
      skipped: true,
      reason: hasHelperAssigned
        ? 'helper-start-location-invalid'
        : 'driver-start-location-invalid',
    };
  }

  const distanceMeters = haversineMeters(
    Number(latitude),
    Number(longitude),
    targetLat,
    targetLng
  );
  const milestones = parseMilestonesFromEnv();

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
  state.lastDistanceMeters = Math.round(distanceMeters);

  const reachedSet = new Set((state.milestonesReached || []).map(Number));
  const newlyReached = milestones.filter(
    (m) => distanceMeters <= m && !reachedSet.has(m)
  );

  for (const milestone of newlyReached) {
    reachedSet.add(milestone);
    await logProximityEvent({
      actorUserId,
      actorUsername,
      truckId: truck._id,
      details: {
        event: 'DRIVER_HELPER_DISTANCE_MILESTONE',
        milestoneMeters: milestone,
        currentDistanceMeters: Math.round(distanceMeters),
        driverId: truck.driverId,
        helperId: truck.helperId,
        dateKey,
      },
    });
  }

  state.milestonesReached = Array.from(reachedSet).sort((a, b) => b - a);

  let autoStartResult = null;
  if (!state.autoStartTriggered && distanceMeters <= ARRIVAL_METERS) {
    state.autoStartTriggered = true;
    state.arrivalTriggeredAt = new Date();

    autoStartResult = {
      startButtonEnabled: true,
      statusChanged: true,
      arrivalThresholdMeters: ARRIVAL_METERS,
      arrivalDistanceMeters: Math.round(distanceMeters),
    };

    await logProximityEvent({
      actorUserId,
      actorUsername,
      truckId: truck._id,
      details: {
        event: 'DRIVER_HELPER_ARRIVED_READY_TO_START',
        ...autoStartResult,
        driverId: truck.driverId,
        helperId: truck.helperId,
        dateKey,
      },
    });
  }

  await state.save();

  return {
    skipped: false,
    distanceMeters: Math.round(distanceMeters),
    newlyReachedMilestones: newlyReached,
    autoStartResult,
  };
}

module.exports = {
  processDriverLocationUpdate,
};
