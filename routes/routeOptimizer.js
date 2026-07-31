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
 * Body: { date, truckIds|selectedTruckIds?, vanCurrentCapacities? } — builds truck_contexts and POSTs
 * to the external /api/v1/calculate-routes (optional van_current_capacities for vans in scope).
 */
router.post(
  '/external/calculate-routes',
  routeOptimizerCtrl.calculateRoutesExternal
);

/**
 * POST /api/route-optimizer/external/grouped-routes
 * Body: { date, truckIds|selectedTruckIds?, vanCurrentCapacities? } — same payload as
 * /external/calculate-routes, forwarded to the external /api/v1/grouped-routes.
 */
router.post(
  '/external/grouped-routes',
  routeOptimizerCtrl.calculateRoutesExternalArea
);

/**
 * POST /api/route-optimizer/external/calculate-routes-groups
 * Body: { date, truckIds?, jobGroups|groups|jobs, vanCurrentCapacities? }
 * Proxies to external POST /api/v1/custom (manual job groups → truck routes).
 */
router.post(
  '/external/calculate-routes-groups',
  routeOptimizerCtrl.calculateRoutesExternalWithGroups
);

/**
 * POST /api/route-optimizer/external/compare-route-previews
 * Proxies to external POST /api/v1/compare-routes; returns auto + custom previews with driving times.
 * Body: { date, truckIds?, jobGroups|groups|jobs, vanCurrentCapacities?, respectTimeSlots? }
 */
router.post(
  '/external/compare-route-previews',
  routeOptimizerCtrl.compareRoutePreviews
);

/**
 * POST /api/route-optimizer/external/accept-route-preview
 * Body: { previewId } — applies the chosen preview to trucks/tasks.
 */
router.post(
  '/external/accept-route-preview',
  routeOptimizerCtrl.acceptRoutePreview
);

/**
 * POST /api/route-optimizer/external/discard-route-preview
 * Body: { comparisonId } or { previewId }
 */
router.post(
  '/external/discard-route-preview',
  routeOptimizerCtrl.discardRoutePreview
);

/**
 * POST /api/route-optimizer/external/recalculate-truck
 * Body: { truckId, date, persist?: boolean }
 */
router.post(
  '/external/recalculate-truck',
  routeOptimizerCtrl.recalculateTruckRoute
);
router.post("/external/refresh",
  routeOptimizerCtrl.refreshRoute
);
/**
 * POST /api/route-optimizer/external/request-tipping
 * Body: { truck_id, van_id?, jobs_date, remaining_jobs, last_completed_job_location? }
 */
router.post(
  '/external/request-tipping',
  routeOptimizerCtrl.requestBestTippingPlace
);

/**
 * POST /api/route-optimizer/external/reset-vans-for-date
 * Body: { date, truckIds? } — clears all truck routes for the date and unassigns tasks/tippings.
 */
router.post(
  '/external/reset-vans-for-date',
  isAuth,
  checkRole('Admin'),
  routeOptimizerCtrl.resetAllVansForDate
);

module.exports = router;
