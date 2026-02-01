/**
 * Route Optimizer Controller
 * Assigns unassigned tasks to trucks (drivers) with route optimization and persists to DB.
 */

const Task = require('../models/Task');
const Truck = require('../models/Truck');
const routeOptimizerService = require('../services/routeOptimizerService');
const dailySheetController = require('./dailySheetController');

/**
 * POST /api/route-optimizer/assign-and-optimize
 * Body: { date: string|Date, respectTimeSlots?: boolean }
 * Loads unassigned tasks for the date, assigns them to trucks (North→South + revenue balance),
 * optimizes visit order per truck, then updates Task.truckId and Truck.tasks.
 */
async function assignAndOptimize(req, res) {
  try {
    const inputDate = req.body.date ? new Date(req.body.date) : new Date();
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    const dateStr = inputDate.toISOString().split('T')[0];
    const respectTimeSlots = Boolean(req.body.respectTimeSlots);

    const startOfDay = new Date(inputDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    // Trucks with a driver (active for assignment)
    const trucks = await Truck.find({ driverId: { $ne: null } }).populate(
      'driverId'
    );
    if (!trucks.length) {
      return res.status(400).json({
        message: 'No trucks with drivers available for assignment',
      });
    }

    // Unassigned tasks for this date that have coordinates
    const tasks = await Task.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      truckId: null,
      taskStatus: { $nin: ['Cancelled'] },
      'location.coordinates': { $exists: true, $ne: null },
    }).populate('items.standardItemId');

    if (!tasks.length) {
      return res.status(200).json({
        message: 'No unassigned tasks with location for this date',
        summary: { date: dateStr, assigned: 0, trucksUsed: 0 },
      });
    }

    // Build drivers list (one per truck): driver_id = truck._id, start_location from driver or default
    const drivers = trucks.map((truck) => {
      const driver = truck.driverId;
      let startLat = routeOptimizerService.DEFAULT_DEPOT.lat;
      let startLng = routeOptimizerService.DEFAULT_DEPOT.lng;
      if (
        driver &&
        driver.location &&
        Array.isArray(driver.location.coordinates) &&
        driver.location.coordinates.length >= 2
      ) {
        startLat = driver.location.coordinates[1];
        startLng = driver.location.coordinates[0];
      }
      return {
        driver_id: truck._id.toString(),
        start_location: { lat: startLat, lng: startLng },
        status: 'active',
      };
    });

    // Build jobs list: job_id = task._id, lat/lng from GeoJSON [lng, lat], time_slot = available, total_price, duration_min for Mapbox
    const jobs = tasks
      .filter((t) => t.location?.coordinates?.length >= 2)
      .map((t) => ({
        job_id: t._id.toString(),
        lat: t.location.coordinates[1],
        lng: t.location.coordinates[0],
        time_slot: t.available || 'AnyTime',
        total_price: t.totalPrice || 0,
        duration_min: 10,
      }));

    if (!jobs.length) {
      return res.status(200).json({
        message: 'No tasks with valid coordinates',
        summary: { date: dateStr, assigned: 0, trucksUsed: 0 },
      });
    }

    const {
      assignJobsToDrivers,
      optimizeRouteOrder,
      optimizeRouteOrderWithMapbox,
    } = routeOptimizerService;
    const { assignedJobs } = assignJobsToDrivers(drivers, jobs);

    const mapboxKey =
      process.env.MAPBOX_API_KEY &&
      typeof process.env.MAPBOX_API_KEY === 'string' &&
      process.env.MAPBOX_API_KEY.startsWith('pk.')
        ? process.env.MAPBOX_API_KEY
        : null;

    let assignedCount = 0;
    let totalMapboxCalls = 0;
    const routesByDriverId = {};

    for (const truck of trucks) {
      const driverId = truck._id.toString();
      const driverJobs = assignedJobs[driverId] || [];
      if (!driverJobs.length) continue;

      const startLat =
        drivers.find((d) => d.driver_id === driverId)?.start_location?.lat ??
        routeOptimizerService.DEFAULT_DEPOT.lat;
      const startLng =
        drivers.find((d) => d.driver_id === driverId)?.start_location?.lng ??
        routeOptimizerService.DEFAULT_DEPOT.lng;

      let optimizedJobs;
      let routeSegments = [];
      let apiCallsForDriver = 0;

      if (mapboxKey) {
        const result = await optimizeRouteOrderWithMapbox(
          driverJobs,
          startLat,
          startLng,
          startLat,
          startLng,
          mapboxKey,
          respectTimeSlots,
          null
        );
        optimizedJobs = result.optimizedJobs;
        routeSegments = result.routeSegments || [];
        apiCallsForDriver = result.apiCalls || 0;
        totalMapboxCalls += apiCallsForDriver;
        const totalDistance = routeSegments.reduce(
          (s, seg) => s + (seg.distance_km || 0),
          0
        );
        const totalTime = routeSegments.reduce(
          (s, seg) => s + (seg.total_segment_min || 0),
          0
        );
        routesByDriverId[driverId] = {
          driver_info: {
            driver_id: driverId,
            start_location: { lat: startLat, lng: startLng },
            status: 'active',
          },
          jobs: optimizedJobs,
          route_segments: routeSegments,
          total_distance_km: totalDistance,
          total_time_min: totalTime,
          working_hours_utilization:
            480 > 0 ? (totalTime / 480) * 100 : 0,
        };
      } else {
        optimizedJobs = optimizeRouteOrder(
          driverJobs,
          startLat,
          startLng,
          startLat,
          startLng,
          null,
          respectTimeSlots
        );
      }

      const existingForDate = truck.getTasksForDate(dateStr) || [];
      const existingCount = existingForDate.length;

      for (let i = 0; i < optimizedJobs.length; i++) {
        const job = optimizedJobs[i];
        await Task.findByIdAndUpdate(job.job_id, { truckId: truck._id });
        truck.addTask(dateStr, job.job_id, existingCount + i + 1);
        assignedCount += 1;
      }

      await truck.save();
    }

    // Sync daily sheets for the date
    try {
      const mockReq = { body: { date: dateStr } };
      const mockRes = {
        status: () => ({ json: () => {} }),
        json: () => {},
      };
      await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
    } catch (dailySheetErr) {
      console.error('Route optimizer: daily sheet sync error', dailySheetErr);
    }

    const trucksUsed = trucks.filter(
      (t) => (assignedJobs[t._id.toString()] || []).length > 0
    ).length;

    const payload = {
      message: 'Assign and optimize completed',
      summary: {
        date: dateStr,
        assigned: assignedCount,
        trucksUsed,
        totalUnassignedProcessed: jobs.length,
      },
      assignedByTruck: Object.fromEntries(
        trucks
          .filter((t) => (assignedJobs[t._id.toString()] || []).length > 0)
          .map((t) => [t.name, (assignedJobs[t._id.toString()] || []).length])
      ),
    };

    // Include Mapbox route segments when requested and we used Mapbox for ordering
    const includeRouteSegments = Boolean(req.body.includeRouteSegments);
    if (includeRouteSegments && Object.keys(routesByDriverId).length > 0) {
      payload.routes = routesByDriverId;
      payload.api_calls_used = totalMapboxCalls;
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Route optimizer assign-and-optimize error:', error);
    return res.status(500).json({
      message: 'Assign and optimize failed',
      error: error.message,
    });
  }
}

/**
 * POST /api/route-optimizer/calculate-routes
 * Body: { date: string|Date, respectTimeSlots?: boolean, highPriorityJobs?: { [driverId]: jobId[] } }
 * Same input as assign-and-optimize but does NOT persist. Returns Mapbox route segments
 * (distance_km, travel_time_min, coords) per driver, like the Python script.
 */
async function calculateRoutes(req, res) {
  try {
    const inputDate = req.body.date ? new Date(req.body.date) : new Date();
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    const dateStr = inputDate.toISOString().split('T')[0];
    const respectTimeSlots = Boolean(req.body.respectTimeSlots);
    const highPriorityJobs = req.body.highPriorityJobs || null;

    const mapboxKey = process.env.MAPBOX_API_KEY;
    if (
      !mapboxKey ||
      typeof mapboxKey !== 'string' ||
      !mapboxKey.startsWith('pk.')
    ) {
      return res.status(400).json({
        message:
          'MAPBOX_API_KEY not found or invalid in environment (must start with pk.)',
      });
    }

    const startOfDay = new Date(inputDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const trucks = await Truck.find({ driverId: { $ne: null } }).populate(
      'driverId'
    );
    if (!trucks.length) {
      return res.status(400).json({
        message: 'No trucks with drivers available',
      });
    }

    const tasks = await Task.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      truckId: null,
      taskStatus: { $nin: ['Cancelled'] },
      'location.coordinates': { $exists: true, $ne: null },
    });

    const jobs = tasks
      .filter((t) => t.location?.coordinates?.length >= 2)
      .map((t) => ({
        job_id: t._id.toString(),
        lat: t.location.coordinates[1],
        lng: t.location.coordinates[0],
        time_slot: t.available || 'AnyTime',
        total_price: t.totalPrice || 0,
        duration_min: 10,
      }));

    const drivers = trucks.map((truck) => {
      const driver = truck.driverId;
      let startLat = routeOptimizerService.DEFAULT_DEPOT.lat;
      let startLng = routeOptimizerService.DEFAULT_DEPOT.lng;
      if (
        driver &&
        driver.location &&
        Array.isArray(driver.location.coordinates) &&
        driver.location.coordinates.length >= 2
      ) {
        startLat = driver.location.coordinates[1];
        startLng = driver.location.coordinates[0];
      }
      return {
        driver_id: truck._id.toString(),
        start_location: { lat: startLat, lng: startLng },
        status: 'active',
        max_route_duration_min: 480,
      };
    });

    const { calculateRoutesForDrivers } = routeOptimizerService;
    const { routesByDriverId, apiCalls } = await calculateRoutesForDrivers(
      drivers,
      jobs,
      mapboxKey,
      respectTimeSlots,
      highPriorityJobs
    );

    const totalDistance = Object.values(routesByDriverId).reduce(
      (sum, r) => sum + (r.total_distance_km || 0),
      0
    );
    const totalTime = Object.values(routesByDriverId).reduce(
      (sum, r) => sum + (r.total_time_min || 0),
      0
    );

    return res.status(200).json({
      success: true,
      routes: routesByDriverId,
      api_calls_used: apiCalls,
      summary: {
        date: dateStr,
        total_drivers: Object.keys(routesByDriverId).length,
        total_distance_km: totalDistance,
        total_time_min: totalTime,
      },
    });
  } catch (error) {
    console.error('Route optimizer calculate-routes error:', error);
    return res.status(500).json({
      message: 'Calculate routes failed',
      error: error.message,
    });
  }
}

module.exports = {
  assignAndOptimize,
  calculateRoutes,
};
