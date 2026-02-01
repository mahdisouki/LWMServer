/**
 * Route Optimizer Service
 * Port of the Python route_optimizer_api logic: assign tasks to drivers (trucks)
 * with North→South zoning + revenue balancing, then optimize visit order per driver.
 * Uses Mapbox Directions API for driving distance, duration, and route geometry.
 */

const axios = require('axios');
const DEFAULT_DEPOT = { lat: 51.5074, lng: -0.1278 }; // London

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get route from Mapbox Directions API (driving-traffic, fallback to driving).
 * Returns: { distanceKm, durationMin, routeCoords } or null on failure.
 * routeCoords: [[lat, lng], ...] (same as Python: [coord[1], coord[0]])
 */
async function getMapboxRouteWithTraffic(
  startLon,
  startLat,
  endLon,
  endLat,
  apiKey,
  maxRetries = 3
) {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${startLon},${startLat};${endLon},${endLat}`;
  const params = {
    access_token: apiKey,
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    annotations: 'duration,distance',
    language: 'en',
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { data, status } = await axios.get(url, {
        params,
        timeout: 15000,
        validateStatus: () => true, // handle 429 / NoRoute ourselves
      });

      if (status === 200 && data.code === 'Ok') {
        const route = data.routes[0];
        const distanceKm = route.distance / 1000;
        const durationMin = route.duration / 60;
        const geometry = route.geometry.coordinates;
        const routeCoords = geometry.map((c) => [c[1], c[0]]);
        return { distanceKm, durationMin, routeCoords };
      }

      if (status === 429) {
        if (attempt < maxRetries - 1) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        return null;
      }

      const errorCode = data.code || 'Unknown';
      const errorMsg = data.message || `HTTP ${status}`;

      if (errorCode === 'NoRoute' || (errorMsg && errorMsg.includes('No route'))) {
        const R = 6371000; // metres
        const dlat = toRad(endLat - startLat);
        const dlon = toRad(endLon - startLon);
        const a =
          Math.sin(dlat / 2) ** 2 +
          Math.cos(toRad(startLat)) *
            Math.cos(toRad(endLat)) *
            Math.sin(dlon / 2) ** 2;
        const c = 2 * Math.asin(Math.sqrt(a));
        const distanceM = R * c;
        if (distanceM < 50) {
          return {
            distanceKm: distanceM / 1000,
            durationMin: (distanceM / 1000) * 0.5,
            routeCoords: [
              [startLat, startLon],
              [endLat, endLon],
            ],
          };
        }
        if (attempt === 0) {
          const urlDriving = `https://api.mapbox.com/directions/v5/mapbox/driving/${startLon},${startLat};${endLon},${endLat}`;
          try {
            const alt = await axios.get(urlDriving, {
              params,
              timeout: 15000,
              validateStatus: () => true,
            });
            if (alt.status === 200 && alt.data.code === 'Ok') {
              const r = alt.data.routes[0];
              const coords = r.geometry.coordinates.map((c) => [c[1], c[0]]);
              return {
                distanceKm: r.distance / 1000,
                durationMin: r.duration / 60,
                routeCoords: coords,
              };
            }
          } catch (_) {}
        }
      }

      if (attempt < maxRetries - 1) {
        await sleep(1000);
        continue;
      }
      return null;
    } catch (err) {
      if (attempt < maxRetries - 1) {
        await sleep(1000);
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Haversine distance in km between two points
 */
function calculateDistanceHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius km
  const dlat = toRad(lat2 - lat1);
  const dlon = toRad(lon2 - lon1);
  const a =
    Math.sin(dlat / 2) * Math.sin(dlat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dlon / 2) *
      Math.sin(dlon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Assign jobs to drivers using North→South zoning and revenue balancing.
 * @param {Array<{ driver_id: string, start_location: { lat: number, lng: number }, status?: string }>} drivers
 * @param {Array<{ job_id: string, lat: number, lng: number, time_slot: string, total_price: number }>} jobs
 * @returns {{ assignedJobs: Object.<string, Array>, driverOrderedJobs: Object.<string, Array<{ order: number, job: Object }>> }}
 */
function assignJobsToDrivers(drivers, jobs) {
  const activeDrivers = drivers.filter(
    (d) => (d.status || 'active') !== 'in panne'
  );

  if (!activeDrivers.length) {
    return {
      assignedJobs: Object.fromEntries(drivers.map((d) => [d.driver_id, []])),
      driverOrderedJobs: {},
    };
  }

  const assignedJobs = Object.fromEntries(
    drivers.map((d) => [d.driver_id, []])
  );

  // Sort drivers North → South (by latitude descending)
  const activeSorted = [...activeDrivers].sort(
    (a, b) =>
      (b.start_location?.lat ?? DEFAULT_DEPOT.lat) -
      (a.start_location?.lat ?? DEFAULT_DEPOT.lat)
  );

  // Sort jobs North → South
  const jobsSorted = [...jobs].sort((a, b) => b.lat - a.lat);

  const totalRevenue = jobsSorted.reduce(
    (sum, j) => sum + parseFloat(j.total_price || 0),
    0
  );
  const targetRevenuePerDriver =
    activeSorted.length > 0 ? totalRevenue / activeSorted.length : 0;

  let currentDriverIdx = 0;
  let currentDriverRevenue = 0;

  for (const job of jobsSorted) {
    if (currentDriverIdx >= activeSorted.length) {
      currentDriverIdx = activeSorted.length - 1;
    }
    const driver = activeSorted[currentDriverIdx];
    const driverId = driver.driver_id;
    const jobPrice = parseFloat(job.total_price || 0);

    assignedJobs[driverId].push(job);
    currentDriverRevenue += jobPrice;

    if (
      currentDriverRevenue >= targetRevenuePerDriver &&
      currentDriverIdx < activeSorted.length - 1
    ) {
      currentDriverIdx += 1;
      currentDriverRevenue = 0;
    }
  }

  const driverOrderedJobs = {};
  for (const d of activeDrivers) {
    const list = assignedJobs[d.driver_id] || [];
    driverOrderedJobs[d.driver_id] = list.map((job, idx) => ({
      order: idx + 1,
      job,
    }));
  }

  return { assignedJobs, driverOrderedJobs };
}

const TIME_SLOT_PRIORITY = {
  '7am-12pm': 1,
  '12pm-5pm': 2,
  AnyTime: 3,
};

/**
 * Optimize visit order for one driver's jobs: high priority first, then by time slot, then nearest-neighbor.
 * @param {Array<{ job_id: string, lat: number, lng: number, time_slot: string }>} jobs
 * @param {number} startLat
 * @param {number} startLng
 * @param {number} [endLat]
 * @param {number} [endLng]
 * @param {string[]} [highPriorityJobIds]
 * @param {boolean} [respectTimeSlots]
 * @returns {Array<Object>} Ordered list of jobs
 */
function optimizeRouteOrder(
  jobs,
  startLat,
  startLng,
  endLat = null,
  endLng = null,
  highPriorityJobIds = null,
  respectTimeSlots = false
) {
  if (!jobs || !jobs.length) return [];

  const endLatFinal = endLat ?? startLat;
  const endLngFinal = endLng ?? startLng;

  let highPriorityJobs = [];
  let regularJobs = [];

  if (highPriorityJobIds && highPriorityJobIds.length) {
    for (const job of jobs) {
      if (highPriorityJobIds.includes(job.job_id)) {
        highPriorityJobs.push(job);
      } else {
        regularJobs.push(job);
      }
    }
  } else {
    regularJobs = [...jobs];
  }

  let jobsByTimeSlot;
  let sortedTimeSlots;

  if (respectTimeSlots) {
    jobsByTimeSlot = {};
    for (const job of regularJobs) {
      const slot = job.time_slot || 'AnyTime';
      if (!jobsByTimeSlot[slot]) jobsByTimeSlot[slot] = [];
      jobsByTimeSlot[slot].push(job);
    }
    sortedTimeSlots = Object.keys(jobsByTimeSlot).sort(
      (a, b) =>
        (TIME_SLOT_PRIORITY[a] ?? 999) - (TIME_SLOT_PRIORITY[b] ?? 999)
    );
  } else {
    jobsByTimeSlot = { All: regularJobs };
    sortedTimeSlots = ['All'];
  }

  const optimized = [];
  let currentLat = startLat;
  let currentLng = startLng;

  // High priority first (nearest from start)
  if (highPriorityJobs.length) {
    if (highPriorityJobs.length > 1) {
      highPriorityJobs = highPriorityJobs
        .map((job) => ({
          job,
          dist: calculateDistanceHaversine(
            startLat,
            startLng,
            job.lat,
            job.lng
          ),
        }))
        .sort((a, b) => a.dist - b.dist)
        .map((x) => x.job);
    }
    for (const job of highPriorityJobs) {
      optimized.push(job);
      currentLat = job.lat;
      currentLng = job.lng;
    }
  }

  // Then each time slot, nearest-neighbor within slot
  for (let slotIdx = 0; slotIdx < sortedTimeSlots.length; slotIdx++) {
    const timeSlot = sortedTimeSlots[slotIdx];
    const slotJobs = [...(jobsByTimeSlot[timeSlot] || [])];
    const isLastSlot = slotIdx === sortedTimeSlots.length - 1;

    while (slotJobs.length) {
      let nearestIdx = 0;
      let nearestDist = Infinity;

      for (let i = 0; i < slotJobs.length; i++) {
        const job = slotJobs[i];
        const distFromCurrent = calculateDistanceHaversine(
          currentLat,
          currentLng,
          job.lat,
          job.lng
        );
        let score = distFromCurrent;
        if (isLastSlot && slotJobs.length <= 3) {
          const distToEnd = calculateDistanceHaversine(
            job.lat,
            job.lng,
            endLatFinal,
            endLngFinal
          );
          score = distFromCurrent + distToEnd * 0.2;
        }
        if (score < nearestDist) {
          nearestDist = score;
          nearestIdx = i;
        }
      }

      const nearest = slotJobs.splice(nearestIdx, 1)[0];
      optimized.push(nearest);
      currentLat = nearest.lat;
      currentLng = nearest.lng;
    }
  }

  return optimized;
}

/** Max candidates to compare with Mapbox when choosing next stop (limits API calls) */
const MAPBOX_ORDER_CANDIDATES = 3;

/**
 * Optimize visit order using Mapbox driving duration: at each step pick the next job
 * with shortest driving time from current position (among top Haversine candidates).
 * Returns ordered jobs and route segments (distance, duration, coords) for persistence/response.
 * @param {Array<{ job_id: string, lat: number, lng: number, time_slot: string, duration_min?: number }>} jobs
 * @param {number} startLat
 * @param {number} startLng
 * @param {number} endLat
 * @param {number} endLng
 * @param {string} apiKey - Mapbox access token
 * @param {boolean} [respectTimeSlots]
 * @param {string[]} [highPriorityJobIds]
 * @returns {Promise<{ optimizedJobs: Array, routeSegments: Array, apiCalls: number }>}
 */
async function optimizeRouteOrderWithMapbox(
  jobs,
  startLat,
  startLng,
  endLat,
  endLng,
  apiKey,
  respectTimeSlots = false,
  highPriorityJobIds = null
) {
  const routeSegments = [];
  let apiCalls = 0;

  if (!jobs || !jobs.length) {
    return { optimizedJobs: [], routeSegments: [], apiCalls: 0 };
  }

  let highPriorityJobs = [];
  let regularJobs = [];

  if (highPriorityJobIds && highPriorityJobIds.length) {
    for (const job of jobs) {
      if (highPriorityJobIds.includes(job.job_id)) {
        highPriorityJobs.push(job);
      } else {
        regularJobs.push(job);
      }
    }
  } else {
    regularJobs = [...jobs];
  }

  let jobsByTimeSlot;
  let sortedTimeSlots;

  if (respectTimeSlots) {
    jobsByTimeSlot = {};
    for (const job of regularJobs) {
      const slot = job.time_slot || 'AnyTime';
      if (!jobsByTimeSlot[slot]) jobsByTimeSlot[slot] = [];
      jobsByTimeSlot[slot].push(job);
    }
    sortedTimeSlots = Object.keys(jobsByTimeSlot).sort(
      (a, b) =>
        (TIME_SLOT_PRIORITY[a] ?? 999) - (TIME_SLOT_PRIORITY[b] ?? 999)
    );
  } else {
    jobsByTimeSlot = { All: regularJobs };
    sortedTimeSlots = ['All'];
  }

  const optimized = [];
  let currentLat = startLat;
  let currentLng = startLng;

  // High priority first (Haversine order from start)
  if (highPriorityJobs.length) {
    if (highPriorityJobs.length > 1) {
      highPriorityJobs = highPriorityJobs
        .map((job) => ({
          job,
          dist: calculateDistanceHaversine(
            startLat,
            startLng,
            job.lat,
            job.lng
          ),
        }))
        .sort((a, b) => a.dist - b.dist)
        .map((x) => x.job);
    }
    for (const job of highPriorityJobs) {
      const durationMin = job.duration_min ?? 10;
      const result = await getMapboxRouteWithTraffic(
        currentLng,
        currentLat,
        job.lng,
        job.lat,
        apiKey
      );
      await sleep(500);
      if (result && result.routeCoords && result.routeCoords.length > 1) {
        apiCalls += 1;
        routeSegments.push({
          from: optimized.length === 0 ? 'Start' : optimized[optimized.length - 1].job_id,
          to: job.job_id,
          distance_km: result.distanceKm,
          travel_time_min: result.durationMin,
          service_time_min: durationMin,
          total_segment_min: result.durationMin + durationMin,
          coords: result.routeCoords,
        });
      } else {
        const straightKm = calculateDistanceHaversine(
          currentLat,
          currentLng,
          job.lat,
          job.lng
        );
        const estMin = straightKm * 1.5;
        routeSegments.push({
          from: optimized.length === 0 ? 'Start' : optimized[optimized.length - 1].job_id,
          to: job.job_id,
          distance_km: straightKm,
          travel_time_min: estMin,
          service_time_min: durationMin,
          total_segment_min: estMin + durationMin,
          coords: null,
        });
      }
      optimized.push(job);
      currentLat = job.lat;
      currentLng = job.lng;
    }
  }

  // Per time slot: Mapbox-based nearest (shortest driving time among top-k by Haversine)
  for (const timeSlot of sortedTimeSlots) {
    const slotJobs = [...(jobsByTimeSlot[timeSlot] || [])];

    while (slotJobs.length) {
      const k = Math.min(MAPBOX_ORDER_CANDIDATES, slotJobs.length);
      const withDist = slotJobs
        .map((job) => ({
          job,
          dist: calculateDistanceHaversine(
            currentLat,
            currentLng,
            job.lat,
            job.lng
          ),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, k);

      let best = null;
      let bestDuration = Infinity;
      let bestResult = null;

      for (const { job } of withDist) {
        const result = await getMapboxRouteWithTraffic(
          currentLng,
          currentLat,
          job.lng,
          job.lat,
          apiKey
        );
        await sleep(500);
        if (result && result.durationMin != null && result.durationMin < bestDuration) {
          bestDuration = result.durationMin;
          best = job;
          bestResult = result;
        }
      }

      if (!best) {
        best = withDist[0].job;
        const straightKm = calculateDistanceHaversine(
          currentLat,
          currentLng,
          best.lat,
          best.lng
        );
        bestResult = {
          distanceKm: straightKm,
          durationMin: straightKm * 1.5,
          routeCoords: [[currentLat, currentLng], [best.lat, best.lng]],
        };
      } else {
        apiCalls += 1;
      }

      const durationMin = best.duration_min ?? 10;
      if (
        bestResult &&
        bestResult.routeCoords &&
        bestResult.routeCoords.length > 1
      ) {
        routeSegments.push({
          from:
            optimized.length === 0
              ? 'Start'
              : optimized[optimized.length - 1].job_id,
          to: best.job_id,
          distance_km: bestResult.distanceKm,
          travel_time_min: bestResult.durationMin,
          service_time_min: durationMin,
          total_segment_min: bestResult.durationMin + durationMin,
          coords: bestResult.routeCoords,
        });
      } else {
        const straightKm = calculateDistanceHaversine(
          currentLat,
          currentLng,
          best.lat,
          best.lng
        );
        const estMin = straightKm * 1.5;
        routeSegments.push({
          from:
            optimized.length === 0
              ? 'Start'
              : optimized[optimized.length - 1].job_id,
          to: best.job_id,
          distance_km: straightKm,
          travel_time_min: estMin,
          service_time_min: durationMin,
          total_segment_min: estMin + durationMin,
          coords: null,
        });
      }

      optimized.push(best);
      currentLat = best.lat;
      currentLng = best.lng;
      const idx = slotJobs.findIndex((j) => j.job_id === best.job_id);
      if (idx !== -1) slotJobs.splice(idx, 1);
    }
  }

  // Return to end position
  if (optimized.length) {
    const lastJob = optimized[optimized.length - 1];
    if (
      Math.abs(lastJob.lat - endLat) >= 0.0001 ||
      Math.abs(lastJob.lng - endLng) >= 0.0001
    ) {
      const result = await getMapboxRouteWithTraffic(
        currentLng,
        currentLat,
        endLng,
        endLat,
        apiKey
      );
      await sleep(500);
      if (result && result.routeCoords && result.routeCoords.length > 1) {
        apiCalls += 1;
        routeSegments.push({
          from: lastJob.job_id,
          to: 'End Position',
          distance_km: result.distanceKm,
          travel_time_min: result.durationMin,
          service_time_min: 0,
          total_segment_min: result.durationMin,
          coords: result.routeCoords,
        });
      }
    }
  }

  return { optimizedJobs: optimized, routeSegments, apiCalls };
}

/**
 * Calculate Mapbox driving routes for all drivers after assignment and optimization.
 * Returns per-driver route segments (distance_km, travel_time_min, coords) and totals.
 * @param {Array} drivers - same shape as assignJobsToDrivers
 * @param {Array} jobs - same shape (job_id, lat, lng, time_slot, total_price, duration_min?)
 * @param {string} apiKey - Mapbox access token (pk.*)
 * @param {boolean} [respectTimeSlots]
 * @param {Object.<string, string[]>} [highPriorityJobs] - driver_id -> job_id[]
 * @returns {Promise<{ routesByDriverId: Object, apiCalls: number }>}
 */
async function calculateRoutesForDrivers(
  drivers,
  jobs,
  apiKey,
  respectTimeSlots = false,
  highPriorityJobs = null
) {
  const activeDrivers = drivers.filter(
    (d) => (d.status || 'active') !== 'in panne'
  );
  const routesByDriverId = {};
  let apiCalls = 0;

  const { assignedJobs } = assignJobsToDrivers(drivers, jobs);

  for (const driver of activeDrivers) {
    const driverId = driver.driver_id;
    const driverJobs = assignedJobs[driverId] || [];
    const endLocation = driver.end_location || driver.start_location;
    const highPriorityIds =
      highPriorityJobs && highPriorityJobs[driverId]
        ? highPriorityJobs[driverId]
        : null;

    const optimizedJobs = optimizeRouteOrder(
      driverJobs,
      driver.start_location?.lat ?? DEFAULT_DEPOT.lat,
      driver.start_location?.lng ?? DEFAULT_DEPOT.lng,
      endLocation?.lat ?? driver.start_location?.lat ?? DEFAULT_DEPOT.lat,
      endLocation?.lng ?? driver.start_location?.lng ?? DEFAULT_DEPOT.lng,
      highPriorityIds,
      respectTimeSlots
    );

    const driverRoutes = [];
    let totalDistance = 0;
    let totalTime = 0;
    let currentLat =
      driver.start_location?.lat ?? DEFAULT_DEPOT.lat;
    let currentLng =
      driver.start_location?.lng ?? DEFAULT_DEPOT.lng;

    if (!optimizedJobs.length) {
      routesByDriverId[driverId] = {
        driver_info: driver,
        jobs: [],
        route_segments: [],
        total_distance_km: 0,
        total_time_min: 0,
        working_hours_utilization: 0,
      };
      continue;
    }

    for (let i = 0; i < optimizedJobs.length; i++) {
      const job = optimizedJobs[i];
      const durationMin = job.duration_min ?? 10;
      let isDuplicate =
        (i > 0 &&
          Math.abs(optimizedJobs[i - 1].lat - job.lat) < 0.0001 &&
          Math.abs(optimizedJobs[i - 1].lng - job.lng) < 0.0001) ||
        (i === 0 &&
          Math.abs(currentLat - job.lat) < 0.0001 &&
          Math.abs(currentLng - job.lng) < 0.0001);

      let distance = null;
      let duration = null;
      let routeCoords = null;

      if (!isDuplicate) {
        const result = await getMapboxRouteWithTraffic(
          currentLng,
          currentLat,
          job.lng,
          job.lat,
          apiKey
        );
        if (result) {
          apiCalls += 1;
          distance = result.distanceKm;
          duration = result.durationMin;
          routeCoords = result.routeCoords;
        }
        await sleep(500);
      }

      if (!isDuplicate && distance != null && duration != null && routeCoords && routeCoords.length > 1) {
        driverRoutes.push({
          from: i === 0 ? 'Start' : optimizedJobs[i - 1].job_id,
          to: job.job_id,
          distance_km: distance,
          travel_time_min: duration,
          service_time_min: durationMin,
          total_segment_min: duration + durationMin,
          coords: routeCoords,
        });
        totalDistance += distance;
        totalTime += duration + durationMin;
      } else {
        if (isDuplicate) {
          driverRoutes.push({
            from: i === 0 ? 'Start' : optimizedJobs[i - 1].job_id,
            to: job.job_id,
            distance_km: 0,
            travel_time_min: 0,
            service_time_min: durationMin,
            total_segment_min: durationMin,
            coords: null,
          });
        } else {
          const straightKm = calculateDistanceHaversine(
            currentLat,
            currentLng,
            job.lat,
            job.lng
          );
          const estimatedMin = straightKm * 1.5;
          driverRoutes.push({
            from: i === 0 ? 'Start' : optimizedJobs[i - 1].job_id,
            to: job.job_id,
            distance_km: straightKm,
            travel_time_min: estimatedMin,
            service_time_min: durationMin,
            total_segment_min: estimatedMin + durationMin,
            coords: null,
          });
        }
        totalTime += driverRoutes[driverRoutes.length - 1].total_segment_min;
      }

      currentLat = job.lat;
      currentLng = job.lng;
    }

    // Return to end position
    const lastJob = optimizedJobs[optimizedJobs.length - 1];
    const endLat = endLocation?.lat ?? driver.start_location?.lat ?? DEFAULT_DEPOT.lat;
    const endLng = endLocation?.lng ?? driver.start_location?.lng ?? DEFAULT_DEPOT.lng;
    if (
      Math.abs(lastJob.lat - endLat) >= 0.0001 ||
      Math.abs(lastJob.lng - endLng) >= 0.0001
    ) {
      const result = await getMapboxRouteWithTraffic(
        currentLng,
        currentLat,
        endLng,
        endLat,
        apiKey
      );
      if (result) {
        apiCalls += 1;
        if (
          result.routeCoords &&
          result.routeCoords.length > 1
        ) {
          driverRoutes.push({
            from: lastJob.job_id,
            to: 'End Position',
            distance_km: result.distanceKm,
            travel_time_min: result.durationMin,
            service_time_min: 0,
            total_segment_min: result.durationMin,
            coords: result.routeCoords,
          });
          totalDistance += result.distanceKm;
          totalTime += result.durationMin;
        }
      }
      await sleep(500);
    }

    const maxRouteMin = driver.max_route_duration_min ?? 480;
    routesByDriverId[driverId] = {
      driver_info: driver,
      jobs: optimizedJobs,
      route_segments: driverRoutes,
      total_distance_km: totalDistance,
      total_time_min: totalTime,
      working_hours_utilization:
        maxRouteMin > 0 ? (totalTime / maxRouteMin) * 100 : 0,
    };
  }

  return { routesByDriverId, apiCalls };
}

module.exports = {
  calculateDistanceHaversine,
  assignJobsToDrivers,
  optimizeRouteOrder,
  optimizeRouteOrderWithMapbox,
  getMapboxRouteWithTraffic,
  calculateRoutesForDrivers,
  DEFAULT_DEPOT,
};
