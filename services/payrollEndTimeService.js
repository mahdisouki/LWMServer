const Task = require('../models/Task');
const UnitAssignmentLogRange = require('../models/UnitAssignmentLogRange');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const { getAssignedForDayFromRanges } = require('./unitAssignmentLogService');
const { getMapboxRouteWithTraffic } = require('./routeOptimizerService');

const POST_RUN_BUFFER_MS = 5 * 60 * 1000;
const IGNORED_TASK_STATUSES = ['Cancelled'];

/**
 * Calendar date key in the server's local timezone (YYYY-MM-DD).
 */
function getDateKeyLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Start of local calendar day for `now`, next midnight, and dateKey — matches payroll cash/expense "today" window.
 */
function getServerLocalDayBounds(now = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const tomorrow = new Date(startOfDay);
  tomorrow.setDate(startOfDay.getDate() + 1);
  return {
    startOfDay,
    tomorrow,
    dateKey: getDateKeyLocal(startOfDay),
  };
}

/**
 * Local midnight bounds for a calendar date key (YYYY-MM-DD), same semantics as getServerLocalDayBounds.
 * @returns {{ startOfDay: Date, tomorrow: Date } | null}
 */
function getDayBoundsFromDateKey(dateKey) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }
  const [y, m, d] = dateKey.split('-').map((p) => parseInt(p, 10));
  const startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (
    Number.isNaN(startOfDay.getTime()) ||
    startOfDay.getFullYear() !== y ||
    startOfDay.getMonth() !== m - 1 ||
    startOfDay.getDate() !== d
  ) {
    return null;
  }
  const tomorrow = new Date(startOfDay);
  tomorrow.setDate(startOfDay.getDate() + 1);
  return { startOfDay, tomorrow };
}

async function getCountedTasksForTruckDay(truckId, startOfDay, tomorrow) {
  return Task.find({
    truckId,
    date: { $gte: startOfDay, $lt: tomorrow },
    taskStatus: { $nin: IGNORED_TASK_STATUSES },
  })
    .select('taskStatus')
    .lean();
}

/**
 * BO accept: all non-cancelled tasks on the truck for that local day must be Completed.
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string, remainingTasks?: Array<{ taskId: string, taskStatus: string }> }>}
 */
async function assertNoRemainingTasksOnTruckForDateKey(truckId, dateKey) {
  const bounds = getDayBoundsFromDateKey(dateKey);
  if (!bounds) {
    return { ok: false, status: 400, message: 'Invalid date key on end shift request.' };
  }
  const { startOfDay, tomorrow } = bounds;
  const countedTasks = await getCountedTasksForTruckDay(truckId, startOfDay, tomorrow);
  const incomplete = countedTasks.filter((t) => t.taskStatus !== 'Completed');
  console.log('incomplete', incomplete);
  if (incomplete.length > 0) {
    return {
      ok: false,
      status: 400,
      message:
        'You must move or complete all remaining tasks on this truck before accepting the end shift request.',
      remainingTasks: incomplete.map((t) => ({
        taskId: t._id?.toString?.() ?? String(t._id),
        taskStatus: t.taskStatus,
      })),
    };
  }
  return { ok: true };
}

/**
 * End time for BO-approved close: last completed task finish on that truck for the request's local day.
 * @returns {Promise<{ ok: true, end: Date } | { ok: false, status: number, message: string }>}
 */
async function getLastCompletedFinishDateForTruckDay(truckId, dateKey) {
  const bounds = getDayBoundsFromDateKey(dateKey);
  if (!bounds) {
    return { ok: false, status: 400, message: 'Invalid date key on end shift request.' };
  }
  const { startOfDay, tomorrow } = bounds;
  const lastCompletedTask = await Task.findOne({
    truckId,
    taskStatus: 'Completed',
    finishDate: { $gte: startOfDay, $lt: tomorrow },
  })
    .sort({ finishDate: -1 })
    .select('finishDate')
    .lean();

  if (!lastCompletedTask?.finishDate) {
    return {
      ok: false,
      status: 400,
      message:
        'No completed job with a finish time was found for this truck on that day; cannot set end time.',
    };
  }
  const end = new Date(lastCompletedTask.finishDate);
  return { ok: true, end };
}

async function resolveTruckIdForServerDay(payroll, startOfDay, endOfDay) {
  if (payroll.truckId) return payroll.truckId;

  const range = await UnitAssignmentLogRange.findOne({
    type: { $in: ['driver', 'helper'] },
    refId: payroll.userId,
    startAt: { $lte: endOfDay },
    $or: [{ endAt: null }, { endAt: { $gte: startOfDay } }],
  })
    .sort({ startAt: -1 })
    .select('truckId')
    .lean();

  return range?.truckId || null;
}

/**
 * Resolve shift end time from today's truck jobs (server local day), Mapbox drive from last completed job to home, +5 min buffer.
 * Falls back to `fallbackEndTimeIso` when coords or Mapbox are unavailable.
 *
 * @returns {Promise<
 *   | { ok: true, end: Date }
 *   | { ok: false, status: number, message: string; code?: string; truckId?: unknown; dateKey?: string; incompleteTasks?: Array<{ taskId: unknown; taskStatus: string }> }
 * >}
 */
function logResolve(msg, payload = {}) {
  const line = {
    scope: 'resolvePayrollEndTimeFromJobs',
    msg,
    ...payload,
  };
  console.log('[resolvePayrollEndTimeFromJobs]', JSON.stringify(line));
}

async function resolvePayrollEndTimeFromJobs({
  payroll,
  fallbackEndTimeIso,
  mapboxApiKey,
}) {
  const payrollId = payroll?._id?.toString?.() ?? String(payroll?._id);
  const userId = payroll?.userId?.toString?.() ?? String(payroll?.userId);
  const startTimeIso =
    payroll?.startTime instanceof Date
      ? payroll.startTime.toISOString()
      : payroll?.startTime
        ? new Date(payroll.startTime).toISOString()
        : null;
  const endTimeIso =
    payroll?.endTime instanceof Date
      ? payroll.endTime.toISOString()
      : payroll?.endTime
        ? new Date(payroll.endTime).toISOString()
        : null;

  logResolve('start', {
    payrollId,
    userId,
    payrollTruckId: payroll?.truckId?.toString?.() ?? payroll?.truckId ?? null,
    startTime: startTimeIso,
    endTime: endTimeIso,
    fallbackEndTimeIso,
    hasMapboxKey: Boolean(mapboxApiKey),
  });

  const fallbackEnd = new Date(fallbackEndTimeIso);
  if (Number.isNaN(fallbackEnd.getTime())) {
    logResolve('invalid_fallback_end', { payrollId, userId, fallbackEndTimeIso });
    return { ok: false, status: 400, message: 'Invalid end time.' };
  }

  const { startOfDay, tomorrow, dateKey } = getServerLocalDayBounds();
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  logResolve('server_local_day', {
    payrollId,
    dateKey,
    startOfDay: startOfDay.toISOString(),
    tomorrow: tomorrow.toISOString(),
    endOfDay: endOfDay.toISOString(),
  });

  const truckId = await resolveTruckIdForServerDay(payroll, startOfDay, endOfDay);
  if (!truckId) {
    logResolve('no_truck_id', {
      payrollId,
      userId,
      hadPayrollTruckId: Boolean(payroll?.truckId),
    });
    return {
      ok: false,
      status: 400,
      message:
        'Could not determine your truck for today. Contact support before ending your shift.',
    };
  }

  logResolve('truck_resolved', {
    payrollId,
    truckId: truckId.toString?.() ?? String(truckId),
  });

  const assignment = await getAssignedForDayFromRanges(truckId, dateKey);
  logResolve('assignment', {
    payrollId,
    truckId: truckId.toString?.() ?? String(truckId),
    driverId: assignment?.driverId?.toString?.() ?? assignment?.driverId ?? null,
    helperId: assignment?.helperId?.toString?.() ?? assignment?.helperId ?? null,
  });

  const countedTasks = await getCountedTasksForTruckDay(truckId, startOfDay, tomorrow);

  const statusCounts = countedTasks.reduce((acc, t) => {
    acc[t.taskStatus] = (acc[t.taskStatus] || 0) + 1;
    return acc;
  }, {});

  logResolve('tasks_for_day', {
    payrollId,
    truckId: truckId.toString?.() ?? String(truckId),
    countedTaskCount: countedTasks.length,
    taskStatusCounts: statusCounts,
  });

  const incompleteTasks = countedTasks.filter((t) => t.taskStatus !== 'Completed');
  if (incompleteTasks.length > 0) {
    const first = incompleteTasks[0];
    logResolve('blocked_incomplete_task', {
      payrollId,
      truckId: truckId.toString?.() ?? String(truckId),
      offendingTaskStatus: first.taskStatus,
      taskId: first._id?.toString?.() ?? String(first._id),
      incompleteCount: incompleteTasks.length,
    });
    return {
      ok: false,
      status: 422,
      code: 'INCOMPLETE_TASKS',
      message:
        'Complete all jobs for today before ending your shift. A back office request was created so they can close your shift if needed.',
      truckId,
      dateKey,
      incompleteTasks: incompleteTasks.map((t) => ({
        taskId: t._id,
        taskStatus: t.taskStatus,
      })),
    };
  }

  const validateEndAfterStart = (end) =>
    end > payroll.startTime
      ? { ok: true, end }
      : { ok: false, status: 400, message: 'End time must be after start time.' };

  if (countedTasks.length === 0) {
    const afterStart = fallbackEnd > payroll.startTime;
    logResolve('no_tasks_using_fallback', {
      payrollId,
      fallbackEnd: fallbackEnd.toISOString(),
      startTime: startTimeIso,
      fallbackAfterStart: afterStart,
    });
    const v = validateEndAfterStart(fallbackEnd);
    if (!v.ok) {
      logResolve('fallback_rejected_after_start', {
        payrollId,
        fallbackEnd: fallbackEnd.toISOString(),
        startTime: startTimeIso,
      });
    }
    return v;
  }

  const lastCompletedTask = await Task.findOne({
    truckId,
    taskStatus: 'Completed',
    finishDate: { $gte: startOfDay, $lt: tomorrow },
  })
    .sort({ finishDate: -1 })
    .select('finishDate location')
    .lean();

  if (!lastCompletedTask?.finishDate) {
    logResolve('no_last_completed_finishDate', {
      payrollId,
      truckId: truckId.toString?.() ?? String(truckId),
      lastTaskId: lastCompletedTask?._id?.toString?.() ?? null,
    });
    return {
      ok: false,
      status: 400,
      message:
        'No completed job with a finish time was found for today; cannot compute end time.',
    };
  }

  const finishDateIso = new Date(lastCompletedTask.finishDate).toISOString();
  logResolve('last_completed_task', {
    payrollId,
    truckId: truckId.toString?.() ?? String(truckId),
    lastTaskId: lastCompletedTask._id?.toString?.() ?? String(lastCompletedTask._id),
    finishDate: finishDateIso,
  });

  const effectiveHelperId = assignment?.helperId || null;
  const driverIdForHome = assignment?.driverId || payroll.userId;

  logResolve('home_routing_context', {
    payrollId,
    effectiveHelperId: effectiveHelperId?.toString?.() ?? effectiveHelperId ?? null,
    driverIdForHome: driverIdForHome?.toString?.() ?? String(driverIdForHome),
  });

  const targetHolder = effectiveHelperId
    ? await Helper.findById(effectiveHelperId).select('end_location').lean()
    : await Driver.findById(driverIdForHome).select('end_location').lean();

  const targetCoords = targetHolder?.end_location?.coordinates;
  const lastTaskCoords = lastCompletedTask?.location?.coordinates;

  const tryFallback = () => validateEndAfterStart(fallbackEnd);

  if (
    !Array.isArray(lastTaskCoords) ||
    lastTaskCoords.length < 2 ||
    !Array.isArray(targetCoords) ||
    targetCoords.length < 2
  ) {
    logResolve('fallback_missing_coords', {
      payrollId,
      lastTaskCoordsOk: Array.isArray(lastTaskCoords) && lastTaskCoords.length >= 2,
      targetCoordsOk: Array.isArray(targetCoords) && targetCoords.length >= 2,
      holderType: effectiveHelperId ? 'helper' : 'driver',
      holderId: targetHolder?._id?.toString?.() ?? null,
    });
    const v = tryFallback();
    if (v.ok) {
      logResolve('fallback_end_accepted', {
        payrollId,
        end: v.end.toISOString(),
        reason: 'missing_coords',
      });
    } else {
      logResolve('fallback_end_rejected', { payrollId, reason: 'missing_coords' });
    }
    return v;
  }

  if (!mapboxApiKey) {
    logResolve('fallback_no_mapbox_key', { payrollId });
    const v = tryFallback();
    if (v.ok) {
      logResolve('fallback_end_accepted', {
        payrollId,
        end: v.end.toISOString(),
        reason: 'no_mapbox_key',
      });
    }
    return v;
  }

  const route = await getMapboxRouteWithTraffic(
    Number(lastTaskCoords[0]),
    Number(lastTaskCoords[1]),
    Number(targetCoords[0]),
    Number(targetCoords[1]),
    mapboxApiKey
  );

  if (!route || !Number.isFinite(route.durationMin)) {
    logResolve('fallback_mapbox_route_failed', {
      payrollId,
      hasRoute: Boolean(route),
      durationMin: route?.durationMin,
    });
    const v = tryFallback();
    if (v.ok) {
      logResolve('fallback_end_accepted', {
        payrollId,
        end: v.end.toISOString(),
        reason: 'mapbox_route_failed',
      });
    }
    return v;
  }

  const computedEnd = new Date(
    new Date(lastCompletedTask.finishDate).getTime() +
      Math.round(route.durationMin * 60 * 1000) +
      POST_RUN_BUFFER_MS
  );

  logResolve('mapbox_route_ok', {
    payrollId,
    durationMin: route.durationMin,
    bufferMs: POST_RUN_BUFFER_MS,
    computedEnd: computedEnd.toISOString(),
    startTime: startTimeIso,
  });

  if (!(computedEnd > payroll.startTime)) {
    logResolve('fallback_computed_not_after_start', {
      payrollId,
      computedEnd: computedEnd.toISOString(),
      startTime: startTimeIso,
    });
    const v = tryFallback();
    if (v.ok) {
      logResolve('fallback_end_accepted', {
        payrollId,
        end: v.end.toISOString(),
        reason: 'computed_not_after_start',
      });
    }
    return v;
  }

  logResolve('success_computed_end', {
    payrollId,
    end: computedEnd.toISOString(),
    lastFinishDate: finishDateIso,
  });

  return { ok: true, end: computedEnd };
}

module.exports = {
  resolvePayrollEndTimeFromJobs,
  getServerLocalDayBounds,
  getDateKeyLocal,
  getDayBoundsFromDateKey,
  assertNoRemainingTasksOnTruckForDateKey,
  getLastCompletedFinishDateForTruckDay,
};
