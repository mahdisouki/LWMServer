const Truck = require('../models/Truck');

const syncingTaskIds = new Set();
let missingIdLogged = false;

/** Truck id of the holding unit. Set per environment; production is not the dev id. */
function cancelledVanTruckId() {
  const id = String(process.env.CANCELLED_VAN_TRUCK_ID || '').trim();
  if (!id && !missingIdLogged) {
    missingIdLogged = true;
    console.error('[CancelledVan] Set CANCELLED_VAN_TRUCK_ID to the cancelled van truck id');
  }
  return id;
}

function TaskModel() {
  return require('../models/Task');
}

function shouldParkOnCancelledVan(task) {
  if (!task) return false;
  return task.taskStatus === 'Cancelled' || task.paymentStatus === 'Failed';
}

function idString(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function isCancelledVan(truckId) {
  const cancelledId = cancelledVanTruckId();
  if (!cancelledId) return false;
  return idString(truckId) === cancelledId;
}

function collectionDateKey(date) {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

function tasksToObject(tasks) {
  if (!tasks) return {};
  if (typeof tasks.entries === 'function') {
    return Object.fromEntries(tasks.entries());
  }
  return { ...tasks };
}

function entryTaskId(entry) {
  if (entry && typeof entry === 'object' && entry.taskId != null) {
    return idString(entry.taskId);
  }
  return String(entry);
}

function normalizeEntry(entry) {
  if (entry && typeof entry === 'object' && entry.taskId != null) {
    const type = entry.type === 'Task' ? 'task' : entry.type || 'task';
    return {
      taskId: entry.taskId._id || entry.taskId,
      type,
      order: Number(entry.order) || 0,
    };
  }
  return { taskId: entry, type: 'task', order: 0 };
}

function listWithoutTask(entries, taskIdStr) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entryTaskId(entry) !== taskIdStr)
    .map(normalizeEntry);
}

function datesContainingTask(tasksByDate, taskIdStr) {
  return Object.keys(tasksByDate).filter((dateKey) => {
    const entries = tasksByDate[dateKey];
    return Array.isArray(entries) && entries.some((entry) => entryTaskId(entry) === taskIdStr);
  });
}

function normalizeTasksByDate(tasksByDate) {
  const normalized = {};
  for (const [dateKey, entries] of Object.entries(tasksByDate)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    normalized[dateKey] = entries.map(normalizeEntry);
  }
  return normalized;
}

async function writeTasksMap(truck, tasksByDate) {
  truck.tasks = new Map(Object.entries(normalizeTasksByDate(tasksByDate)));
  truck.markModified('tasks');
  await truck.save();
}

async function removeTaskFromTruck(truckId, taskIdStr) {
  if (!truckId || isCancelledVan(truckId)) return false;
  const truck = await Truck.findById(truckId);
  if (!truck) return false;

  const tasksByDate = tasksToObject(truck.tasks);
  const presentOn = datesContainingTask(tasksByDate, taskIdStr);
  if (!presentOn.length) return false;

  for (const dateKey of presentOn) {
    const remaining = listWithoutTask(tasksByDate[dateKey], taskIdStr);
    if (remaining.length === 0) delete tasksByDate[dateKey];
    else tasksByDate[dateKey] = remaining;
  }

  await writeTasksMap(truck, tasksByDate);
  return true;
}

async function placeOnCancelledVan(taskId, dateKey) {
  const cancelledId = cancelledVanTruckId();
  if (!cancelledId) return false;

  const truck = await Truck.findById(cancelledId);
  if (!truck) {
    console.error('[CancelledVan] Cancelled van truck was not found:', cancelledId);
    return false;
  }

  const taskIdStr = idString(taskId);
  const tasksByDate = tasksToObject(truck.tasks);
  const presentOn = datesContainingTask(tasksByDate, taskIdStr);
  const alreadyOnDate = presentOn.length === 1 && presentOn[0] === dateKey;
  if (alreadyOnDate) return true;

  for (const key of presentOn) {
    if (key === dateKey) continue;
    const remaining = listWithoutTask(tasksByDate[key], taskIdStr);
    if (remaining.length === 0) delete tasksByDate[key];
    else tasksByDate[key] = remaining;
  }

  const day = listWithoutTask(tasksByDate[dateKey], taskIdStr);
  day.push({ taskId, type: 'task', order: day.length });
  tasksByDate[dateKey] = day;
  await writeTasksMap(truck, tasksByDate);
  return true;
}

async function removeFromCancelledVan(taskId) {
  const cancelledId = cancelledVanTruckId();
  if (!cancelledId) return false;

  const truck = await Truck.findById(cancelledId);
  if (!truck) return false;

  const taskIdStr = idString(taskId);
  const tasksByDate = tasksToObject(truck.tasks);
  const presentOn = datesContainingTask(tasksByDate, taskIdStr);
  if (!presentOn.length) return false;

  for (const dateKey of presentOn) {
    const remaining = listWithoutTask(tasksByDate[dateKey], taskIdStr);
    if (remaining.length === 0) delete tasksByDate[dateKey];
    else tasksByDate[dateKey] = remaining;
  }

  await writeTasksMap(truck, tasksByDate);
  return true;
}

async function refreshDailySheets(dateKey) {
  if (!dateKey) return;
  try {
    const dailySheetController = require('../controllers/dailySheetController');
    await dailySheetController.updateExistingDailySheets(
      { body: { date: dateKey } },
      { status: () => ({ json: () => {} }), json: () => {} },
    );
  } catch (error) {
    console.error('[CancelledVan] Daily sheet refresh failed:', error);
  }
}

async function setTaskTruck(taskId, truckId) {
  const Task = TaskModel();
  const update = truckId
    ? { $set: { truckId } }
    : { $unset: { truckId: 1 } };
  await Task.updateOne({ _id: taskId }, update);
}

/**
 * Failed payments and cancelled orders stay on the cancelled van for the collection date.
 * Any other status leaves that van so the order can be routed.
 */
async function syncCancelledVanAssignment(task) {
  if (!task || !task._id) return;

  const taskId = idString(task._id);
  if (syncingTaskIds.has(taskId)) return;

  const park = shouldParkOnCancelledVan(task);
  const onVan = isCancelledVan(task.truckId);
  if (!park && !onVan) return;

  syncingTaskIds.add(taskId);
  try {
    const dateKey = collectionDateKey(task.date);

    if (park) {
      if (!dateKey) {
        console.error('[CancelledVan] Order has no collection date:', taskId);
        return;
      }

      const placed = await placeOnCancelledVan(task._id, dateKey);
      if (!placed) return;

      const previousTruckId = idString(task.truckId);
      if (previousTruckId && !isCancelledVan(previousTruckId)) {
        await removeTaskFromTruck(previousTruckId, taskId);
        await refreshDailySheets(dateKey);
      }

      if (!isCancelledVan(previousTruckId)) {
        await setTaskTruck(task._id, cancelledVanTruckId());
      }
      return;
    }

    await removeFromCancelledVan(task._id);
    await setTaskTruck(task._id, null);
  } catch (error) {
    console.error('[CancelledVan] Failed to sync order', taskId, error);
  } finally {
    syncingTaskIds.delete(taskId);
  }
}

module.exports = {
  cancelledVanTruckId,
  shouldParkOnCancelledVan,
  syncCancelledVanAssignment,
};
