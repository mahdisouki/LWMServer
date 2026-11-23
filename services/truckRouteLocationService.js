const Truck = require('../models/Truck');
const { User } = require('../models/User');
const { getAssignedForDayFromRanges } = require('./unitAssignmentLogService');

function normalizeDateKey(date) {
  if (!date) return null;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return date.trim();
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toPoint(coords, extras = {}) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || (lng === 0 && lat === 0)) {
    return null;
  }
  return {
    postcode: extras.postcode || '',
    address: extras.address || '',
    location: {
      type: 'Point',
      coordinates: [lng, lat],
    },
  };
}

function pointFromStored(entry) {
  if (!entry) return null;
  return toPoint(entry.location?.coordinates, {
    postcode: entry.postcode,
    address: entry.address,
  });
}

function pointFromGeoField(geo) {
  if (!geo) return null;
  if (Array.isArray(geo) && geo.length >= 2) return toPoint(geo);
  if (geo.coordinates) return toPoint(geo.coordinates);
  return null;
}

function parseIncomingPoint(value) {
  if (value == null || value === '' || value === false) return null;

  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      const error = new Error('start/end must be an object with coordinates');
      error.statusCode = 400;
      throw error;
    }
  }

  const lng = Number(
    raw?.location?.coordinates?.[0] ?? raw?.coordinates?.[0] ?? raw?.lng ?? raw?.longitude,
  );
  const lat = Number(
    raw?.location?.coordinates?.[1] ?? raw?.coordinates?.[1] ?? raw?.lat ?? raw?.latitude,
  );
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || (lng === 0 && lat === 0)) {
    const error = new Error('Valid latitude and longitude are required (not 0,0)');
    error.statusCode = 400;
    throw error;
  }

  return toPoint([lng, lat], {
    postcode: raw.postcode || '',
    address: raw.address || raw.label || '',
  });
}

function getDayRouteLocationFromTruck(truck, dateKey) {
  if (!truck?.routeLocations || !dateKey) return null;
  if (truck.routeLocations instanceof Map) {
    return truck.routeLocations.get(dateKey) || null;
  }
  if (typeof truck.routeLocations.get === 'function') {
    return truck.routeLocations.get(dateKey) || null;
  }
  return truck.routeLocations[dateKey] || truck.routeLocations?.[dateKey] || null;
}

/**
 * Effective start/end for a unit on a date:
 * 1) truck.routeLocations[date]
 * 2) helper profile
 * 3) driver profile
 */
async function resolveTruckDayRouteCoords(truckId, date, assignmentHint = null, truckDoc = null) {
  const dateKey = normalizeDateKey(date);
  if (!truckId || !dateKey) {
    return {
      date: dateKey,
      override: null,
      start: null,
      end: null,
      startSource: null,
      endSource: null,
    };
  }

  const truck =
    truckDoc ||
    (await Truck.findById(truckId).select('routeLocations name').lean({ flattenMaps: true }));
  if (!truck) {
    const error = new Error('Truck not found');
    error.statusCode = 404;
    throw error;
  }

  const dayOverride = getDayRouteLocationFromTruck(truck, dateKey);
  const overrideStart = pointFromStored(dayOverride?.start);
  const overrideEnd = pointFromStored(dayOverride?.end);

  const assignment =
    assignmentHint || (await getAssignedForDayFromRanges(truckId, dateKey));

  const staffGeoSelect = 'start_location end_location firstName lastName username';
  const [driver, helper] = await Promise.all([
    assignment?.driverId ? User.findById(assignment.driverId).select(staffGeoSelect).lean() : null,
    assignment?.helperId ? User.findById(assignment.helperId).select(staffGeoSelect).lean() : null,
  ]);

  const helperStart = pointFromGeoField(helper?.start_location);
  const helperEnd = pointFromGeoField(helper?.end_location);
  const driverStart = pointFromGeoField(driver?.start_location);
  const driverEnd = pointFromGeoField(driver?.end_location);

  let start = overrideStart;
  let startSource = overrideStart ? 'override' : null;
  if (!start && helperStart) {
    start = helperStart;
    startSource = 'helper';
  } else if (!start && driverStart) {
    start = driverStart;
    startSource = 'driver';
  }

  let end = overrideEnd;
  let endSource = overrideEnd ? 'override' : null;
  if (!end && helperEnd) {
    end = helperEnd;
    endSource = 'helper';
  } else if (!end && driverEnd) {
    end = driverEnd;
    endSource = 'driver';
  }

  return {
    date: dateKey,
    override:
      overrideStart || overrideEnd
        ? { start: overrideStart, end: overrideEnd }
        : null,
    start,
    end,
    startSource,
    endSource,
    defaults: {
      helperStart,
      helperEnd,
      driverStart,
      driverEnd,
    },
  };
}

async function upsertTruckDayRouteLocations({
  truckId,
  date,
  start,
  end,
  clearStart = false,
  clearEnd = false,
}) {
  const dateKey = normalizeDateKey(date);
  if (!dateKey) {
    const error = new Error('date is required (YYYY-MM-DD)');
    error.statusCode = 400;
    throw error;
  }

  const truck = await Truck.findById(truckId);
  if (!truck) {
    const error = new Error('Truck not found');
    error.statusCode = 404;
    throw error;
  }

  if (!truck.routeLocations) {
    truck.routeLocations = new Map();
  }

  const existing = truck.routeLocations.get(dateKey) || {};
  let nextStart = existing.start || null;
  let nextEnd = existing.end || null;

  if (clearStart) nextStart = null;
  else if (start !== undefined) nextStart = parseIncomingPoint(start);

  if (clearEnd) nextEnd = null;
  else if (end !== undefined) nextEnd = parseIncomingPoint(end);

  if (!nextStart && !nextEnd) {
    truck.routeLocations.delete(dateKey);
    truck.markModified('routeLocations');
    await truck.save();
    return null;
  }

  truck.routeLocations.set(dateKey, {
    ...(nextStart ? { start: nextStart } : {}),
    ...(nextEnd ? { end: nextEnd } : {}),
  });
  truck.markModified('routeLocations');
  await truck.save();

  return truck.routeLocations.get(dateKey);
}

async function deleteTruckDayRouteLocations(truckId, date) {
  const dateKey = normalizeDateKey(date);
  if (!dateKey) {
    const error = new Error('date is required (YYYY-MM-DD)');
    error.statusCode = 400;
    throw error;
  }

  const truck = await Truck.findById(truckId);
  if (!truck) {
    const error = new Error('Truck not found');
    error.statusCode = 404;
    throw error;
  }

  if (truck.routeLocations?.has(dateKey)) {
    truck.routeLocations.delete(dateKey);
    truck.markModified('routeLocations');
    await truck.save();
  }
  return true;
}

module.exports = {
  normalizeDateKey,
  resolveTruckDayRouteCoords,
  upsertTruckDayRouteLocations,
  deleteTruckDayRouteLocations,
  parseIncomingPoint,
};
