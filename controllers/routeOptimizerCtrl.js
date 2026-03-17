/**
 * Route Optimizer Controller
 * Assigns unassigned tasks to trucks (drivers) with route optimization and persists to DB.
 */

const axios = require('axios');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const Driver = require('../models/Driver');
const { truckDisplayName } = require('../utils/truckHelpers');
const routeOptimizerService = require('../services/routeOptimizerService');
const dailySheetController = require('./dailySheetController');
const { getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');
//https://routeoptimiser.duckdns.org
const EXTERNAL_ROUTE_OPTIMIZER_URL =
  process.env.EXTERNAL_ROUTE_OPTIMIZER_URL || 'https://routeoptimiser.duckdns.org';

/**
 * POST /api/route-optimizer/assign-and-optimize
 * Body: { date: string|Date, respectTimeSlots?: boolean }
 * Loads unassigned tasks for the date, assigns them to trucks (North→South + revenue balance),
 * optimizes visit order per truck, then updates Task.truckId and Truck.tasks.
 */
// async function assignAndOptimize(req, res) {
//   try {
//     const inputDate = req.body.date ? new Date(req.body.date) : new Date();
//     if (isNaN(inputDate.getTime())) {
//       return res.status(400).json({ message: 'Invalid date format' });
//     }

//     const dateStr = inputDate.toISOString().split('T')[0];
//     const respectTimeSlots = Boolean(req.body.respectTimeSlots);

//     const startOfDay = new Date(inputDate);
//     startOfDay.setUTCHours(0, 0, 0, 0);
//     const endOfDay = new Date(inputDate);
//     endOfDay.setUTCHours(23, 59, 59, 999);

//     // Trucks with a driver (active for assignment)
//     const trucks = await Truck.find({ driverId: { $ne: null } }).populate(
//       'driverId'
//     );
//     if (!trucks.length) {
//       return res.status(400).json({
//         message: 'No trucks with drivers available for assignment',
//       });
//     }

//     // Unassigned tasks for this date that have coordinates
//     const tasks = await Task.find({
//       date: { $gte: startOfDay, $lte: endOfDay },
//       truckId: null,
//       taskStatus: { $nin: ['Cancelled'] },
//       'location.coordinates': { $exists: true, $ne: null },
//     }).populate('items.standardItemId');

//     if (!tasks.length) {
//       return res.status(200).json({
//         message: 'No unassigned tasks with location for this date',
//         summary: { date: dateStr, assigned: 0, trucksUsed: 0 },
//       });
//     }

//     // Build drivers list (one per truck): driver_id = truck._id, start_location from driver or default
//     const drivers = trucks.map((truck) => {
//       const driver = truck.driverId;
//       let startLat = routeOptimizerService.DEFAULT_DEPOT.lat;
//       let startLng = routeOptimizerService.DEFAULT_DEPOT.lng;
//       if (
//         driver &&
//         driver.location &&
//         Array.isArray(driver.location.coordinates) &&
//         driver.location.coordinates.length >= 2
//       ) {
//         startLat = driver.location.coordinates[1];
//         startLng = driver.location.coordinates[0];
//       }
//       return {
//         driver_id: truck._id.toString(),
//         start_location: { lat: startLat, lng: startLng },
//         status: 'active',
//       };
//     });

//     // Build jobs list: job_id = task._id, lat/lng from GeoJSON [lng, lat], time_slot = available, total_price, duration_min for Mapbox
//     const jobs = tasks
//       .filter((t) => t.location?.coordinates?.length >= 2)
//       .map((t) => ({
//         job_id: t._id.toString(),
//         lat: t.location.coordinates[1],
//         lng: t.location.coordinates[0],
//         time_slot: t.available || 'AnyTime',
//         total_price: t.totalPrice || 0,
//         duration_min: 10,
//       }));

//     if (!jobs.length) {
//       return res.status(200).json({
//         message: 'No tasks with valid coordinates',
//         summary: { date: dateStr, assigned: 0, trucksUsed: 0 },
//       });
//     }

//     const {
//       assignJobsToDrivers,
//       optimizeRouteOrder,
//       optimizeRouteOrderWithMapbox,
//     } = routeOptimizerService;
//     const { assignedJobs } = assignJobsToDrivers(drivers, jobs);

//     const mapboxKey =
//       process.env.MAPBOX_API_KEY &&
//       typeof process.env.MAPBOX_API_KEY === 'string' &&
//       process.env.MAPBOX_API_KEY.startsWith('pk.')
//         ? process.env.MAPBOX_API_KEY
//         : null;

//     let assignedCount = 0;
//     let totalMapboxCalls = 0;
//     const routesByDriverId = {};

//     for (const truck of trucks) {
//       const driverId = truck._id.toString();
//       const driverJobs = assignedJobs[driverId] || [];
//       if (!driverJobs.length) continue;

//       const startLat =
//         drivers.find((d) => d.driver_id === driverId)?.start_location?.lat ??
//         routeOptimizerService.DEFAULT_DEPOT.lat;
//       const startLng =
//         drivers.find((d) => d.driver_id === driverId)?.start_location?.lng ??
//         routeOptimizerService.DEFAULT_DEPOT.lng;

//       let optimizedJobs;
//       let routeSegments = [];
//       let apiCallsForDriver = 0;

//       if (mapboxKey) {
//         const result = await optimizeRouteOrderWithMapbox(
//           driverJobs,
//           startLat,
//           startLng,
//           startLat,
//           startLng,
//           mapboxKey,
//           respectTimeSlots,
//           null
//         );
//         optimizedJobs = result.optimizedJobs;
//         routeSegments = result.routeSegments || [];
//         apiCallsForDriver = result.apiCalls || 0;
//         totalMapboxCalls += apiCallsForDriver;
//         const totalDistance = routeSegments.reduce(
//           (s, seg) => s + (seg.distance_km || 0),
//           0
//         );
//         const totalTime = routeSegments.reduce(
//           (s, seg) => s + (seg.total_segment_min || 0),
//           0
//         );
//         routesByDriverId[driverId] = {
//           driver_info: {
//             driver_id: driverId,
//             start_location: { lat: startLat, lng: startLng },
//             status: 'active',
//           },
//           jobs: optimizedJobs,
//           route_segments: routeSegments,
//           total_distance_km: totalDistance,
//           total_time_min: totalTime,
//           working_hours_utilization:
//             480 > 0 ? (totalTime / 480) * 100 : 0,
//         };
//       } else {
//         optimizedJobs = optimizeRouteOrder(
//           driverJobs,
//           startLat,
//           startLng,
//           startLat,
//           startLng,
//           null,
//           respectTimeSlots
//         );
//       }

//       const existingForDate = truck.getTasksForDate(dateStr) || [];
//       const existingCount = existingForDate.length;

//       for (let i = 0; i < optimizedJobs.length; i++) {
//         const job = optimizedJobs[i];
//         await Task.findByIdAndUpdate(job.job_id, { truckId: truck._id });
//         truck.addTask(dateStr, job.job_id, existingCount + i + 1);
//         assignedCount += 1;
//       }

//       await truck.save();
//     }

//     // Sync daily sheets for the date
//     try {
//       const mockReq = { body: { date: dateStr } };
//       const mockRes = {
//         status: () => ({ json: () => {} }),
//         json: () => {},
//       };
//       await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
//     } catch (dailySheetErr) {
//       console.error('Route optimizer: daily sheet sync error', dailySheetErr);
//     }

//     const trucksUsed = trucks.filter(
//       (t) => (assignedJobs[t._id.toString()] || []).length > 0
//     ).length;

//     const payload = {
//       message: 'Assign and optimize completed',
//       summary: {
//         date: dateStr,
//         assigned: assignedCount,
//         trucksUsed,
//         totalUnassignedProcessed: jobs.length,
//       },
//       assignedByTruck: Object.fromEntries(
//         trucks
//           .filter((t) => (assignedJobs[t._id.toString()] || []).length > 0)
//           .map((t) => [t.name, (assignedJobs[t._id.toString()] || []).length])
//       ),
//     };

//     // Include Mapbox route segments when requested and we used Mapbox for ordering
//     const includeRouteSegments = Boolean(req.body.includeRouteSegments);
//     if (includeRouteSegments && Object.keys(routesByDriverId).length > 0) {
//       payload.routes = routesByDriverId;
//       payload.api_calls_used = totalMapboxCalls;
//     }

//     return res.status(200).json(payload);
//   } catch (error) {
//     console.error('Route optimizer assign-and-optimize error:', error);
//     return res.status(500).json({
//       message: 'Assign and optimize failed',
//       error: error.message,
//     });
//   }
// }

/**
 * POST /api/route-optimizer/calculate-routes
 * Body: { date: string|Date, respectTimeSlots?: boolean, highPriorityJobs?: { [driverId]: jobId[] } }
 * Same input as assign-and-optimize but does NOT persist. Returns Mapbox route segments
 * (distance_km, travel_time_min, coords) per driver, like the Python script.
 */
// async function calculateRoutes(req, res) {
//   try {
//     const inputDate = req.body.date ? new Date(req.body.date) : new Date();
//     if (isNaN(inputDate.getTime())) {
//       return res.status(400).json({ message: 'Invalid date format' });
//     }

//     const dateStr = inputDate.toISOString().split('T')[0];
//     const respectTimeSlots = Boolean(req.body.respectTimeSlots);
//     const highPriorityJobs = req.body.highPriorityJobs || null;

//     const mapboxKey = process.env.MAPBOX_API_KEY;
//     if (
//       !mapboxKey ||
//       typeof mapboxKey !== 'string' ||
//       !mapboxKey.startsWith('pk.')
//     ) {
//       return res.status(400).json({
//         message:
//           'MAPBOX_API_KEY not found or invalid in environment (must start with pk.)',
//       });
//     }

//     const startOfDay = new Date(inputDate);
//     startOfDay.setUTCHours(0, 0, 0, 0);
//     const endOfDay = new Date(inputDate);
//     endOfDay.setUTCHours(23, 59, 59, 999);

//     const trucks = await Truck.find({ driverId: { $ne: null } }).populate(
//       'driverId'
//     );
//     if (!trucks.length) {
//       return res.status(400).json({
//         message: 'No trucks with drivers available',
//       });
//     }

//     const tasks = await Task.find({
//       date: { $gte: startOfDay, $lte: endOfDay },
//       truckId: null,
//       taskStatus: { $nin: ['Cancelled'] },
//       'location.coordinates': { $exists: true, $ne: null },
//     });

//     const jobs = tasks
//       .filter((t) => t.location?.coordinates?.length >= 2)
//       .map((t) => ({
//         job_id: t._id.toString(),
//         lat: t.location.coordinates[1],
//         lng: t.location.coordinates[0],
//         time_slot: t.available || 'AnyTime',
//         total_price: t.totalPrice || 0,
//         duration_min: 10,
//       }));

//     const drivers = trucks.map((truck) => {
//       const driver = truck.driverId;
//       let startLat = routeOptimizerService.DEFAULT_DEPOT.lat;
//       let startLng = routeOptimizerService.DEFAULT_DEPOT.lng;
//       if (
//         driver &&
//         driver.location &&
//         Array.isArray(driver.location.coordinates) &&
//         driver.location.coordinates.length >= 2
//       ) {
//         startLat = driver.location.coordinates[1];
//         startLng = driver.location.coordinates[0];
//       }
//       return {
//         driver_id: truck._id.toString(),
//         start_location: { lat: startLat, lng: startLng },
//         status: 'active',
//         max_route_duration_min: 480,
//       };
//     });

//     const { calculateRoutesForDrivers } = routeOptimizerService;
//     const { routesByDriverId, apiCalls } = await calculateRoutesForDrivers(
//       drivers,
//       jobs,
//       mapboxKey,
//       respectTimeSlots,
//       highPriorityJobs
//     );

//     const totalDistance = Object.values(routesByDriverId).reduce(
//       (sum, r) => sum + (r.total_distance_km || 0),
//       0
//     );
//     const totalTime = Object.values(routesByDriverId).reduce(
//       (sum, r) => sum + (r.total_time_min || 0),
//       0
//     );

//     return res.status(200).json({
//       success: true,
//       routes: routesByDriverId,
//       api_calls_used: apiCalls,
//       summary: {
//         date: dateStr,
//         total_drivers: Object.keys(routesByDriverId).length,
//         total_distance_km: totalDistance,
//         total_time_min: totalTime,
//       },
//     });
//   } catch (error) {
//     console.error('Route optimizer calculate-routes error:', error);
//     return res.status(500).json({
//       message: 'Calculate routes failed',
//       error: error.message,
//     });
//   }
// }

/**
 * POST /api/route-optimizer/external/calculate-routes
 * Loads drivers (trucks) and unassigned jobs (tasks) from DB for the given date,
 * then forwards to external Route Optimizer API (e.g. https://routeoptimiser.duckdns.org).
 * Body: { date: string|Date, respect_time_slots?, job_priorities? }
 * Returns: { success, routes, api_calls_used } from external API.
 */
async function calculateRoutesExternal(req, res) {
  try {
    const inputDate = req.body.date ? new Date(req.body.date) : new Date();
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    const dateStr = inputDate.toISOString().split('T')[0];
    const respect_time_slots = Boolean(req.body.respect_time_slots ?? req.body.respectTimeSlots);
    const job_priorities = req.body.job_priorities || null;

    const startOfDay = new Date(inputDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    // Use UnitAssignmentLogRange to determine which driver is on which truck for this day
    const allTrucks = await Truck.find().populate('vanId');
    const trucksWithDrivers = [];
    for (const t of allTrucks) {
      const assignment = await getAssignedForDayFromRanges(t._id, dateStr);
      if (assignment.driverId) {
        const driver = await Driver.findById(assignment.driverId);
        if (!driver) continue;
        trucksWithDrivers.push({ truck: t, driver, driverId: assignment.driverId });
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

    const tasks = await Task.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      taskStatus: { $nin: ['Cancelled'] },
      'location.coordinates': { $exists: true, $ne: null },
    });

    const tasksWithCoords = tasks.filter((t) => t.location?.coordinates?.length >= 2);
    const jobIdToTaskId = {};
    tasksWithCoords.forEach((t) => {
      jobIdToTaskId[t._id.toString()] = t._id;
    });
    console.log('[RouteOptimizer:external] tasks with coords=%d jobIdToTaskId keys=%s', tasksWithCoords.length, Object.keys(jobIdToTaskId).slice(0, 10).join(', ') + (Object.keys(jobIdToTaskId).length > 10 ? '...' : ''));

    // We no longer send jobs to the external API, but we keep this data for mapping
    // the returned route segment IDs back to Task IDs via jobIdToTaskId.
    const jobs = tasksWithCoords.map((t) => ({
      job_id: t._id.toString(),
      name: [t.firstName, t.lastName].filter(Boolean).join(' ') || 'Customer',
      lat: t.location.coordinates[1],
      lng: t.location.coordinates[0],
      duration_min: 10,
      time_slot: t.available || 'AnyTime',
      total_price: t.totalPrice || 0,
      taskDuration: typeof t.taskDuration === 'number' && t.taskDuration >= 0 ? t.taskDuration : 10,
    }));

    if (!jobs.length) {
      return res.status(200).json({
        message: 'No unassigned tasks with location for this date',
        success: true,
        routes: {},
        api_calls_used: 0,
        summary: { date: dateStr, total_drivers: 0, total_distance_km: 0, total_time_min: 0 },
      });
    }

    const drivers = trucksWithDrivers.map(({ truck, driver }) => {
      let startLat = routeOptimizerService.DEFAULT_DEPOT.lat;
      let startLng = routeOptimizerService.DEFAULT_DEPOT.lng;
      let endLat = startLat;
      let endLng = startLng;
      if (driver) {
        const startCoords = driver.start_location?.coordinates ?? driver.location?.coordinates;
        const endCoords = driver.end_location?.coordinates ?? startCoords;
        if (startCoords && startCoords.length >= 2) {
          startLat = startCoords[1];
          startLng = startCoords[0];
        }
        if (endCoords && endCoords.length >= 2) {
          endLat = endCoords[1];
          endLng = endCoords[0];
        }
      }
      console.log({
        driver_id: driver._id.toString(),
        start_location: { lat: startLat, lng: startLng },
        end_location: { lat: endLat, lng: endLng },
        status: 'active',
      });
      return {
        driver_id: driver._id.toString(),
        start_location: { lat: startLat, lng: startLng },
        end_location: { lat: endLat, lng: endLng },
        working_hours: { start: '08:00', end: '17:00' },
        max_route_duration_min: 480,
        status: 'active',
      };
    });

    const high_priority_jobs = {};
    if (job_priorities && typeof job_priorities === 'object') {
      for (const [driverId, priorities] of Object.entries(job_priorities)) {
        if (priorities && typeof priorities === 'object') {
          const highIds = Object.entries(priorities)
            .filter(([, p]) => p === 'high')
            .map(([jobId]) => jobId);
          if (highIds.length) high_priority_jobs[driverId] = highIds;
        }
      }
    }

    const payload = {
      drivers,
      jobs,
      respect_time_slots: false
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

    // Unassign all tasks for this date so only the new optimization is reflected
    await Task.updateMany(
      { date: { $gte: startOfDay, $lte: endOfDay } },
      { $set: { truckId: null } }
    );

    // Persist assignment: clear old routes for this date on each truck, then assign new order
    let assignedCount = 0;
    for (const routeKey of routeKeys) {
      // New response: routeKey is the driver_id (Driver._id)
      const entry = trucksWithDrivers.find(({ driverId }) => driverId.toString() === routeKey);
      if (!entry) {
        console.log('[RouteOptimizer:external] routeKey=%s no truck/driver assignment matched (skip)', routeKey);
        continue;
      }
      const { truck } = entry;
      console.log(
        '[RouteOptimizer:external] routeKey=%s matched truck name=%s _id=%s (by driverId)',
        routeKey,
        truckDisplayName(truck),
        truck._id.toString()
      );
      // Remove old routes for this date so we don't duplicate tasks
      if (!truck.tasks) truck.tasks = new Map();
      truck.tasks.set(dateStr, []);
      truck.markModified('tasks');

      // New response format: routes[driverId].route_segments is an array of IDs,
      // mostly Task IDs, with a terminating 'End Position' marker.
      const routeSegments = Array.isArray(routes[routeKey].route_segments)
        ? routes[routeKey].route_segments
        : [];
      let assignedThisTruck = 0;
      const missingJobIds = [];
      for (let i = 0; i < routeSegments.length; i++) {
        const jobId = routeSegments[i];
        if (!jobId || jobId === 'End Position') continue;
        const taskId = jobIdToTaskId[jobId];
        if (!taskId) {
          missingJobIds.push(jobId);
          continue;
        }
        await Task.findByIdAndUpdate(taskId, { truckId: truck._id });
        truck.addTask(dateStr, taskId, i + 1);
        assignedCount += 1;
        assignedThisTruck += 1;
      }
      if (missingJobIds.length) {
        console.log('[RouteOptimizer:external] truck %s: job_ids not in jobIdToTaskId: %s', truckDisplayName(truck), missingJobIds.join(', '));
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
    return res.status(500).json({
      message: 'External calculate routes failed',
      error: error.response?.data || error.message,
    });
  }
}

// recalculate route for specific driver
async function recalculateRouteForDriver(req, res) {
  const { driverId } = req.params;
 
}
module.exports = {
 
  calculateRoutesExternal,
};
