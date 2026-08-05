/**
 * Route Optimizer Controller
 * Assigns unassigned tasks to trucks (drivers) with route optimization and persists to DB.
 */

const axios = require('axios');
const crypto = require('crypto');
const Task = require('../models/Task');
const TippingRequest = require('../models/TippingRequest');
const Truck = require('../models/Truck');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const RouteOptimizerProposal = require('../models/RouteOptimizerProposal');
const { truckDisplayName } = require('../utils/truckHelpers');
const routeOptimizerService = require('../services/routeOptimizerService');
const dailySheetController = require('./dailySheetController');
const { getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');
//https://routeoptimiser.duckdns.org
const EXTERNAL_ROUTE_OPTIMIZER_URL =
  process.env.EXTERNAL_ROUTE_OPTIMIZER_URL || 'https://routeoptimiser.duckdns.org';
/** External optimizer: manual job groups (POST body: date, truck_contexts, job_groups). */
const EXTERNAL_ROUTE_GROUPS_API_PATH =
  process.env.EXTERNAL_ROUTE_GROUPS_API_PATH || '/api/v1/custom';
/** External optimizer: dual auto + custom compare in one call. */
const EXTERNAL_COMPARE_ROUTES_API_PATH =
  process.env.EXTERNAL_COMPARE_ROUTES_API_PATH || '/api/v1/compare-routes';

const ROUTE_PROPOSAL_TTL_MS = Number(process.env.ROUTE_PROPOSAL_TTL_MS) || 24 * 60 * 60 * 1000;

/** Trucks skipped by reset-vans-for-date (e.g. "Cancelled unit" holding archived jobs). */
const RESET_VANS_EXCLUDED_TRUCK_IDS = new Set(['694d6ec329bc56b433c9891b']);

const OPTIMIZER_AXIOS_OPTS = {
  timeout: 120000,
  validateStatus: () => true,
  headers: { 'Content-Type': 'application/json' },
};

function normalizeMongoId(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.$oid) return value.$oid;
  if (typeof value.toString === 'function') return value.toString();
  return null;
}

function isExcludedFromResetVans(truckId) {
  const id = normalizeMongoId(truckId);
  return id != null && RESET_VANS_EXCLUDED_TRUCK_IDS.has(id);
}

function filterResetVansTruckIds(truckIds) {
  if (!Array.isArray(truckIds)) return [];
  return truckIds.filter((id) => !isExcludedFromResetVans(id));
}

/** Mongoose Map-of-arrays subdocs: object spread drops taskId/order; use toObject() or explicit fields. */
function plainTruckRouteSegment(entry) {
  if (entry == null) {
    return { taskId: undefined, order: undefined, type: undefined };
  }
  const doc = typeof entry.toObject === 'function' ? entry.toObject() : entry;
  const typeRaw = doc.type;
  const type = typeRaw === 'Task' ? 'task' : typeRaw;
  return {
    taskId: doc.taskId,
    order: doc.order,
    type,
  };
}

function toLatLngFromGeoPoint(point) {
  if (!point || !Array.isArray(point.coordinates) || point.coordinates.length < 2) {
    return null;
  }
  const [lng, lat] = point.coordinates;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return null;
  }
  return { lat: Number(lat), lng: Number(lng) };
}

/**
 * Client body: vanCurrentCapacities (camelCase) or van_current_capacities — van Mongo id → number.
 * @param {unknown} raw
 * @returns {Record<string, number>|null}
 */
function normalizeVanCurrentCapacitiesMap(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !k.trim()) continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out[k.trim()] = n;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Keep only capacities for vans that appear in this optimize request (assignment van ids).
 * @param {Record<string, number>|null} map
 * @param {Set<string>} vanIdsInScope
 * @returns {Record<string, number>|null}
 */
function filterVanCapacitiesToScope(map, vanIdsInScope) {
  if (!map || !vanIdsInScope.size) return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const [vanId, cap] of Object.entries(map)) {
    if (vanIdsInScope.has(vanId)) out[vanId] = cap;
  }
  return Object.keys(out).length ? out : null;
}

function parseRouteOptimizerDate(inputDate) {
  const date = inputDate ? new Date(inputDate) : new Date();
  if (Number.isNaN(date.getTime())) {
    return { ok: false, message: 'Invalid date format' };
  }
  const dateStr = date.toISOString().split('T')[0];
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);
  return { ok: true, dateStr, startOfDay, endOfDay };
}

/**
 * @typedef {{ groupId: string, segments: Array<{ taskId: string, type: string }> }} NormalizedJobGroup
 */

function segmentsFromJobGroupEntry(group) {
  if (Array.isArray(group.segments)) {
    return group.segments
      .map((s) => {
        const taskId = normalizeMongoId(s.taskId ?? s.jobId ?? s.id);
        if (!taskId) return null;
        const type = s.type === 'TippingRequest' ? 'TippingRequest' : 'task';
        return { taskId, type };
      })
      .filter(Boolean);
  }

  /** @type {Array<{ taskId: string, type: string }>} */
  const segs = [];

  const jobLists = [
    { ids: group.jobs, type: null },
    { ids: group.taskIds, type: 'task' },
    { ids: group.tippingRequestIds ?? group.tippingIds, type: 'TippingRequest' },
    { ids: group.jobIds, type: null },
  ];

  for (const { ids, type: defaultType } of jobLists) {
    if (!Array.isArray(ids)) continue;
    for (const raw of ids) {
      if (raw && typeof raw === 'object') {
        const taskId = normalizeMongoId(raw.id ?? raw.jobId ?? raw.taskId);
        if (!taskId) continue;
        const type =
          raw.type === 'TippingRequest'
            ? 'TippingRequest'
            : defaultType === 'TippingRequest'
              ? 'TippingRequest'
              : 'task';
        segs.push({ taskId, type });
      } else {
        const taskId = normalizeMongoId(raw);
        if (!taskId) continue;
        const type = defaultType === 'TippingRequest' ? 'TippingRequest' : 'task';
        segs.push({ taskId, type });
      }
    }
  }

  return segs;
}

/**
 * Manual job groups from the client (not tied to a truck). Trucks are chosen separately via truckIds.
 * Accepts:
 * - jobGroups / groups: [{ groupId?, jobs?, segments?, taskIds?, ... }]
 * - jobs: [[taskId, ...], ...] — each inner array is one group
 * - jobs: [{ groupId?, jobs: [...] }, ...]
 * @returns {NormalizedJobGroup[]}
 */
function normalizeJobGroupsFromBody(body) {
  /** @type {NormalizedJobGroup[]} */
  const out = [];
  let groupIndex = 0;

  const pushGroup = (group, fallbackIndex) => {
    const segments = segmentsFromJobGroupEntry(group);
    if (!segments.length) return;
    const groupId =
      (typeof group.groupId === 'string' && group.groupId.trim()) ||
      (typeof group.id === 'string' && group.id.trim()) ||
      `group-${fallbackIndex + 1}`;
    out.push({ groupId, segments });
  };

  const listSources = [body.jobGroups, body.groups];
  for (const source of listSources) {
    if (!Array.isArray(source)) continue;
    for (const group of source) {
      pushGroup(group, groupIndex);
      groupIndex += 1;
    }
  }

  if (Array.isArray(body.jobs) && body.jobs.length) {
    const first = body.jobs[0];
    if (Array.isArray(first)) {
      body.jobs.forEach((jobIds, i) => {
        if (!Array.isArray(jobIds)) return;
        pushGroup({ groupId: `group-${i + 1}`, jobs: jobIds }, i);
      });
    } else if (first && typeof first === 'object') {
      body.jobs.forEach((group, i) => pushGroup(group, i));
    }
  }

  return out;
}

/** Spread manual groups across trucks (fallback when external groups API is unavailable). */
function distributeJobGroupsAcrossTrucks(jobGroups, trucksInScope) {
  /** @type {Map<string, NormalizedJobGroup[]>} */
  const byTruck = new Map();
  for (const entry of trucksInScope) {
    byTruck.set(entry.truck._id.toString(), []);
  }
  if (!trucksInScope.length) return byTruck;

  jobGroups.forEach((group, i) => {
    const truckId = trucksInScope[i % trucksInScope.length].truck._id.toString();
    byTruck.get(truckId).push(group);
  });
  return byTruck;
}

async function buildOptimizerJobsFromSegments(segments, logPrefix = '[routeGroups]') {
  const jobs = [];
  const skipped = [];

  for (let segIndex = 0; segIndex < segments.length; segIndex++) {
    const seg = segments[segIndex];
    const idStr = normalizeMongoId(seg.taskId);
    if (!idStr) {
      skipped.push({ segment: seg, reason: 'missing taskId' });
      continue;
    }
    const isTip = seg.type === 'TippingRequest';
    const order = segIndex + 1;
    const type = isTip ? 'TippingRequest' : 'task';

    if (isTip) {
      const tip = await TippingRequest.findById(idStr).populate('tippingPlace');
      const coords = tip?.tippingPlace?.location?.coordinates;
      if (!coords || coords.length < 2) {
        skipped.push({ taskId: idStr, type: 'TippingRequest', reason: 'no tipping place coordinates' });
        continue;
      }
      jobs.push({
        job_id: idStr,
        lat: coords[1],
        lng: coords[0],
        order,
        type,
      });
    } else {
      const task = await Task.findById(idStr);
      const coords = task?.location?.coordinates;
      if (!coords || coords.length < 2) {
        skipped.push({ taskId: idStr, type: 'task', reason: 'no task location coordinates' });
        continue;
      }
      jobs.push({
        job_id: idStr,
        lat: coords[1],
        lng: coords[0],
        taskDuration:
          typeof task.taskDuration === 'number' && task.taskDuration >= 0 ? task.taskDuration : 10,
        spaceOfVan:
          typeof task.spaceOfVan === 'number' && task.spaceOfVan >= 0 ? task.spaceOfVan : 0,
        order,
        type,
      });
    }
  }

  if (skipped.length) {
    console.warn(logPrefix, 'skipped segments while building jobs', skipped);
  }

  return { jobs, skipped };
}

async function loadTrucksWithDriversForDate({ dateStr, requestedTruckIds }) {
  const hasTruckSelection = Array.isArray(requestedTruckIds) && requestedTruckIds.length > 0;
  const truckQuery = hasTruckSelection ? { _id: { $in: requestedTruckIds } } : {};
  const allTrucks = await Truck.find(truckQuery).populate('vanId');

  if (hasTruckSelection && !allTrucks.length) {
    return { ok: false, status: 400, message: 'No valid trucks found for provided truckIds/selectedTruckIds' };
  }

  const trucksWithDrivers = [];
  for (const t of allTrucks) {
    const assignment = await getAssignedForDayFromRanges(t._id, dateStr);
    if (assignment.driverId) {
      const driver = await Driver.findById(assignment.driverId).select('_id');
      if (!driver) continue;
      let helper = null;
      if (assignment.helperId) {
        helper = await Helper.findById(assignment.helperId).select('start_location end_location');
      }
      trucksWithDrivers.push({
        truck: t,
        driverId: assignment.driverId,
        assignedVanId: assignment.vanId || null,
        startLocation: helper ? toLatLngFromGeoPoint(helper.start_location) : null,
        endLocation: helper ? toLatLngFromGeoPoint(helper.end_location) : null,
      });
    }
  }

  if (!trucksWithDrivers.length) {
    return { ok: false, status: 400, message: 'No trucks with drivers available for assignment' };
  }

  return { ok: true, trucksWithDrivers, hasTruckSelection };
}

function buildTruckContextsPayload(trucksInScope) {
  return trucksInScope.map(({ truck, assignedVanId, startLocation, endLocation }) => ({
    truck_id: truck._id.toString(),
    van_id: assignedVanId ? assignedVanId.toString() : null,
    start_location: startLocation,
    end_location: endLocation,
  }));
}

function buildVanCapsForTrucks(body, trucksInScope) {
  const vanIdsInScope = new Set(
    trucksInScope
      .map(({ assignedVanId }) => (assignedVanId ? assignedVanId.toString() : null))
      .filter(Boolean)
  );
  const rawVanCaps = body.vanCurrentCapacities ?? body.van_current_capacities;
  const vanCapsNormalized = normalizeVanCurrentCapacitiesMap(rawVanCaps);
  return filterVanCapacitiesToScope(vanCapsNormalized, vanIdsInScope);
}

function attachVanCapsToPayload(payload, vanCapsForOptimizer) {
  if (vanCapsForOptimizer) {
    payload.van_current_capacities = vanCapsForOptimizer;
  }
  return payload;
}

async function postExternalOptimizer(url, payload) {
  const { data, status } = await axios.post(url, payload, OPTIMIZER_AXIOS_OPTS);
  return { data, status, url };
}

async function buildJobGroupsForPayload(jobGroups, logPrefix = '[routeGroups]') {
  /** @type {Array<{ group_id: string, jobs: object[] }>} */
  const job_groups = [];

  for (const group of jobGroups) {
    const { jobs, skipped } = await buildOptimizerJobsFromSegments(
      group.segments,
      `${logPrefix}:${group.groupId}`
    );
    if (!jobs.length) {
      return {
        ok: false,
        message: `Group "${group.groupId}" has no jobs with coordinates`,
        skipped,
        groupId: group.groupId,
      };
    }
    job_groups.push({
      group_id: group.groupId,
      jobs,
    });
  }

  return { ok: true, job_groups };
}

/** Parse external driving time strings (e.g. "3:19" → 199 minutes as H:MM). */
function parseDrivingTimeMin(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const s = String(value).trim();
  if (!s) return null;

  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      return parts[0] * 60 + parts[1];
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function extractTruckRouteMetrics(routeKey, routeData, truckName) {
  const route = routeData && typeof routeData === 'object' ? routeData : {};
  const segments = Array.isArray(route.route_segments) ? route.route_segments : [];
  const resolvedName = route.driver_info?.name || truckName || routeKey;

  let durationMin = null;
  for (const key of ['total_time_min', 'total_duration_min', 'duration_min', 'total_time']) {
    const n = Number(route[key]);
    if (Number.isFinite(n)) {
      durationMin = n;
      break;
    }
  }
  if (durationMin == null && route.driving_time_min != null) {
    durationMin = parseDrivingTimeMin(route.driving_time_min);
  }
  if (durationMin == null && segments.length) {
    const sum = segments.reduce((acc, seg) => {
      const d = Number(seg?.total_segment_min ?? seg?.duration_min ?? seg?.duration ?? 0);
      return acc + (Number.isFinite(d) ? d : 0);
    }, 0);
    if (sum > 0) durationMin = sum;
  }

  let distanceKm = null;
  for (const key of [
    'total_distance_km',
    'total_distance',
    'distance_km',
    'driving_distance_km',
  ]) {
    const n = Number(route[key]);
    if (Number.isFinite(n)) {
      distanceKm = n;
      break;
    }
  }

  const drivingTimeDisplay =
    route.driving_time_min != null ? String(route.driving_time_min) : null;

  return {
    truckId: routeKey,
    truckName: resolvedName,
    durationMin,
    drivingTimeDisplay,
    distanceKm,
    jobCount: segments.length,
  };
}

function buildRoutePreviewMetrics(routes, trucksWithDrivers, options = {}) {
  const truckNameById = new Map(
    trucksWithDrivers.map(({ truck }) => [truck._id.toString(), truckDisplayName(truck)])
  );
  const routeMap = routes && typeof routes === 'object' ? routes : {};
  const routeMetrics = Object.keys(routeMap).map((key) =>
    extractTruckRouteMetrics(key, routeMap[key], truckNameById.get(key))
  );
  const summedDurationMin = routeMetrics.reduce(
    (acc, r) => acc + (Number.isFinite(r.durationMin) ? r.durationMin : 0),
    0
  );
  const fleetTotalDistanceKm = routeMetrics.reduce(
    (acc, r) => acc + (Number.isFinite(r.distanceKm) ? r.distanceKm : 0),
    0
  );

  const fleetTotalDurationMin =
    options.fleetTotalDurationMin != null
      ? options.fleetTotalDurationMin
      : routeMetrics.length
        ? summedDurationMin
        : null;

  return {
    routes: routeMetrics,
    fleetTotalDurationMin,
    fleetTotalDurationDisplay: options.fleetTotalDurationDisplay ?? null,
    fleetTotalDistanceKm: routeMetrics.length ? fleetTotalDistanceKm : null,
  };
}

function enrichRouteMetricsWithComparison(routeMetrics, comparison, variant) {
  const byTruck = comparison?.by_truck;
  if (!byTruck || typeof byTruck !== 'object') return routeMetrics;

  const comparisonKey = variant === 'auto' ? 'calculate_routes' : 'custom';

  return routeMetrics.map((row) => {
    const truckCompare = byTruck[row.truckId];
    if (!truckCompare || typeof truckCompare !== 'object') return row;
    return {
      ...row,
      comparisonDrivingTime: truckCompare[comparisonKey] ?? null,
      comparisonDifference: truckCompare.difference ?? null,
      onlyInThisVariant:
        variant === 'auto'
          ? Boolean(truckCompare.only_in_calculate_routes)
          : Boolean(truckCompare.only_in_custom),
    };
  });
}

async function resolveCompareRoutesExternal({
  dateStr,
  truck_contexts,
  job_groups,
  vanCapsForOptimizer,
  reqBody,
}) {
  const compareUrl = `${EXTERNAL_ROUTE_OPTIMIZER_URL}${EXTERNAL_COMPARE_ROUTES_API_PATH}`;
  const payload = {
    date: dateStr,
    truck_contexts,
    job_groups,
    respect_time_slots: reqBody.respectTimeSlots ?? reqBody.respect_time_slots ?? false,
    van_capacity: reqBody.vanCapacity ?? reqBody.van_capacity ?? null,
  };
  if (vanCapsForOptimizer) {
    payload.van_current_capacities = vanCapsForOptimizer;
  }

  const { data, status } = await postExternalOptimizer(compareUrl, payload);
  const autoRoutes = data?.calculate_routes?.routes;
  const customRoutes = data?.custom?.routes;
  const hasAnyRoutes =
    (autoRoutes && typeof autoRoutes === 'object') ||
    (customRoutes && typeof customRoutes === 'object');
  const externalOk = data != null && hasAnyRoutes && (status === 200 || data.success === true);

  if (!externalOk) {
    if (status === 404 || status === 405) {
      return { ok: false, fallback: true, status, error: 'compare-routes not available' };
    }
    return {
      ok: false,
      error:
        (typeof data?.detail === 'string' && data.detail) ||
        data?.message ||
        `Compare routes failed (HTTP ${status})`,
      detail: data,
      status: status >= 500 ? 502 : status,
    };
  }

  const autoBlock = data.calculate_routes || {};
  const customBlock = data.custom || {};
  const comparison = data.comparison && typeof data.comparison === 'object' ? data.comparison : null;
  const fleet = comparison?.fleet || {};
  const autoRoutesMap =
    autoBlock.routes && typeof autoBlock.routes === 'object' ? autoBlock.routes : {};
  const customRoutesMap =
    customBlock.routes && typeof customBlock.routes === 'object' ? customBlock.routes : {};

  const buildVariant = (block, routesMap, variant, fleetKey, fleetDisplayKey) => {
    const hasRoutes = Object.keys(routesMap).length > 0;
    const blockOk = block.success !== false;
    return {
      ok: blockOk && hasRoutes,
      routes: routesMap,
      apiCallsUsed: block.api_calls_used ?? 0,
      optimizerMode: `compare-routes/${variant}`,
      externalSummary: {
        ...(block.summary && typeof block.summary === 'object' ? block.summary : {}),
        comparison,
      },
      fleetTotalDurationMin: parseDrivingTimeMin(fleet[fleetKey]),
      fleetTotalDurationDisplay: fleet[fleetDisplayKey] ?? null,
      error:
        !blockOk || !hasRoutes
          ? block.message ||
            block.error ||
            (typeof block.detail === 'string' ? block.detail : null) ||
            `${variant} routes unavailable`
          : null,
    };
  };

  return {
    ok: true,
    comparison,
    apiCallsUsed: data.api_calls_used ?? 0,
    auto: buildVariant(
      autoBlock,
      autoRoutesMap,
      'auto',
      'calculate_routes_total',
      'calculate_routes_total'
    ),
    custom: buildVariant(customBlock, customRoutesMap, 'custom', 'custom_total', 'custom_total'),
  };
}

async function resolveAutoRoutes(basePayload) {
  const url = `${EXTERNAL_ROUTE_OPTIMIZER_URL}/api/v1/calculate-routes`;
  const { data, status } = await postExternalOptimizer(url, basePayload);
  const hasRoutes = data != null && data.routes != null && typeof data.routes === 'object';
  const externalOk = hasRoutes && (status === 200 || data.success === true);

  if (!externalOk) {
    return {
      ok: false,
      error:
        (typeof data?.detail === 'string' && data.detail) ||
        data?.message ||
        `Automatic route optimizer failed (HTTP ${status})`,
      detail: data,
      status: status >= 500 ? 502 : status,
    };
  }

  return {
    ok: true,
    routes: data.routes || {},
    apiCallsUsed: data.api_calls_used ?? 0,
    optimizerMode: 'calculate-routes',
    externalSuccess: data.success !== false,
    externalSummary: data.summary && typeof data.summary === 'object' ? data.summary : {},
  };
}

async function resolveCustomGroupRoutes({
  basePayload,
  job_groups,
  jobGroups,
  trucksInScope,
  dateStr,
}) {
  const payload = { ...basePayload, job_groups };
  const groupsUrl = `${EXTERNAL_ROUTE_OPTIMIZER_URL}${EXTERNAL_ROUTE_GROUPS_API_PATH}`;
  const { data, status } = await postExternalOptimizer(groupsUrl, payload);

  const hasRoutes = data != null && data.routes != null && typeof data.routes === 'object';
  const externalOk = hasRoutes && (status === 200 || data.success === true);

  if (externalOk) {
    return {
      ok: true,
      routes: data.routes,
      apiCallsUsed: data.api_calls_used ?? 0,
      optimizerMode: 'custom',
      externalSuccess: data.success !== false,
      externalSummary: data.summary && typeof data.summary === 'object' ? data.summary : {},
    };
  }

  if (status === 404 || status === 405 || status === 422) {
    const routes = {};
    let apiCallsUsed = 0;
    const groupsByTruck = distributeJobGroupsAcrossTrucks(jobGroups, trucksInScope);

    for (const entry of trucksInScope) {
      const truckId = entry.truck._id.toString();
      const groups = groupsByTruck.get(truckId) || [];
      if (!groups.length) {
        routes[truckId] = { route_segments: [] };
        continue;
      }
      routes[truckId] = await optimizeTruckGroupsLocally({
        truckEntry: entry,
        dateStr,
        groups,
      });
      apiCallsUsed += groups.length;
    }

    return {
      ok: true,
      routes,
      apiCallsUsed,
      optimizerMode: 'per-group-recalculate-distributed',
      externalSuccess: true,
      externalSummary: {},
    };
  }

  return {
    ok: false,
    error:
      (typeof data?.detail === 'string' && data.detail) ||
      data?.message ||
      `Custom route optimizer failed (HTTP ${status})`,
    detail: data,
    status: status >= 500 ? 502 : status,
  };
}

async function expireStaleRouteProposals() {
  const now = new Date();
  await RouteOptimizerProposal.updateMany(
    { status: 'pending', expiresAt: { $lt: now } },
    { $set: { status: 'expired' } }
  );
}

async function persistExternalRoutes({
  trucksWithDrivers,
  routes,
  dateStr,
  startOfDay,
  endOfDay,
  logScope = 'external',
}) {
  const consideredTruckIds = trucksWithDrivers.map(({ truck }) => truck._id);
  await Task.updateMany(
    {
      date: { $gte: startOfDay, $lte: endOfDay },
      truckId: { $in: consideredTruckIds },
    },
    { $set: { truckId: null } }
  );

  const routeKeys = Object.keys(routes || {});
  let assignedCount = 0;

  for (const routeKey of routeKeys) {
    const entry = trucksWithDrivers.find(({ truck }) => truck._id.toString() === routeKey);
    if (!entry) {
      console.log('[RouteOptimizer:%s] routeKey=%s no truck matched (skip)', logScope, routeKey);
      continue;
    }
    const { truck } = entry;
    if (!truck.tasks) truck.tasks = new Map();
    truck.tasks.set(dateStr, []);
    truck.markModified('tasks');

    const routeSegments = Array.isArray(routes[routeKey].route_segments)
      ? routes[routeKey].route_segments
      : [];
    let assignedThisTruck = 0;
    const missingTaskIds = [];

    for (let i = 0; i < routeSegments.length; i++) {
      const segment = routeSegments[i];
      if (!segment || typeof segment !== 'object') continue;

      const rawTaskId = segment.taskId;
      const taskId =
        typeof rawTaskId === 'string'
          ? rawTaskId
          : rawTaskId && typeof rawTaskId === 'object' && rawTaskId.$oid
            ? rawTaskId.$oid
            : null;

      if (!taskId) {
        missingTaskIds.push(String(rawTaskId));
        continue;
      }

      const order = Number.isFinite(Number(segment.order)) ? Number(segment.order) : i + 1;
      const segType = segment.type === 'TippingRequest' ? 'TippingRequest' : 'task';

      if (segType === 'TippingRequest') {
        await TippingRequest.findByIdAndUpdate(taskId, { truckId: truck._id });
        truck.addTippingRequest(dateStr, taskId, order);
      } else {
        await Task.findByIdAndUpdate(taskId, { truckId: truck._id });
        truck.addTask(dateStr, taskId, order);
      }

      assignedCount += 1;
      assignedThisTruck += 1;
    }

    if (missingTaskIds.length) {
      console.log(
        '[RouteOptimizer:%s] truck %s: segments without valid taskId: %s',
        logScope,
        truckDisplayName(truck),
        missingTaskIds.join(', ')
      );
    }
    console.log(
      '[RouteOptimizer:%s] truck %s: assigned %d (total %d)',
      logScope,
      truckDisplayName(truck),
      assignedThisTruck,
      assignedCount
    );
    await truck.save();
  }

  try {
    const mockReq = { body: { date: dateStr } };
    const mockRes = { status: () => ({ json: () => {} }), json: () => {} };
    await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
  } catch (dailySheetErr) {
    console.error('Route optimizer: daily sheet sync error', dailySheetErr);
  }

  return assignedCount;
}

async function optimizeTruckGroupsLocally({ truckEntry, dateStr, groups }) {
  const { truck, assignedVanId, startLocation, endLocation } = truckEntry;
  const routeKey = truck._id.toString();
  const combinedSegments = [];
  let orderOffset = 0;

  const truckContext = {
    van_id: assignedVanId ? assignedVanId.toString() : null,
    truck_id: routeKey,
    start_location: startLocation,
    end_location: endLocation,
  };

  for (const group of groups) {
    const { jobs } = await buildOptimizerJobsFromSegments(
      group.segments,
      `[routeGroups:${routeKey}:${group.groupId}]`
    );
    if (!jobs.length) continue;

    const payload = {
      jobs,
      date: dateStr,
      truck_contexts: [truckContext],
    };

    const { data, status } = await axios.post(
      `${EXTERNAL_ROUTE_OPTIMIZER_URL}/api/v1/recalculate-route2`,
      payload,
      {
        timeout: 120000,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (status !== 200) {
      throw Object.assign(new Error(data?.detail || data?.message || 'Group recalculate failed'), {
        status: status >= 500 ? 502 : status,
        detail: data,
        groupId: group.groupId,
        truckId: routeKey,
      });
    }

    const truckRoute =
      data && typeof data.route === 'object'
        ? data.route
        : data?.routes?.[routeKey] || null;
    const routeSegments = Array.isArray(truckRoute?.route_segments) ? truckRoute.route_segments : [];

    for (let i = 0; i < routeSegments.length; i++) {
      const segment = routeSegments[i];
      if (!segment || typeof segment !== 'object') continue;
      const baseOrder = Number.isFinite(Number(segment.order)) ? Number(segment.order) : i + 1;
      combinedSegments.push({
        ...segment,
        order: orderOffset + baseOrder,
        groupId: group.groupId,
      });
    }
    orderOffset += routeSegments.length;
  }

  return { route_segments: combinedSegments };
}

function isOptimizerTransportFailure(error) {
  if (!error) return false;
  if (error.isAxiosError && !error.response) return true;
  const code = error.code || (error.cause && error.cause.code);
  if (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ENETUNREACH'
  ) {
    return true;
  }
  if (
    code === 'ECONNABORTED' &&
    error.message &&
    String(error.message).toLowerCase().includes('timeout')
  ) {
    return true;
  }
  return false;
}

/** No HTTP response from axios (connect/DNS/firewall/timeout). */
function responseFromOptimizerNetworkError(error, contextLabel) {
  const code = error && (error.code || (error.cause && error.cause.code));
  const baseUrl = EXTERNAL_ROUTE_OPTIMIZER_URL;
  const prefix = contextLabel ? `${contextLabel}: ` : '';

  if (code === 'ECONNREFUSED') {
    return {
      status: 502,
      body: {
        message: `${prefix}Route optimizer refused the connection — service may be down or port wrong`,
        code,
        optimizerBaseUrl: baseUrl,
      },
    };
  }

  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return {
      status: 504,
      body: {
        message: `${prefix}Route optimizer connection timed out — host unreachable, firewall, or not on same network`,
        code,
        optimizerBaseUrl: baseUrl,
      },
    };
  }

  if (code === 'ENOTFOUND') {
    return {
      status: 502,
      body: {
        message: `${prefix}Route optimizer host could not be resolved — check EXTERNAL_ROUTE_OPTIMIZER_URL`,
        code,
        optimizerBaseUrl: baseUrl,
      },
    };
  }

  if (code === 'ENETUNREACH') {
    return {
      status: 502,
      body: {
        message: `${prefix}Route optimizer network unreachable`,
        code,
        optimizerBaseUrl: baseUrl,
      },
    };
  }

  if (code === 'ECONNABORTED' && error.message && String(error.message).toLowerCase().includes('timeout')) {
    return {
      status: 504,
      body: {
        message: `${prefix}Route optimizer request exceeded timeout`,
        code,
        optimizerBaseUrl: baseUrl,
      },
    };
  }

  if (error && error.response) {
    const st = error.response.status;
    return {
      status: st >= 500 ? 502 : st >= 400 ? st : 502,
      body: {
        message: `${prefix}Route optimizer returned an error`,
        status: st,
        detail: error.response.data,
      },
    };
  }

  return {
    status: 502,
    body: {
      message: `${prefix}Route optimizer request failed (no response)`,
      code: code || undefined,
      detail: error && error.message,
      optimizerBaseUrl: baseUrl,
    },
  };
}

/**
 * POST /api/route-optimizer/external/calculate-routes
 * Loads trucks with drivers for the given date and forwards date + truck_contexts to the external API;
 * the optimizer service resolves jobs for that date.
 * Body: { date: string|Date, truckIds?: string[], selectedTruckIds?: string[],
 *   vanCurrentCapacities?: Record<string, number> }
 * Optional per-van capacity is forwarded to the external service as van_current_capacities (snake_case),
 * limited to van ids present in truck_contexts for this request.
 * Returns: { success, routes, api_calls_used } from external API.
 */
async function calculateRoutesExternal(req, res) {
  try {
    const inputDate = req.body.date ? new Date(req.body.date) : new Date();
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    const dateStr = inputDate.toISOString().split('T')[0];
    const startOfDay = new Date(inputDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const requestedTruckIds = Array.isArray(req.body.truckIds)
      ? req.body.truckIds
      : Array.isArray(req.body.selectedTruckIds)
        ? req.body.selectedTruckIds
        : null;

    const hasTruckSelection = Array.isArray(requestedTruckIds) && requestedTruckIds.length > 0;

    // Use UnitAssignmentLogRange to determine which driver is on which truck for this day
    const truckQuery = hasTruckSelection ? { _id: { $in: requestedTruckIds } } : {};
    const allTrucks = await Truck.find(truckQuery).populate('vanId');

    if (hasTruckSelection && !allTrucks.length) {
      return res.status(400).json({
        message: 'No valid trucks found for provided truckIds/selectedTruckIds',
      });
    }

    const trucksWithDrivers = [];
    for (const t of allTrucks) {
      const assignment = await getAssignedForDayFromRanges(t._id, dateStr);
      if (assignment.driverId) {
        const driver = await Driver.findById(assignment.driverId).select('_id');
        if (!driver) continue;
        let helper = null;
        if (assignment.helperId) {
          helper = await Helper.findById(assignment.helperId).select('start_location end_location');
        }
        trucksWithDrivers.push({
          truck: t,
          driverId: assignment.driverId,
          assignedVanId: assignment.vanId || null,
          startLocation: helper ? toLatLngFromGeoPoint(helper.start_location) : null,
          endLocation: helper ? toLatLngFromGeoPoint(helper.end_location) : null,
        });
      }
    }

    if (!trucksWithDrivers.length) {
      return res.status(400).json({
        message: 'No trucks with drivers available for assignment',
      });
    }

    console.log('[RouteOptimizer:external] date=%s trucksWithDrivers=%d', dateStr, trucksWithDrivers.length);
    trucksWithDrivers.forEach(({ truck, driverId }, i) => {
      console.log(
        '[RouteOptimizer:external] truck[%d] _id=%s name=%s driverId=%s',
        i,
        truck._id.toString(),
        truckDisplayName(truck),
        driverId.toString()
      );
    });

    const vanIdsInScope = new Set(
      trucksWithDrivers
        .map(({ assignedVanId }) => (assignedVanId ? assignedVanId.toString() : null))
        .filter(Boolean)
    );
    const rawVanCaps = req.body.vanCurrentCapacities ?? req.body.van_current_capacities;
    const vanCapsNormalized = normalizeVanCurrentCapacitiesMap(rawVanCaps);
    const vanCapsForOptimizer = filterVanCapacitiesToScope(vanCapsNormalized, vanIdsInScope);

    const payload = {
      date: dateStr,
      truck_contexts: trucksWithDrivers.map(
        ({ truck, assignedVanId, startLocation, endLocation }) => ({
          truck_id: truck._id.toString(),
          van_id: assignedVanId ? assignedVanId.toString() : null,
          start_location: startLocation,
          end_location: endLocation,
        })
      ),
    };
    if (vanCapsForOptimizer) {
      payload.van_current_capacities = vanCapsForOptimizer;
    }
    console.log("payload", payload);
    const { data, status } = await axios.post(
      `${EXTERNAL_ROUTE_OPTIMIZER_URL}/api/v1/calculate-routes`,
      payload,
      {
        timeout: 120000,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (status !== 200) {
      if (data?.detail && Array.isArray(data.detail)) {
        console.error('[RouteOptimizer:external] validation errors (full):', JSON.stringify(data.detail, null, 2));
      } else {
        console.log(data);
      }
      return res.status(status >= 500 ? 502 : status).json({
        message: data?.detail || data?.message || 'External route optimizer request failed',
        ...(data && typeof data === 'object' && { detail: data }),
      });
    }
    console.log(data.routes);
    const routes = data.routes || {};
    const routeKeys = Object.keys(routes);
    console.log('[RouteOptimizer:external] external response route keys (%d): %s', routeKeys.length, routeKeys.join(', '));

    // Unassign tasks only for selected/considered trucks on this date so unrelated trucks are untouched.
    const consideredTruckIds = trucksWithDrivers.map(({ truck }) => truck._id);
    await Task.updateMany(
      {
        date: { $gte: startOfDay, $lte: endOfDay },
        truckId: { $in: consideredTruckIds },
      },
      { $set: { truckId: null } }
    );

    // Persist assignment: clear old routes for this date on each truck, then assign new order
    let assignedCount = 0;
    for (const routeKey of routeKeys) {
      // New response: routeKey is truck_id (Truck._id)
      const entry = trucksWithDrivers.find(({ truck }) => truck._id.toString() === routeKey);
      if (!entry) {
        console.log('[RouteOptimizer:external] routeKey=%s no truck/driver assignment matched (skip)', routeKey);
        continue;
      }
      const { truck } = entry;
      console.log(
        '[RouteOptimizer:external] routeKey=%s matched truck name=%s _id=%s (by truckId)',
        routeKey,
        truckDisplayName(truck),
        truck._id.toString()
      );
      // Remove old routes for this date so we don't duplicate tasks
      if (!truck.tasks) truck.tasks = new Map();
      truck.tasks.set(dateStr, []);
      truck.markModified('tasks');

      // New response format: routes[truckId].route_segments is an array of objects:
      // { taskId, type, order, ... }
      const routeSegments = Array.isArray(routes[routeKey].route_segments)
        ? routes[routeKey].route_segments
        : [];
      let assignedThisTruck = 0;
      const missingTaskIds = [];
      for (let i = 0; i < routeSegments.length; i++) {
        const segment = routeSegments[i];
        if (!segment || typeof segment !== 'object') continue;

        const rawTaskId = segment.taskId;
        const taskId = typeof rawTaskId === 'string'
          ? rawTaskId
          : (rawTaskId && typeof rawTaskId === 'object' && rawTaskId.$oid ? rawTaskId.$oid : null);

        if (!taskId) {
          missingTaskIds.push(String(rawTaskId));
          continue;
        }

        const order = Number.isFinite(Number(segment.order)) ? Number(segment.order) : (i + 1);
        const segType = segment.type === 'TippingRequest' ? 'TippingRequest' : 'task';

        if (segType === 'TippingRequest') {
          await TippingRequest.findByIdAndUpdate(taskId, { truckId: truck._id });
          truck.addTippingRequest(dateStr, taskId, order);
        } else {
          await Task.findByIdAndUpdate(taskId, { truckId: truck._id });
          truck.addTask(dateStr, taskId, order);
        }

        assignedCount += 1;
        assignedThisTruck += 1;
      }
      if (missingTaskIds.length) {
        console.log('[RouteOptimizer:external] truck %s: segments without valid taskId: %s', truckDisplayName(truck), missingTaskIds.join(', '));
      }
      console.log('[RouteOptimizer:external] truck %s: assigned %d tasks (total so far %d)', truckDisplayName(truck), assignedThisTruck, assignedCount);
      await truck.save();
    }
    console.log('[RouteOptimizer:external] persist done assignedCount=%d', assignedCount);

    try {
      const mockReq = { body: { date: dateStr } };
      const mockRes = { status: () => ({ json: () => {} }), json: () => {} };
      await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
    } catch (dailySheetErr) {
      console.error('Route optimizer external: daily sheet sync error', dailySheetErr);
    }

    const externalSummary = data.summary && typeof data.summary === 'object' ? data.summary : {};
    return res.status(200).json({
      success: data.success !== false,
      routes,
      api_calls_used: data.api_calls_used ?? 0,
      summary: {
        date: dateStr,
        trucks_used: Object.keys(routes).length,
        ...externalSummary,
        assigned: assignedCount,
      },
    });
  } catch (error) {
    console.error('Route optimizer external calculate-routes error:', error);
    if (isOptimizerTransportFailure(error)) {
      const { status, body } = responseFromOptimizerNetworkError(error, 'calculate-routes');
      return res.status(status).json(body);
    }
    return res.status(500).json({
      message: 'External calculate routes failed',
      error: error.response?.data || error.message,
    });
  }
}

/**
 * POST /api/route-optimizer/external/grouped-routes
 * Same flow as calculate-routes, but forwards to the external /api/v1/grouped-routes endpoint
 * which groups jobs by area before optimizing.
 * Body: { date: string|Date, truckIds?: string[], selectedTruckIds?: string[],
 *   vanCurrentCapacities?: Record<string, number> }
 * Returns: { success, routes, api_calls_used } from external API.
 */
async function calculateRoutesExternalArea(req, res) {
  try {
    const inputDate = req.body.date ? new Date(req.body.date) : new Date();
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    const dateStr = inputDate.toISOString().split('T')[0];
    const startOfDay = new Date(inputDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const requestedTruckIds = Array.isArray(req.body.truckIds)
      ? req.body.truckIds
      : Array.isArray(req.body.selectedTruckIds)
        ? req.body.selectedTruckIds
        : null;

    const hasTruckSelection = Array.isArray(requestedTruckIds) && requestedTruckIds.length > 0;

    // Use UnitAssignmentLogRange to determine which driver is on which truck for this day
    const truckQuery = hasTruckSelection ? { _id: { $in: requestedTruckIds } } : {};
    const allTrucks = await Truck.find(truckQuery).populate('vanId');

    if (hasTruckSelection && !allTrucks.length) {
      return res.status(400).json({
        message: 'No valid trucks found for provided truckIds/selectedTruckIds',
      });
    }

    const trucksWithDrivers = [];
    for (const t of allTrucks) {
      const assignment = await getAssignedForDayFromRanges(t._id, dateStr);
      if (assignment.driverId) {
        const driver = await Driver.findById(assignment.driverId).select('_id');
        if (!driver) continue;
        let helper = null;
        if (assignment.helperId) {
          helper = await Helper.findById(assignment.helperId).select('start_location end_location');
        }
        trucksWithDrivers.push({
          truck: t,
          driverId: assignment.driverId,
          assignedVanId: assignment.vanId || null,
          startLocation: helper ? toLatLngFromGeoPoint(helper.start_location) : null,
          endLocation: helper ? toLatLngFromGeoPoint(helper.end_location) : null,
        });
      }
    }

    if (!trucksWithDrivers.length) {
      return res.status(400).json({
        message: 'No trucks with drivers available for assignment',
      });
    }

    console.log('[RouteOptimizer:area] date=%s trucksWithDrivers=%d', dateStr, trucksWithDrivers.length);
    trucksWithDrivers.forEach(({ truck, driverId }, i) => {
      console.log(
        '[RouteOptimizer:area] truck[%d] _id=%s name=%s driverId=%s',
        i,
        truck._id.toString(),
        truckDisplayName(truck),
        driverId.toString()
      );
    });

    const vanIdsInScope = new Set(
      trucksWithDrivers
        .map(({ assignedVanId }) => (assignedVanId ? assignedVanId.toString() : null))
        .filter(Boolean)
    );
    const rawVanCaps = req.body.vanCurrentCapacities ?? req.body.van_current_capacities;
    const vanCapsNormalized = normalizeVanCurrentCapacitiesMap(rawVanCaps);
    const vanCapsForOptimizer = filterVanCapacitiesToScope(vanCapsNormalized, vanIdsInScope);

    const payload = {
      date: dateStr,
      truck_contexts: trucksWithDrivers.map(
        ({ truck, assignedVanId, startLocation, endLocation }) => ({
          truck_id: truck._id.toString(),
          van_id: assignedVanId ? assignedVanId.toString() : null,
          start_location: startLocation,
          end_location: endLocation,
        })
      ),
    };
    if (vanCapsForOptimizer) {
      payload.van_current_capacities = vanCapsForOptimizer;
    }
    console.log("payload", payload);
    const { data, status } = await axios.post(
      `${EXTERNAL_ROUTE_OPTIMIZER_URL}/api/v1/grouped-routes`,
      payload,
      {
        timeout: 120000,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (status !== 200) {
      if (data?.detail && Array.isArray(data.detail)) {
        console.error('[RouteOptimizer:area] validation errors (full):', JSON.stringify(data.detail, null, 2));
      } else {
        console.log(data);
      }
      return res.status(status >= 500 ? 502 : status).json({
        message: data?.detail || data?.message || 'External route optimizer request failed',
        ...(data && typeof data === 'object' && { detail: data }),
      });
    }
    console.log(data.routes);
    const routes = data.routes || {};
    const routeKeys = Object.keys(routes);
    console.log('[RouteOptimizer:area] external response route keys (%d): %s', routeKeys.length, routeKeys.join(', '));

    // Unassign tasks only for selected/considered trucks on this date so unrelated trucks are untouched.
    const consideredTruckIds = trucksWithDrivers.map(({ truck }) => truck._id);
    await Task.updateMany(
      {
        date: { $gte: startOfDay, $lte: endOfDay },
        truckId: { $in: consideredTruckIds },
      },
      { $set: { truckId: null } }
    );

    // Persist assignment: clear old routes for this date on each truck, then assign new order
    let assignedCount = 0;
    for (const routeKey of routeKeys) {
      // New response: routeKey is truck_id (Truck._id)
      const entry = trucksWithDrivers.find(({ truck }) => truck._id.toString() === routeKey);
      if (!entry) {
        console.log('[RouteOptimizer:area] routeKey=%s no truck/driver assignment matched (skip)', routeKey);
        continue;
      }
      const { truck } = entry;
      console.log(
        '[RouteOptimizer:area] routeKey=%s matched truck name=%s _id=%s (by truckId)',
        routeKey,
        truckDisplayName(truck),
        truck._id.toString()
      );
      // Remove old routes for this date so we don't duplicate tasks
      if (!truck.tasks) truck.tasks = new Map();
      truck.tasks.set(dateStr, []);
      truck.markModified('tasks');

      // New response format: routes[truckId].route_segments is an array of objects:
      // { taskId, type, order, ... }
      const routeSegments = Array.isArray(routes[routeKey].route_segments)
        ? routes[routeKey].route_segments
        : [];
      let assignedThisTruck = 0;
      const missingTaskIds = [];
      for (let i = 0; i < routeSegments.length; i++) {
        const segment = routeSegments[i];
        if (!segment || typeof segment !== 'object') continue;

        const rawTaskId = segment.taskId;
        const taskId = typeof rawTaskId === 'string'
          ? rawTaskId
          : (rawTaskId && typeof rawTaskId === 'object' && rawTaskId.$oid ? rawTaskId.$oid : null);

        if (!taskId) {
          missingTaskIds.push(String(rawTaskId));
          continue;
        }

        const order = Number.isFinite(Number(segment.order)) ? Number(segment.order) : (i + 1);
        const segType = segment.type === 'TippingRequest' ? 'TippingRequest' : 'task';

        if (segType === 'TippingRequest') {
          await TippingRequest.findByIdAndUpdate(taskId, { truckId: truck._id });
          truck.addTippingRequest(dateStr, taskId, order);
        } else {
          await Task.findByIdAndUpdate(taskId, { truckId: truck._id });
          truck.addTask(dateStr, taskId, order);
        }

        assignedCount += 1;
        assignedThisTruck += 1;
      }
      if (missingTaskIds.length) {
        console.log('[RouteOptimizer:area] truck %s: segments without valid taskId: %s', truckDisplayName(truck), missingTaskIds.join(', '));
      }
      console.log('[RouteOptimizer:area] truck %s: assigned %d tasks (total so far %d)', truckDisplayName(truck), assignedThisTruck, assignedCount);
      await truck.save();
    }
    console.log('[RouteOptimizer:area] persist done assignedCount=%d', assignedCount);

    try {
      const mockReq = { body: { date: dateStr } };
      const mockRes = { status: () => ({ json: () => {} }), json: () => {} };
      await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
    } catch (dailySheetErr) {
      console.error('Route optimizer area: daily sheet sync error', dailySheetErr);
    }

    const externalSummary = data.summary && typeof data.summary === 'object' ? data.summary : {};
    return res.status(200).json({
      success: data.success !== false,
      routes,
      api_calls_used: data.api_calls_used ?? 0,
      summary: {
        date: dateStr,
        trucks_used: Object.keys(routes).length,
        ...externalSummary,
        assigned: assignedCount,
      },
    });
  } catch (error) {
    console.error('Route optimizer external grouped-routes error:', error);
    if (isOptimizerTransportFailure(error)) {
      const { status, body } = responseFromOptimizerNetworkError(error, 'grouped-routes');
      return res.status(status).json(body);
    }
    return res.status(500).json({
      message: 'External grouped routes failed',
      error: error.response?.data || error.message,
    });
  }
}

/**
 * POST /api/route-optimizer/external/calculate-routes-groups
 * Client sends manual job groups (not grouped by truck).
 * Calls external POST /api/v1/custom; assigns groups to trucks and persists routes.
 *
 * Body: {
 *   date: string|Date,
 *   truckIds?: string[],
 *   selectedTruckIds?: string[],
 *   vanCurrentCapacities?: Record<string, number>,
 *   jobGroups?: [{ groupId?, jobs?: string[]|object[], segments?, taskIds?, ... }],
 *   groups?: [...],  // alias for jobGroups
 *   jobs?: [[taskId, ...], ...] | [{ groupId?, jobs: [...] }, ...]
 * }
 */
async function calculateRoutesExternalWithGroups(req, res) {
  try {
    const parsed = parseRouteOptimizerDate(req.body.date);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }
    const { dateStr, startOfDay, endOfDay } = parsed;

    const jobGroups = normalizeJobGroupsFromBody(req.body);
    if (!jobGroups.length) {
      return res.status(400).json({
        message:
          'Manual job groups are required. Send jobGroups, groups, or jobs (array of job-id arrays).',
      });
    }

    const requestedTruckIds = Array.isArray(req.body.truckIds)
      ? req.body.truckIds
      : Array.isArray(req.body.selectedTruckIds)
        ? req.body.selectedTruckIds
        : null;

    const loaded = await loadTrucksWithDriversForDate({ dateStr, requestedTruckIds });
    if (!loaded.ok) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    const { trucksWithDrivers } = loaded;
    const trucksInScope = trucksWithDrivers;

    console.log(
      '[RouteOptimizer:groups] date=%s jobGroups=%d trucks=%d',
      dateStr,
      jobGroups.length,
      trucksInScope.length
    );

    const vanIdsInScope = new Set(
      trucksInScope
        .map(({ assignedVanId }) => (assignedVanId ? assignedVanId.toString() : null))
        .filter(Boolean)
    );
    const rawVanCaps = req.body.vanCurrentCapacities ?? req.body.van_current_capacities;
    const vanCapsNormalized = normalizeVanCurrentCapacitiesMap(rawVanCaps);
    const vanCapsForOptimizer = filterVanCapacitiesToScope(vanCapsNormalized, vanIdsInScope);

    /** @type {Array<{ group_id: string, jobs: object[] }>} */
    const job_groups = [];

    for (const group of jobGroups) {
      const { jobs, skipped } = await buildOptimizerJobsFromSegments(
        group.segments,
        `[routeGroups:build:${group.groupId}]`
      );
      if (!jobs.length) {
        return res.status(400).json({
          message: `Group "${group.groupId}" has no jobs with coordinates`,
          skipped,
          groupId: group.groupId,
        });
      }
      job_groups.push({
        group_id: group.groupId,
        jobs,
      });
    }

    const payload = {
      date: dateStr,
      truck_contexts: trucksInScope.map(
        ({ truck, assignedVanId, startLocation, endLocation }) => ({
          truck_id: truck._id.toString(),
          van_id: assignedVanId ? assignedVanId.toString() : null,
          start_location: startLocation,
          end_location: endLocation,
        })
      ),
      job_groups,
    };
    if (vanCapsForOptimizer) {
      payload.van_current_capacities = vanCapsForOptimizer;
    }
    console.log("payload", payload);
    let routes = {};
    let apiCallsUsed = 0;
    let optimizerMode = 'custom';
    let externalSuccess = true;
    /** @type {Record<string, unknown>} */
    let externalSummary = {};

    const tryExternal = async (url) => {
      const { data, status } = await axios.post(url, payload, {
        timeout: 120000,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' },
      });
      return { data, status, url };
    };

    const groupsUrl = `${EXTERNAL_ROUTE_OPTIMIZER_URL}${EXTERNAL_ROUTE_GROUPS_API_PATH}`;
    let { data, status, url: usedUrl } = await tryExternal(groupsUrl);

    const hasRoutes = data != null && data.routes != null && typeof data.routes === 'object';
    const externalOk = hasRoutes && (status === 200 || data.success === true);

    if (externalOk) {
      routes = data.routes;
      apiCallsUsed = data.api_calls_used ?? 0;
      externalSuccess = data.success !== false;
      externalSummary =
        data.summary && typeof data.summary === 'object' ? data.summary : {};
      console.log('[RouteOptimizer:groups] external OK via %s', usedUrl);
    } else if (status === 404 || status === 405 || status === 422) {
      optimizerMode = 'per-group-recalculate-distributed';
      console.log(
        '[RouteOptimizer:groups] %s unavailable (HTTP %s), local fallback',
        groupsUrl,
        status
      );

      const groupsByTruck = distributeJobGroupsAcrossTrucks(jobGroups, trucksInScope);
      for (const entry of trucksInScope) {
        const truckId = entry.truck._id.toString();
        const groups = groupsByTruck.get(truckId) || [];
        if (!groups.length) {
          routes[truckId] = { route_segments: [] };
          continue;
        }
        routes[truckId] = await optimizeTruckGroupsLocally({
          truckEntry: entry,
          dateStr,
          groups,
        });
        apiCallsUsed += groups.length;
      }
    } else {
      if (data?.detail && Array.isArray(data.detail)) {
        console.error(
          '[RouteOptimizer:groups] validation errors:',
          JSON.stringify(data.detail, null, 2)
        );
      }
      return res.status(status >= 500 ? 502 : status).json({
        message:
          data?.detail ||
          data?.message ||
          'External route optimizer (custom / groups) request failed',
        ...(data && typeof data === 'object' && { detail: data }),
      });
    }

    const routeTruckIds = new Set(Object.keys(routes));
    const trucksToPersist = trucksInScope.filter(({ truck }) =>
      routeTruckIds.has(truck._id.toString())
    );

    const assignedCount = await persistExternalRoutes({
      trucksWithDrivers: trucksToPersist.length ? trucksToPersist : trucksInScope,
      routes,
      dateStr,
      startOfDay,
      endOfDay,
      logScope: 'groups',
    });

    return res.status(200).json({
      success: externalSuccess,
      routes,
      job_groups: job_groups.map((g) => g.group_id),
      api_calls_used: apiCallsUsed,
      optimizerMode,
      summary: {
        date: dateStr,
        job_groups: job_groups.length,
        trucks_used: Object.keys(routes).length,
        ...externalSummary,
        assigned: assignedCount,
      },
    });
  } catch (error) {
    console.error('Route optimizer external calculate-routes-groups (custom) error:', error);
    if (error.status && error.groupId) {
      return res.status(error.status).json({
        message: error.message,
        truckId: error.truckId,
        groupId: error.groupId,
        detail: error.detail,
      });
    }
    if (isOptimizerTransportFailure(error)) {
      const { status, body } = responseFromOptimizerNetworkError(
        error,
        'calculate-routes-groups'
      );
      return res.status(status).json(body);
    }
    return res.status(500).json({
      message: 'External calculate routes (groups) failed',
      error: error.response?.data || error.message,
    });
  }
}

/**
 * POST /api/route-optimizer/external/recalculate-truck
 * Body: { date: string|Date, truckId: string, persist?: boolean (default true) }
 * Reads Truck.tasks[date] (tasks + TippingRequest order), builds jobs with coords, order, type (task|TippingRequest),
 * calls external POST .../api/v1/recalculate-route for this truck only, returns routes[truckId]. Optionally persists new order on the truck.
 */
async function recalculateTruckRoute(req, res) {
  try {
    const { truckId, date: bodyDate, persist = true } = req.body;
    if (!truckId) {
      return res.status(400).json({ message: 'truckId is required in body' });
    }
    if (!bodyDate) {
      return res.status(400).json({ message: 'date is required in body' });
    }

    const inputDate = new Date(bodyDate);
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
    const dateStr = inputDate.toISOString().split('T')[0];

    const truck = await Truck.findById(truckId);
    if (!truck) {
      return res.status(404).json({ message: 'Truck not found' });
    }

    if (!truck.tasks || !truck.tasks.has(dateStr)) {
      return res.status(400).json({
        message: 'No saved route for this truck on the given date',
        truckId: truck._id.toString(),
        date: dateStr,
      });
    }

    let segments = [...truck.tasks.get(dateStr)].map(plainTruckRouteSegment);
    segments.sort((a, b) => (a.order || 0) - (b.order || 0));

    if (!segments.length) {
      return res.status(400).json({
        message: 'Route list is empty for this date',
        truckId: truck._id.toString(),
        date: dateStr,
      });
    }

    const jobs = [];
    const skipped = [];
    const routeKey = truck._id.toString();
    const logPrefix = '[recalculateTruckRoute]';

    console.log(logPrefix, 'build jobs', {
      truckId: routeKey,
      date: dateStr,
      segmentCount: segments.length,
      segmentsPreview: segments.map((s, i) => ({
        index: i,
        order: s.order,
        type: s.type,
        taskId: normalizeMongoId(s.taskId),
        taskIdRawType: s.taskId == null ? 'nullish' : typeof s.taskId,
      })),
    });

    for (let segIndex = 0; segIndex < segments.length; segIndex++) {
      const seg = segments[segIndex];
      const idStr = normalizeMongoId(seg.taskId);
      if (!idStr) {
        console.warn(logPrefix, 'skip segment: missing taskId', {
          segIndex,
          order: seg.order,
          type: seg.type,
          keys: seg && typeof seg === 'object' ? Object.keys(seg) : [],
          taskIdValue: seg.taskId,
        });
        skipped.push({ segment: seg, reason: 'missing taskId' });
        continue;
      }
      const isTip = seg.type === 'TippingRequest';
      const order = Number.isFinite(Number(seg.order)) ? Number(seg.order) : segIndex + 1;
      const type = isTip ? 'TippingRequest' : 'task';

      if (isTip) {
        const tip = await TippingRequest.findById(idStr).populate('tippingPlace');
        const coords = tip?.tippingPlace?.location?.coordinates;
        if (!coords || coords.length < 2) {
          const placeId =
            tip?.tippingPlace?._id != null
              ? String(tip.tippingPlace._id)
              : tip?.tippingPlace != null
                ? String(tip.tippingPlace)
                : null;
          console.warn(logPrefix, 'skip TippingRequest: no coordinates', {
            tippingRequestId: idStr,
            tippingRequestFound: !!tip,
            tippingPlaceId: placeId,
            tippingPlacePopulated: !!(tip && tip.tippingPlace && typeof tip.tippingPlace === 'object'),
            coordinates: coords,
            locationKeys:
              tip?.tippingPlace?.location && typeof tip.tippingPlace.location === 'object'
                ? Object.keys(tip.tippingPlace.location)
                : [],
          });
          skipped.push({ taskId: idStr, type: 'TippingRequest', reason: 'no tipping place coordinates' });
          continue;
        }
        jobs.push({
          job_id: idStr,
          lat: coords[1],
          lng: coords[0],
          order,
          type,
        });
      } else {
        const task = await Task.findById(idStr);
        const coords = task?.location?.coordinates;
        if (!coords || coords.length < 2) {
          console.warn(logPrefix, 'skip task: no coordinates', {
            taskId: idStr,
            taskFound: !!task,
            coordinates: coords,
            locationKeys:
              task?.location && typeof task.location === 'object' ? Object.keys(task.location) : [],
          });
          skipped.push({ taskId: idStr, type: 'task', reason: 'no task location coordinates' });
          continue;
        }
        jobs.push({
          job_id: idStr,
          lat: coords[1],
          lng: coords[0],
          taskDuration:
            typeof task.taskDuration === 'number' && task.taskDuration >= 0 ? task.taskDuration : 10,
          spaceOfVan:
            typeof task.spaceOfVan === 'number' && task.spaceOfVan >= 0 ? task.spaceOfVan : 0,
          order,
          type,
        });
      }
    }

    if (!jobs.length) {
      const skipReasons = skipped.reduce((acc, s) => {
        const r = s.reason || 'unknown';
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {});
      console.warn(logPrefix, 'no jobs with coordinates — returning 400', {
        truckId: routeKey,
        date: dateStr,
        jobsBuilt: jobs.length,
        skippedCount: skipped.length,
        skipReasons,
        skipped,
      });
      return res.status(400).json({
        message: 'No jobs with coordinates to optimize (check tasks and tipping places)',
        skipped,
        truckId: truck._id.toString(),
        date: dateStr,
      });
    }

    const assignment = await getAssignedForDayFromRanges(truck._id, dateStr);
    let helper = null;
    if (assignment.helperId) {
      helper = await Helper.findById(assignment.helperId).select('start_location end_location');
    }

    const payload = {
      jobs,
      date: dateStr,
      truck_contexts: [
        {
          van_id: assignment.vanId ? assignment.vanId.toString() : null,
          truck_id: truck._id.toString(),
          start_location: helper ? toLatLngFromGeoPoint(helper.start_location) : null,
          end_location: helper ? toLatLngFromGeoPoint(helper.end_location) : null,
        },
      ],
    };

    const optimizerUrl = `${EXTERNAL_ROUTE_OPTIMIZER_URL}/api/v1/recalculate-route2`;
    const startedAtMs = Date.now();
    const { data, status, headers: responseHeaders } = await axios.post(optimizerUrl, payload, {
      timeout: 120000,
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' },
    });
    const elapsedMs = Date.now() - startedAtMs;

    const responseBodyPreview =
      typeof data === 'string'
        ? data
        : JSON.stringify(data);

    console.log(logPrefix, 'optimizer API response', {
      url: optimizerUrl,
      httpStatus: status,
      elapsedMs,
      responseHeaders,
      body: data,
      bodyPreview: responseBodyPreview && responseBodyPreview.length > 4000
        ? `${responseBodyPreview.slice(0, 4000)}...[truncated]`
        : responseBodyPreview,
    });

    if (status !== 200) {
      return res.status(status >= 500 ? 502 : status).json({
        message: data?.detail || data?.message || 'External route optimizer request failed',
        ...(data && typeof data === 'object' && { detail: data }),
      });
    }

    const hasSingularRouteShape = data && typeof data.route === 'object' && data.route !== null;
    const hasPluralRoutesShape = data && typeof data.routes === 'object' && data.routes !== null;

    if (!hasSingularRouteShape && !hasPluralRoutesShape) {
      return res.status(502).json({
        message: 'External route optimizer response shape is invalid (expected route or routes)',
        detail: data,
      });
    }

    const routes = hasPluralRoutesShape ? data.routes : {};
    const truckRoute = hasSingularRouteShape
      ? data.route
      : (routes[routeKey] || null);

    let persisted = false;
    if (persist !== false && truckRoute && Array.isArray(truckRoute.route_segments)) {
      if (!truck.tasks) truck.tasks = new Map();
      truck.tasks.set(dateStr, []);
      truck.markModified('tasks');

      const routeSegments = truckRoute.route_segments;
      for (let i = 0; i < routeSegments.length; i++) {
        const segment = routeSegments[i];
        if (!segment || typeof segment !== 'object') continue;

        const rawTaskId = segment.taskId;
        const taskIdStr =
          typeof rawTaskId === 'string'
            ? rawTaskId
            : rawTaskId && typeof rawTaskId === 'object' && rawTaskId.$oid
              ? rawTaskId.$oid
              : rawTaskId && typeof rawTaskId.toString === 'function'
                ? rawTaskId.toString()
                : null;
        if (!taskIdStr) continue;

        const order = Number.isFinite(Number(segment.order)) ? Number(segment.order) : i + 1;
        const segType = segment.type === 'TippingRequest' ? 'TippingRequest' : 'task';

        if (segType === 'TippingRequest') {
          await TippingRequest.findByIdAndUpdate(taskIdStr, { truckId: truck._id });
          truck.addTippingRequest(dateStr, taskIdStr, order);
        } else {
          await Task.findByIdAndUpdate(taskIdStr, { truckId: truck._id });
          truck.addTask(dateStr, taskIdStr, order);
        }
      }
      await truck.save();
      persisted = true;

      try {
        const mockReq = { body: { date: dateStr } };
        const mockRes = { status: () => ({ json: () => {} }), json: () => {} };
        await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
      } catch (dailySheetErr) {
        console.error('Route optimizer recalculate-truck: daily sheet sync error', dailySheetErr);
      }
    }

    return res.status(200).json({
      success: data.success !== false,
      truckId: routeKey,
      date: dateStr,
      payload_jobs_count: jobs.length,
      skipped,
      persisted,
      route: truckRoute,
      routes: hasPluralRoutesShape
        ? routes
        : { [routeKey]: truckRoute },
      api_calls_used: data.api_calls_used ?? 0,
      summary: data.summary && typeof data.summary === 'object' ? data.summary : undefined,
    });
  } catch (error) {
    console.error('Route optimizer recalculate-truck error:', error);
    if (isOptimizerTransportFailure(error)) {
      const { status, body } = responseFromOptimizerNetworkError(error, 'recalculate-truck');
      return res.status(status).json(body);
    }
    return res.status(500).json({
      message: 'Recalculate truck route failed',
      error: error.response?.data || error.message,
    });
  }
}

/**
 * POST /api/route-optimizer/external/recalculate-truck
 * Body: { date: string|Date, truckId: string, persist?: boolean (default true) }
 * Reads Truck.tasks[date] (tasks + TippingRequest order), builds jobs with coords, order, type (task|TippingRequest),
 * calls external POST .../api/v1/recalculate-route for this truck only, returns routes[truckId]. Optionally persists new order on the truck.
 */
async function refreshRoute(req, res) {
  try {
    const { truckId, date: bodyDate, persist = true } = req.body;
    if (!truckId) {
      return res.status(400).json({ message: 'truckId is required in body' });
    }
    if (!bodyDate) {
      return res.status(400).json({ message: 'date is required in body' });
    }

    const inputDate = new Date(bodyDate);
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
    const dateStr = inputDate.toISOString().split('T')[0];

    const truck = await Truck.findById(truckId);
    if (!truck) {
      return res.status(404).json({ message: 'Truck not found' });
    }

    if (!truck.tasks || !truck.tasks.has(dateStr)) {
      return res.status(400).json({
        message: 'No saved route for this truck on the given date',
        truckId: truck._id.toString(),
        date: dateStr,
      });
    }

    let segments = [...truck.tasks.get(dateStr)].map(plainTruckRouteSegment);
    segments.sort((a, b) => (a.order || 0) - (b.order || 0));

    if (!segments.length) {
      return res.status(400).json({
        message: 'Route list is empty for this date',
        truckId: truck._id.toString(),
        date: dateStr,
      });
    }

    const jobs = [];
    const skipped = [];
    const routeKey = truck._id.toString();
    const logPrefix = '[recalculateTruckRoute]';

    console.log(logPrefix, 'build jobs', {
      truckId: routeKey,
      date: dateStr,
      segmentCount: segments.length,
      segmentsPreview: segments.map((s, i) => ({
        index: i,
        order: s.order,
        type: s.type,
        taskId: normalizeMongoId(s.taskId),
        taskIdRawType: s.taskId == null ? 'nullish' : typeof s.taskId,
      })),
    });

    for (let segIndex = 0; segIndex < segments.length; segIndex++) {
      const seg = segments[segIndex];
      const idStr = normalizeMongoId(seg.taskId);
      if (!idStr) {
        console.warn(logPrefix, 'skip segment: missing taskId', {
          segIndex,
          order: seg.order,
          type: seg.type,
          keys: seg && typeof seg === 'object' ? Object.keys(seg) : [],
          taskIdValue: seg.taskId,
        });
        skipped.push({ segment: seg, reason: 'missing taskId' });
        continue;
      }
      const isTip = seg.type === 'TippingRequest';
      const order = Number.isFinite(Number(seg.order)) ? Number(seg.order) : segIndex + 1;
      const type = isTip ? 'TippingRequest' : 'task';

      if (isTip) {
        const tip = await TippingRequest.findById(idStr).populate('tippingPlace');
        const coords = tip?.tippingPlace?.location?.coordinates;
        if (!coords || coords.length < 2) {
          const placeId =
            tip?.tippingPlace?._id != null
              ? String(tip.tippingPlace._id)
              : tip?.tippingPlace != null
                ? String(tip.tippingPlace)
                : null;
          console.warn(logPrefix, 'skip TippingRequest: no coordinates', {
            tippingRequestId: idStr,
            tippingRequestFound: !!tip,
            tippingPlaceId: placeId,
            tippingPlacePopulated: !!(tip && tip.tippingPlace && typeof tip.tippingPlace === 'object'),
            coordinates: coords,
            locationKeys:
              tip?.tippingPlace?.location && typeof tip.tippingPlace.location === 'object'
                ? Object.keys(tip.tippingPlace.location)
                : [],
          });
          skipped.push({ taskId: idStr, type: 'TippingRequest', reason: 'no tipping place coordinates' });
          continue;
        }
        jobs.push({
          job_id: idStr,
          lat: coords[1],
          lng: coords[0],
          order,
          type,
        });
      } else {
        const task = await Task.findById(idStr);
        const coords = task?.location?.coordinates;
        if (!coords || coords.length < 2) {
          console.warn(logPrefix, 'skip task: no coordinates', {
            taskId: idStr,
            taskFound: !!task,
            coordinates: coords,
            locationKeys:
              task?.location && typeof task.location === 'object' ? Object.keys(task.location) : [],
          });
          skipped.push({ taskId: idStr, type: 'task', reason: 'no task location coordinates' });
          continue;
        }
        jobs.push({
          job_id: idStr,
          lat: coords[1],
          lng: coords[0],
          taskDuration:
            typeof task.taskDuration === 'number' && task.taskDuration >= 0 ? task.taskDuration : 10,
          spaceOfVan:
            typeof task.spaceOfVan === 'number' && task.spaceOfVan >= 0 ? task.spaceOfVan : 0,
          order,
          type,
        });
      }
    }

    if (!jobs.length) {
      const skipReasons = skipped.reduce((acc, s) => {
        const r = s.reason || 'unknown';
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {});
      console.warn(logPrefix, 'no jobs with coordinates — returning 400', {
        truckId: routeKey,
        date: dateStr,
        jobsBuilt: jobs.length,
        skippedCount: skipped.length,
        skipReasons,
        skipped,
      });
      return res.status(400).json({
        message: 'No jobs with coordinates to optimize (check tasks and tipping places)',
        skipped,
        truckId: truck._id.toString(),
        date: dateStr,
      });
    }

    const assignment = await getAssignedForDayFromRanges(truck._id, dateStr);
    let helper = null;
    if (assignment.helperId) {
      helper = await Helper.findById(assignment.helperId).select('start_location end_location');
    }

    const payload = {
      jobs,
      date: dateStr,
      truck_contexts: [
        {
          van_id: assignment.vanId ? assignment.vanId.toString() : null,
          truck_id: truck._id.toString(),
          start_location: helper ? toLatLngFromGeoPoint(helper.start_location) : null,
          end_location: helper ? toLatLngFromGeoPoint(helper.end_location) : null,
        },
      ],
    };

    const optimizerUrl = `${EXTERNAL_ROUTE_OPTIMIZER_URL}/api/v1/recalculate-route`;
    const startedAtMs = Date.now();
    const { data, status, headers: responseHeaders } = await axios.post(optimizerUrl, payload, {
      timeout: 120000,
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' },
    });
    const elapsedMs = Date.now() - startedAtMs;

    const responseBodyPreview =
      typeof data === 'string'
        ? data
        : JSON.stringify(data);

    console.log(logPrefix, 'optimizer API response', {
      url: optimizerUrl,
      httpStatus: status,
      elapsedMs,
      responseHeaders,
      body: data,
      bodyPreview: responseBodyPreview && responseBodyPreview.length > 4000
        ? `${responseBodyPreview.slice(0, 4000)}...[truncated]`
        : responseBodyPreview,
    });

    if (status !== 200) {
      return res.status(status >= 500 ? 502 : status).json({
        message: data?.detail || data?.message || 'External route optimizer request failed',
        ...(data && typeof data === 'object' && { detail: data }),
      });
    }

    const hasSingularRouteShape = data && typeof data.route === 'object' && data.route !== null;
    const hasPluralRoutesShape = data && typeof data.routes === 'object' && data.routes !== null;

    if (!hasSingularRouteShape && !hasPluralRoutesShape) {
      return res.status(502).json({
        message: 'External route optimizer response shape is invalid (expected route or routes)',
        detail: data,
      });
    }

    const routes = hasPluralRoutesShape ? data.routes : {};
    const truckRoute = hasSingularRouteShape
      ? data.route
      : (routes[routeKey] || null);

    let persisted = false;
    if (persist !== false && truckRoute && Array.isArray(truckRoute.route_segments)) {
      if (!truck.tasks) truck.tasks = new Map();
      truck.tasks.set(dateStr, []);
      truck.markModified('tasks');

      const routeSegments = truckRoute.route_segments;
      for (let i = 0; i < routeSegments.length; i++) {
        const segment = routeSegments[i];
        if (!segment || typeof segment !== 'object') continue;

        const rawTaskId = segment.taskId;
        const taskIdStr =
          typeof rawTaskId === 'string'
            ? rawTaskId
            : rawTaskId && typeof rawTaskId === 'object' && rawTaskId.$oid
              ? rawTaskId.$oid
              : rawTaskId && typeof rawTaskId.toString === 'function'
                ? rawTaskId.toString()
                : null;
        if (!taskIdStr) continue;

        const order = Number.isFinite(Number(segment.order)) ? Number(segment.order) : i + 1;
        const segType = segment.type === 'TippingRequest' ? 'TippingRequest' : 'task';

        if (segType === 'TippingRequest') {
          await TippingRequest.findByIdAndUpdate(taskIdStr, { truckId: truck._id });
          truck.addTippingRequest(dateStr, taskIdStr, order);
        } else {
          await Task.findByIdAndUpdate(taskIdStr, { truckId: truck._id });
          truck.addTask(dateStr, taskIdStr, order);
        }
      }
      await truck.save();
      persisted = true;

      try {
        const mockReq = { body: { date: dateStr } };
        const mockRes = { status: () => ({ json: () => {} }), json: () => {} };
        await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
      } catch (dailySheetErr) {
        console.error('Route optimizer recalculate-truck: daily sheet sync error', dailySheetErr);
      }
    }

    return res.status(200).json({
      success: data.success !== false,
      truckId: routeKey,
      date: dateStr,
      payload_jobs_count: jobs.length,
      skipped,
      persisted,
      route: truckRoute,
      routes: hasPluralRoutesShape
        ? routes
        : { [routeKey]: truckRoute },
      api_calls_used: data.api_calls_used ?? 0,
      summary: data.summary && typeof data.summary === 'object' ? data.summary : undefined,
    });
  } catch (error) {
    console.error('Route optimizer recalculate-truck error:', error);
    if (isOptimizerTransportFailure(error)) {
      const { status, body } = responseFromOptimizerNetworkError(error, 'recalculate-truck');
      return res.status(status).json(body);
    }
    return res.status(500).json({
      message: 'Recalculate truck route failed',
      error: error.response?.data || error.message,
    });
  }
}


/**
 * POST /api/route-optimizer/external/request-tipping
 * Body: {
 *   driverId?: string,
 *   driver_id?: string,
 *   jobs_date: string,
 * }
 * Computes truck/van + remaining jobs + last completed job location from DB, then forwards
 * to external request-tipping API and returns best tipping place suggestion.
 */
async function requestBestTippingPlace(req, res) {
  try {
    const { driverId, driver_id, jobs_date } = req.body || {};
    const resolvedDriverId = driverId || driver_id;
    if (!resolvedDriverId || !jobs_date) {
      return res.status(400).json({
        message: 'driverId (or driver_id) and jobs_date are required',
      });
    }

    const inputDate = new Date(jobs_date);
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ message: 'Invalid jobs_date format' });
    }
    const dateStr = inputDate.toISOString().split('T')[0];

    let selectedTruck = null;
    let selectedAssignment = null;
    const allTrucks = await Truck.find({});

    for (const truck of allTrucks) {
      const assignment = await getAssignedForDayFromRanges(truck._id, dateStr);
      if (assignment.driverId && assignment.driverId.toString() === String(resolvedDriverId)) {
        selectedTruck = truck;
        selectedAssignment = assignment;
        break;
      }
    }

    if (!selectedTruck) {
      selectedTruck = await Truck.findOne({ driverId: resolvedDriverId });
      if (selectedTruck) {
        selectedAssignment = await getAssignedForDayFromRanges(selectedTruck._id, dateStr);
      }
    }

    if (!selectedTruck) {
      return res.status(404).json({
        message: 'No truck/unit found for this driver on the provided date',
      });
    }

    const routeSegments = selectedTruck.tasks && selectedTruck.tasks.has(dateStr)
      ? [...selectedTruck.tasks.get(dateStr)].map(plainTruckRouteSegment)
      : [];

    routeSegments.sort((a, b) => (a.order || 0) - (b.order || 0));

    if (!routeSegments.length) {
      return res.status(400).json({
        message: 'No route segments found for this unit on the provided date',
        truck_id: selectedTruck._id.toString(),
        jobs_date: dateStr,
      });
    }

    const remainingJobs = [];
    const completedJobs = [];
    const skipped = [];

    for (let idx = 0; idx < routeSegments.length; idx++) {
      const seg = routeSegments[idx];
      const jobId = normalizeMongoId(seg.taskId);
      if (!jobId) continue;
      const order = Number.isFinite(Number(seg.order)) ? Number(seg.order) : idx + 1;

      if (seg.type === 'TippingRequest') {
        const tip = await TippingRequest.findById(jobId).populate('tippingPlace', 'location');
        const coords = tip?.tippingPlace?.location?.coordinates;
        if (!coords || coords.length < 2) {
          skipped.push({ job_id: jobId, type: 'TippingRequest', reason: 'missing tipping place coordinates' });
          continue;
        }
        const isCompleted = tip.isShipped === true;
        const job = {
          job_id: jobId,
          lat: Number(coords[1]),
          lng: Number(coords[0]),
          taskDuration: 0,
          order,
          type: 'TippingRequest',
        };
        if (isCompleted) {
          completedJobs.push(job);
        } else {
          remainingJobs.push(job);
        }
      } else {
        const task = await Task.findById(jobId).select('location taskDuration priority available taskStatus');
        const coords = task?.location?.coordinates;
        if (!coords || coords.length < 2) {
          skipped.push({ job_id: jobId, type: 'task', reason: 'missing task coordinates' });
          continue;
        }
        const status = task.taskStatus;
        const isCompleted = status === 'Completed';
        const isRemaining = status !== 'Completed' && status !== 'Declined';

        const job = {
          job_id: jobId,
          lat: Number(coords[1]),
          lng: Number(coords[0]),
          taskDuration: Number.isFinite(Number(task.taskDuration)) ? Number(task.taskDuration) : 10,
          order,
          type: 'task',
          priority: task.priority || undefined,
          time_slot: task.available || undefined,
        };

        if (isCompleted) {
          completedJobs.push(job);
        }
        if (isRemaining) {
          remainingJobs.push(job);
        }
      }
    }

    completedJobs.sort((a, b) => (a.order || 0) - (b.order || 0));
    const lastCompleted = completedJobs.length ? completedJobs[completedJobs.length - 1] : null;

    if (!remainingJobs.length) {
      return res.status(400).json({
        message: 'No remaining jobs found for this unit on the provided date',
        truck_id: selectedTruck._id.toString(),
        jobs_date: dateStr,
        skipped,
      });
    }

    let lastCompletedJobLocation = null;
    if (lastCompleted) {
      lastCompletedJobLocation = {
        lat: Number(lastCompleted.lat),
        lng: Number(lastCompleted.lng),
      };
    } else if (selectedAssignment?.helperId) {
      const helper = await Helper.findById(selectedAssignment.helperId).select('start_location');
      const helperStart = helper ? toLatLngFromGeoPoint(helper.start_location) : null;
      if (helperStart) {
        lastCompletedJobLocation = {
          lat: Number(helperStart.lat),
          lng: Number(helperStart.lng),
        };
      }
    }

    // External API requires an object, not null.
    // If no completed job exists yet, fallback to first remaining job location.
    if (!lastCompletedJobLocation && remainingJobs.length) {
      lastCompletedJobLocation = {
        lat: Number(remainingJobs[0].lat),
        lng: Number(remainingJobs[0].lng),
      };
    }

    const payload = {
      truck_id: selectedTruck._id.toString(),
      van_id: selectedAssignment?.vanId
        ? selectedAssignment.vanId.toString()
        : selectedTruck.vanId
          ? selectedTruck.vanId.toString()
          : null,
      jobs_date: dateStr,
      remaining_jobs: remainingJobs,
      last_completed_job_location: lastCompletedJobLocation,
    };

    const { data, status } = await axios.post(
      `${EXTERNAL_ROUTE_OPTIMIZER_URL}/api/v1/request-tipping`,
      payload,
      {
        timeout: 120000,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (status !== 200) {
      return res.status(status >= 500 ? 502 : status).json({
        message: data?.detail || data?.message || 'External request-tipping failed',
        ...(data && typeof data === 'object' && { detail: data }),
      });
    }

    return res.status(200).json({
      success: data?.success !== false,
      payload,
      best_tipping_place: data?.best_tipping_place ?? data?.tipping_place ?? data?.data ?? null,
      raw: data,
    });
  } catch (error) {
    console.error('Route optimizer request-tipping error:', error);
    if (isOptimizerTransportFailure(error)) {
      const { status, body } = responseFromOptimizerNetworkError(error, 'request-tipping');
      return res.status(status).json(body);
    }
    return res.status(500).json({
      message: 'Best tipping place request failed',
      error: error.response?.data || error.message,
    });
  }
}

/**
 * POST /api/route-optimizer/external/compare-route-previews
 * Calls external POST /api/v1/compare-routes (auto + custom in one call), stores two previews (no DB assign).
 * Falls back to parallel /calculate-routes + /custom if compare-routes is unavailable.
 * Body: { date, truckIds?, jobGroups|groups|jobs, vanCurrentCapacities?, respectTimeSlots? }
 */
async function compareRoutePreviews(req, res) {
  try {
    await expireStaleRouteProposals();

    const parsed = parseRouteOptimizerDate(req.body.date);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }
    const { dateStr } = parsed;

    const jobGroups = normalizeJobGroupsFromBody(req.body);
    if (!jobGroups.length) {
      return res.status(400).json({
        message:
          'Manual job groups are required. Send jobGroups, groups, or jobs (array of job-id arrays).',
      });
    }

    const requestedTruckIds = Array.isArray(req.body.truckIds)
      ? req.body.truckIds
      : Array.isArray(req.body.selectedTruckIds)
        ? req.body.selectedTruckIds
        : null;

    const loaded = await loadTrucksWithDriversForDate({ dateStr, requestedTruckIds });
    if (!loaded.ok) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    const { trucksWithDrivers } = loaded;
    const trucksInScope = trucksWithDrivers;
    const truckIds = trucksInScope.map(({ truck }) => truck._id);

    const builtGroups = await buildJobGroupsForPayload(jobGroups, '[comparePreviews]');
    if (!builtGroups.ok) {
      return res.status(400).json({
        message: builtGroups.message,
        skipped: builtGroups.skipped,
        groupId: builtGroups.groupId,
      });
    }

    const vanCapsForOptimizer = buildVanCapsForTrucks(req.body, trucksInScope);
    const truck_contexts = buildTruckContextsPayload(trucksInScope);
    const basePayload = attachVanCapsToPayload(
      {
        date: dateStr,
        truck_contexts,
      },
      vanCapsForOptimizer
    );

    console.log(
      '[RouteOptimizer:compare] date=%s jobGroups=%d trucks=%d',
      dateStr,
      builtGroups.job_groups.length,
      trucksInScope.length
    );

    let externalComparison = null;
    let compareMode = 'compare-routes';
    /** @type {{ ok: boolean, routes?: object, error?: string, detail?: unknown, optimizerMode?: string, apiCallsUsed?: number, externalSummary?: object, fleetTotalDurationMin?: number|null, fleetTotalDurationDisplay?: string|null }} */
    let autoResult;
    /** @type {typeof autoResult} */
    let customResult;

    const compareBundle = await resolveCompareRoutesExternal({
      dateStr,
      truck_contexts,
      job_groups: builtGroups.job_groups,
      vanCapsForOptimizer,
      reqBody: req.body,
    });

    if (compareBundle.ok) {
      externalComparison = compareBundle.comparison;
      autoResult = compareBundle.auto;
      customResult = compareBundle.custom;
      console.log('[RouteOptimizer:compare] external compare-routes OK');
    } else if (compareBundle.fallback) {
      compareMode = 'dual-fallback';
      console.log(
        '[RouteOptimizer:compare] compare-routes unavailable (HTTP %s), dual-call fallback',
        compareBundle.status
      );
      [autoResult, customResult] = await Promise.all([
        resolveAutoRoutes(basePayload),
        resolveCustomGroupRoutes({
          basePayload: { ...basePayload, job_groups: builtGroups.job_groups },
          job_groups: builtGroups.job_groups,
          jobGroups,
          trucksInScope,
          dateStr,
        }),
      ]);
    } else {
      return res.status(compareBundle.status || 502).json({
        message: compareBundle.error || 'Compare routes failed',
        ...(compareBundle.detail && typeof compareBundle.detail === 'object'
          ? { detail: compareBundle.detail }
          : {}),
      });
    }

    const comparisonId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ROUTE_PROPOSAL_TTL_MS);
    const createdBy = req.user?._id || null;
    const jobGroupIds = builtGroups.job_groups.map((g) => g.group_id);

    /** @type {Array<object>} */
    const options = [];

    const variantDefs = [
      {
        variant: 'auto',
        label: 'Automatic assignment',
        result: autoResult,
      },
      {
        variant: 'custom',
        label: 'Manual job groups',
        result: customResult,
      },
    ];

    for (const def of variantDefs) {
      if (!def.result?.ok) {
        options.push({
          previewId: null,
          variant: def.variant,
          label: def.label,
          available: false,
          error: def.result?.error || `${def.label} unavailable`,
          detail: def.result?.detail,
        });
        continue;
      }

      const metrics = buildRoutePreviewMetrics(def.result.routes, trucksInScope, {
        fleetTotalDurationMin: def.result.fleetTotalDurationMin,
        fleetTotalDurationDisplay: def.result.fleetTotalDurationDisplay,
      });
      const routesWithComparison = enrichRouteMetricsWithComparison(
        metrics.routes,
        externalComparison,
        def.variant
      );

      const proposal = await RouteOptimizerProposal.create({
        comparisonId,
        variant: def.variant,
        date: dateStr,
        truckIds,
        status: 'pending',
        optimizerMode: def.result.optimizerMode,
        routes: def.result.routes,
        externalSummary: def.result.externalSummary || {},
        apiCallsUsed: def.result.apiCallsUsed ?? 0,
        jobGroupIds: def.variant === 'custom' ? jobGroupIds : [],
        createdBy,
        expiresAt,
      });

      options.push({
        previewId: proposal._id,
        variant: def.variant,
        label: def.label,
        available: true,
        optimizerMode: def.result.optimizerMode,
        apiCallsUsed: def.result.apiCallsUsed ?? 0,
        routes: routesWithComparison,
        fleetTotalDurationMin: metrics.fleetTotalDurationMin,
        fleetTotalDurationDisplay: metrics.fleetTotalDurationDisplay,
        fleetTotalDistanceKm: metrics.fleetTotalDistanceKm,
        summary: {
          date: dateStr,
          trucks_used: routesWithComparison.length,
          ...(def.result.externalSummary && typeof def.result.externalSummary === 'object'
            ? def.result.externalSummary
            : {}),
        },
      });
    }

    const anyAvailable = options.some((o) => o.available);

    return res.status(anyAvailable ? 200 : 502).json({
      success: anyAvailable,
      comparisonId,
      date: dateStr,
      expiresAt: expiresAt.toISOString(),
      compareMode,
      comparison: externalComparison,
      options,
    });
  } catch (error) {
    console.error('Route optimizer compare-route-previews error:', error);
    if (error.status && error.groupId) {
      return res.status(error.status).json({
        message: error.message,
        truckId: error.truckId,
        groupId: error.groupId,
        detail: error.detail,
      });
    }
    if (isOptimizerTransportFailure(error)) {
      const { status, body } = responseFromOptimizerNetworkError(error, 'compare-route-previews');
      return res.status(status).json(body);
    }
    return res.status(500).json({
      message: 'Compare route previews failed',
      error: error.response?.data || error.message,
    });
  }
}

/**
 * POST /api/route-optimizer/external/accept-route-preview
 * Body: { previewId: string }
 */
async function acceptRoutePreview(req, res) {
  try {
    await expireStaleRouteProposals();

    const previewId = req.body.previewId || req.body.proposalId;
    if (!previewId) {
      return res.status(400).json({ message: 'previewId is required' });
    }

    const proposal = await RouteOptimizerProposal.findById(previewId);
    if (!proposal) {
      return res.status(404).json({ message: 'Route preview not found' });
    }
    if (proposal.status !== 'pending') {
      return res.status(400).json({
        message: `Route preview is not pending (status: ${proposal.status})`,
        status: proposal.status,
      });
    }
    if (proposal.expiresAt && proposal.expiresAt < new Date()) {
      proposal.status = 'expired';
      await proposal.save();
      return res.status(410).json({ message: 'Route preview has expired. Run compare again.' });
    }

    const parsed = parseRouteOptimizerDate(proposal.date);
    if (!parsed.ok) {
      return res.status(500).json({ message: 'Stored proposal has invalid date' });
    }
    const { dateStr, startOfDay, endOfDay } = parsed;

    const requestedTruckIds = proposal.truckIds?.map((id) => id.toString()) || [];
    const loaded = await loadTrucksWithDriversForDate({ dateStr, requestedTruckIds });
    if (!loaded.ok) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    const routes = proposal.routes && typeof proposal.routes === 'object' ? proposal.routes : {};
    const routeTruckIds = new Set(Object.keys(routes));
    const trucksToPersist = loaded.trucksWithDrivers.filter(({ truck }) =>
      routeTruckIds.has(truck._id.toString())
    );

    const assignedCount = await persistExternalRoutes({
      trucksWithDrivers: trucksToPersist.length ? trucksToPersist : loaded.trucksWithDrivers,
      routes,
      dateStr,
      startOfDay,
      endOfDay,
      logScope: `accept-${proposal.variant}`,
    });

    proposal.status = 'accepted';
    proposal.acceptedAt = new Date();
    await proposal.save();

    await RouteOptimizerProposal.updateMany(
      {
        comparisonId: proposal.comparisonId,
        _id: { $ne: proposal._id },
        status: 'pending',
      },
      { $set: { status: 'superseded' } }
    );

    return res.status(200).json({
      success: true,
      previewId: proposal._id,
      comparisonId: proposal.comparisonId,
      variant: proposal.variant,
      optimizerMode: proposal.optimizerMode,
      date: dateStr,
      assigned: assignedCount,
    });
  } catch (error) {
    console.error('Route optimizer accept-route-preview error:', error);
    return res.status(500).json({
      message: 'Accept route preview failed',
      error: error.message,
    });
  }
}

/**
 * POST /api/route-optimizer/external/discard-route-preview
 * Body: { comparisonId?: string, previewId?: string }
 */
async function discardRoutePreview(req, res) {
  try {
    const { comparisonId, previewId } = req.body;
    if (!comparisonId && !previewId) {
      return res.status(400).json({ message: 'comparisonId or previewId is required' });
    }

    const filter = { status: 'pending' };
    if (comparisonId) {
      filter.comparisonId = comparisonId;
    } else {
      filter._id = previewId;
    }

    const result = await RouteOptimizerProposal.updateMany(filter, {
      $set: { status: 'discarded' },
    });

    return res.status(200).json({
      success: true,
      discarded: result.modifiedCount,
    });
  } catch (error) {
    console.error('Route optimizer discard-route-preview error:', error);
    return res.status(500).json({
      message: 'Discard route preview failed',
      error: error.message,
    });
  }
}

/**
 * POST /api/route-optimizer/external/reset-vans-for-date
 * Body: { date: string|Date, truckIds?: string[] }
 * Clears truck routes for the date (empties van/task lists) and unassigns tasks + tipping requests.
 * Skips trucks in RESET_VANS_EXCLUDED_TRUCK_IDS (e.g. "Cancelled unit").
 */
async function resetAllVansForDate(req, res) {
  try {
    const { date, truckIds, selectedTruckIds } = req.body;
    const requestedTruckIds = truckIds || selectedTruckIds;

    const parsed = parseRouteOptimizerDate(date);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }

    const { dateStr, startOfDay, endOfDay } = parsed;
    const excludedTruckIds = [...RESET_VANS_EXCLUDED_TRUCK_IDS];
    const hasTruckSelection = Array.isArray(requestedTruckIds) && requestedTruckIds.length > 0;
    const effectiveTruckIds = hasTruckSelection
      ? filterResetVansTruckIds(requestedTruckIds)
      : [];
    const truckQuery = hasTruckSelection
      ? { _id: { $in: effectiveTruckIds } }
      : { _id: { $nin: excludedTruckIds } };
    const trucks = await Truck.find(truckQuery);

    if (hasTruckSelection && !effectiveTruckIds.length) {
      return res.status(400).json({
        message: 'No valid trucks found for provided truckIds (excluded trucks only)',
        excludedTruckIds,
      });
    }

    if (hasTruckSelection && !trucks.length) {
      return res.status(400).json({ message: 'No valid trucks found for provided truckIds' });
    }

    const clearedTippingIds = new Set();
    let trucksCleared = 0;

    for (const truck of trucks) {
      let tasksForDate = [];
      if (truck.tasks instanceof Map) {
        tasksForDate = truck.tasks.get(dateStr) || [];
      } else if (truck.tasks && typeof truck.tasks === 'object') {
        tasksForDate = truck.tasks[dateStr] || [];
      }

      for (const entry of tasksForDate) {
        const rawId = entry?.taskId;
        const taskId = normalizeMongoId(rawId);
        if (!taskId) continue;
        const segType = entry.type === 'TippingRequest' ? 'TippingRequest' : 'task';
        if (segType === 'TippingRequest') {
          clearedTippingIds.add(taskId);
        }
      }

      if (!truck.tasks) {
        truck.tasks = new Map();
      }
      truck.tasks.set(dateStr, []);
      truck.markModified('tasks');
      await truck.save();
      trucksCleared += 1;
    }

    const taskFilter = {
      date: { $gte: startOfDay, $lte: endOfDay },
      truckId: hasTruckSelection
        ? { $in: effectiveTruckIds }
        : { $ne: null, $nin: excludedTruckIds },
    };

    const taskResult = await Task.updateMany(taskFilter, { $set: { truckId: null } });

    const tippingFilters = [];
    if (clearedTippingIds.size) {
      tippingFilters.push({ _id: { $in: [...clearedTippingIds] } });
    }
    const tippingByDateFilter = {
      tipdate: { $gte: startOfDay, $lte: endOfDay },
      truckId: hasTruckSelection
        ? { $in: effectiveTruckIds }
        : { $ne: null, $nin: excludedTruckIds },
    };
    tippingFilters.push(tippingByDateFilter);

    let tippingUnassigned = 0;
    for (const filter of tippingFilters) {
      const result = await TippingRequest.updateMany(filter, { $set: { truckId: null } });
      tippingUnassigned += result.modifiedCount || 0;
    }

    try {
      const mockReq = { body: { date: dateStr } };
      const mockRes = { status: () => ({ json: () => {} }), json: () => {} };
      await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
    } catch (dailySheetErr) {
      console.error('[RouteOptimizer:reset-vans] daily sheet sync error', dailySheetErr);
    }

    return res.status(200).json({
      success: true,
      message: 'All van routes cleared for the selected date',
      date: dateStr,
      trucksCleared,
      tasksUnassigned: taskResult.modifiedCount || 0,
      tippingUnassigned,
      scope: hasTruckSelection ? 'selected_trucks' : 'all_trucks',
      excludedTruckIds,
    });
  } catch (error) {
    console.error('Route optimizer reset-vans-for-date error:', error);
    return res.status(500).json({
      message: 'Reset vans for date failed',
      error: error.message,
    });
  }
}

module.exports = {
  calculateRoutesExternal,
  calculateRoutesExternalArea,
  calculateRoutesExternalWithGroups,
  compareRoutePreviews,
  acceptRoutePreview,
  discardRoutePreview,
  recalculateTruckRoute,
  requestBestTippingPlace,
  refreshRoute,
  resetAllVansForDate,
};
