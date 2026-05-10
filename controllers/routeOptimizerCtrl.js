/**
 * Route Optimizer Controller
 * Assigns unassigned tasks to trucks (drivers) with route optimization and persists to DB.
 */

const axios = require('axios');
const Task = require('../models/Task');
const TippingRequest = require('../models/TippingRequest');
const Truck = require('../models/Truck');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const { truckDisplayName } = require('../utils/truckHelpers');
const routeOptimizerService = require('../services/routeOptimizerService');
const dailySheetController = require('./dailySheetController');
const { getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');
//https://routeoptimiser.duckdns.org
const EXTERNAL_ROUTE_OPTIMIZER_URL =
  process.env.EXTERNAL_ROUTE_OPTIMIZER_URL || 'http://192.168.0.132:8000'//'https://routeoptimiser.duckdns.org';

function normalizeMongoId(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.$oid) return value.$oid;
  if (typeof value.toString === 'function') return value.toString();
  return null;
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
 * Body: { date: string|Date }
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

module.exports = {
  calculateRoutesExternal,
  recalculateTruckRoute,
  requestBestTippingPlace,
  refreshRoute
};
