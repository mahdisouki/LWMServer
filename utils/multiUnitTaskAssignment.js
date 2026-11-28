/**
 * Meet-only multi-unit assignment.
 * Map-router may put the same task on several truck routes; LWMServer decides
 * primary (Task.truckId) vs escorts (Task.assistingTruckIds) on apply.
 */

function normalizeSegmentTaskId(rawTaskId) {
  if (typeof rawTaskId === 'string' && rawTaskId.trim()) return rawTaskId.trim();
  if (rawTaskId && typeof rawTaskId === 'object') {
    const id = rawTaskId.$oid || rawTaskId._id || rawTaskId.id;
    if (id != null && String(id).trim()) return String(id).trim();
  }
  return null;
}

/**
 * Optional hint only — map-router is not required to send this.
 * @param {object} segment
 * @returns {'primary'|'escort'|null}
 */
function segmentMultiUnitRole(segment) {
  if (!segment || typeof segment !== 'object') return null;
  const raw =
    segment.multi_unit_role ??
    segment.multiUnitRole ??
    segment.unit_role ??
    segment.unitRole ??
    '';
  const s = String(raw).trim().toLowerCase();
  if (s === 'escort' || s === 'assist' || s === 'assisting') return 'escort';
  if (s === 'primary') return 'primary';
  return null;
}

/**
 * Scan all truck routes and decide ownership for each task.
 * Same task on N trucks → 1 primary + (N-1) escorts.
 *
 * @param {Record<string, { route_segments?: object[] }>} routes
 * @returns {Map<string, { primaryTruckId: string, escortTruckIds: string[] }>}
 */
function buildTaskOwnershipPlan(routes) {
  /** @type {Map<string, { truckId: string, order: number, roleHint: string|null }[]>} */
  const appearances = new Map();

  for (const [routeKey, route] of Object.entries(routes || {})) {
    const truckId = String(routeKey);
    const segments = Array.isArray(route?.route_segments) ? route.route_segments : [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment || typeof segment !== 'object') continue;
      if (segment.type === 'TippingRequest') continue;
      const taskId = normalizeSegmentTaskId(segment.taskId);
      if (!taskId) continue;
      const order = Number.isFinite(Number(segment.order)) ? Number(segment.order) : i + 1;
      const list = appearances.get(taskId) || [];
      if (!list.some((a) => a.truckId === truckId)) {
        list.push({
          truckId,
          order,
          roleHint: segmentMultiUnitRole(segment),
        });
      }
      appearances.set(taskId, list);
    }
  }

  /** @type {Map<string, { primaryTruckId: string, escortTruckIds: string[] }>} */
  const plan = new Map();

  for (const [taskId, apps] of appearances) {
    if (apps.length === 1) {
      plan.set(taskId, { primaryTruckId: apps[0].truckId, escortTruckIds: [] });
      continue;
    }

    let primary =
      apps.find((a) => a.roleHint === 'primary') ||
      [...apps].sort(
        (a, b) =>
          a.order - b.order || String(a.truckId).localeCompare(String(b.truckId)),
      )[0];

    const primaryTruckId = primary.truckId;
    const escortTruckIds = [
      ...new Set(
        apps
          .filter((a) => a.truckId !== primaryTruckId)
          .map((a) => a.truckId),
      ),
    ];
    plan.set(taskId, { primaryTruckId, escortTruckIds });
  }

  return plan;
}

/**
 * Write truckId + assistingTruckIds for every task in the ownership plan.
 * @param {import('mongoose').Model} TaskModel
 * @param {Map<string, { primaryTruckId: string, escortTruckIds: string[] }>} plan
 */
async function persistTaskOwnershipPlan(TaskModel, plan) {
  if (!plan || plan.size === 0) return;
  const ops = [];
  for (const [taskId, { primaryTruckId, escortTruckIds }] of plan) {
    ops.push(
      TaskModel.findByIdAndUpdate(taskId, {
        $set: {
          truckId: primaryTruckId,
          assistingTruckIds: escortTruckIds,
        },
      }),
    );
  }
  await Promise.all(ops);
}

/**
 * Per-segment fallback (single-truck recalculate).
 * Prefer ownershipPlan when provided (multi-truck apply).
 */
async function assignTaskFromRouteSegment(
  TaskModel,
  taskId,
  truckId,
  segment,
  ownershipPlan,
) {
  if (ownershipPlan && ownershipPlan.has(taskId)) {
    const decision = ownershipPlan.get(taskId);
    if (String(truckId) === String(decision.primaryTruckId)) {
      await TaskModel.findByIdAndUpdate(taskId, {
        $set: {
          truckId: decision.primaryTruckId,
          assistingTruckIds: decision.escortTruckIds,
        },
      });
      return { role: 'primary' };
    }
    // Escort truck schedule only — ownership already / will be set via primary.
    return { role: 'escort' };
  }

  const role = segmentMultiUnitRole(segment);
  if (role === 'escort') {
    await TaskModel.findByIdAndUpdate(taskId, {
      $addToSet: { assistingTruckIds: truckId },
    });
    return { role: 'escort' };
  }
  await TaskModel.findByIdAndUpdate(taskId, {
    $set: { truckId },
  });
  return { role: role === 'primary' ? 'primary' : 'legacy' };
}

function clearTaskAssignmentUpdate() {
  return { $set: { truckId: null, assistingTruckIds: [] } };
}

function clearTaskAssignmentFilter(startOfDay, endOfDay, truckIds) {
  const ids = (truckIds || []).map((id) => id);
  return {
    date: { $gte: startOfDay, $lte: endOfDay },
    $or: [{ truckId: { $in: ids } }, { assistingTruckIds: { $in: ids } }],
  };
}

module.exports = {
  normalizeSegmentTaskId,
  segmentMultiUnitRole,
  buildTaskOwnershipPlan,
  persistTaskOwnershipPlan,
  assignTaskFromRouteSegment,
  clearTaskAssignmentUpdate,
  clearTaskAssignmentFilter,
};
