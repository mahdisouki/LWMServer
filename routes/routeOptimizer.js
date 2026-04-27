const express = require('express');
const router = express.Router();
const routeOptimizerCtrl = require('../controllers/routeOptimizerCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

/**
 * POST /api/route-optimizer/assign-and-optimize
 * Body: { date?: string|Date, respectTimeSlots?: boolean, includeRouteSegments?: boolean }
 * Assigns unassigned tasks for the date to trucks (North→South + revenue balance),
 * optimizes visit order per truck, updates Task.truckId and Truck.tasks.
 * If includeRouteSegments=true and MAPBOX_API_KEY is set, response includes Mapbox route segments (distance, duration, coords).
 */
// router.post(
//   '/assign-and-optimize',
//   isAuth,
//   checkRole('Admin'),
//   routeOptimizerCtrl.assignAndOptimize
// );

/**
 * POST /api/route-optimizer/calculate-routes
 * Body: { date?: string|Date, respectTimeSlots?: boolean, highPriorityJobs?: { [driverId]: jobId[] } }
 * Same assignment + optimization logic but does NOT persist. Returns Mapbox route segments per driver (like Python script).
 * Requires MAPBOX_API_KEY in env.
 */
// router.post(
//   '/calculate-routes',
//   isAuth,
//   checkRole('Admin'),
//   routeOptimizerCtrl.calculateRoutes
// );

/**
 * POST /api/route-optimizer/external/calculate-routes
 * Body: { drivers, jobs, respect_time_slots?, job_priorities? } - forwarded to external API (e.g. https://routeoptimiser.duckdns.org/api/v1/calculate-routes)
 */
router.post(
  '/external/calculate-routes',
  routeOptimizerCtrl.calculateRoutesExternal
);

/**
 * POST /api/route-optimizer/external/recalculate-truck
 * Body: { truckId, date, persist?: boolean }
 */
router.post(
  '/external/recalculate-truck',
  routeOptimizerCtrl.recalculateTruckRoute
);

/**
 * POST /api/route-optimizer/external/request-tipping
 * Body: { truck_id, van_id?, jobs_date, remaining_jobs, last_completed_job_location? }
 */
router.post(
  '/external/request-tipping',
  routeOptimizerCtrl.requestBestTippingPlace
);

module.exports = router;
