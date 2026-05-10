const cron = require('node-cron');
const Payroll = require('../models/Payroll');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const Task = require('../models/Task');
const UnitAssignmentLogRange = require('../models/UnitAssignmentLogRange');
const payrollCtrl = require('../controllers/payrollCtrl');
const { getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');
const { getMapboxRouteWithTraffic } = require('../services/routeOptimizerService');

/**
 * Return date key in local timezone (YYYY-MM-DD).
 */
function getDateKeyLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function callUserEndShiftFlow(userId, endTimeIso) {
  const req = {
    user: { _id: userId },
    body: { endTime: endTimeIso },
  };

  return new Promise((resolve, reject) => {
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        const statusCode = this.statusCode || 200;
        if (statusCode >= 400) {
          reject(new Error(payload?.message || 'Unknown end-shift error'));
          return this;
        }
        resolve(payload);
        return this;
      },
    };

    Promise.resolve(payrollCtrl.logEndTime(req, res)).catch(reject);
  });
}

async function resolveTruckIdForDay(payroll, startOfDay, endOfDay) {
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

async function autoEndShifts() {
  try {
    const now = new Date();
    const targetDay = new Date(now);
    targetDay.setDate(targetDay.getDate() - 1);

    const startOfDay = new Date(targetDay);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDay);
    endOfDay.setHours(23, 59, 59, 999);
    const dateKey = getDateKeyLocal(targetDay);

    const activePayrolls = await Payroll.find({
      endTime: null,
      startTime: { $gte: startOfDay, $lte: endOfDay },
    }).select('_id userId truckId startTime');

    let payrollsEnded = 0;
    let skipped = 0;

    for (const payroll of activePayrolls) {
      try {
        const truckId = await resolveTruckIdForDay(payroll, startOfDay, endOfDay);
        if (!truckId) {
          skipped++;
          continue;
        }

        const assignment = await getAssignedForDayFromRanges(truckId, dateKey);
        const effectiveHelperId = assignment?.helperId || null;

        const [targetHolder, lastCompletedTask] = await Promise.all([
          effectiveHelperId
            ? Helper.findById(effectiveHelperId).select('end_location').lean()
            : Driver.findById(payroll.userId).select('end_location').lean(),
          Task.findOne({
            truckId,
            taskStatus: 'Completed',
            finishDate: { $gte: startOfDay, $lte: endOfDay },
          })
            .sort({ finishDate: -1 })
            .select('finishDate location'),
        ]);

        const targetCoords = targetHolder?.end_location?.coordinates;
        const lastTaskCoords = lastCompletedTask?.location?.coordinates;

        if (
          !lastCompletedTask ||
          !Array.isArray(lastTaskCoords) ||
          lastTaskCoords.length < 2 ||
          !Array.isArray(targetCoords) ||
          targetCoords.length < 2
        ) {
          skipped++;
          continue;
        }

        const mapboxApiKey = process.env.MAPBOX_API_KEY;
        if (!mapboxApiKey) {
          skipped++;
          continue;
        }

        const route = await getMapboxRouteWithTraffic(
          Number(lastTaskCoords[0]),
          Number(lastTaskCoords[1]),
          Number(targetCoords[0]),
          Number(targetCoords[1]),
          mapboxApiKey
        );

        if (!route || !Number.isFinite(route.durationMin)) {
          skipped++;
          continue;
        }

        const computedEndTime = new Date(
          new Date(lastCompletedTask.finishDate).getTime() +
            Math.round(route.durationMin * 60 * 1000)
        );

        if (!(computedEndTime > payroll.startTime)) {
          skipped++;
          continue;
        }

        await callUserEndShiftFlow(payroll.userId, computedEndTime.toISOString());
        payrollsEnded++;
      } catch (innerError) {
        skipped++;
        console.error(
          `[Auto End Shifts] Failed payroll ${payroll._id}:`,
          innerError.message
        );
      }
    }
    console.log(
      `[Auto End Shifts] Completed for ${dateKey}: ended=${payrollsEnded}, skipped=${skipped}, total=${activePayrolls.length}`
    );
  } catch (error) {
    console.error('[Auto End Shifts] Error ending shifts:', error);
  }
}

// Schedule the cron job to run every day at midnight.
// Cron format: minute hour day month dayOfWeek
// '0 0 * * *' means: at minute 0 of hour 0 every day.
cron.schedule('0 0 * * *', autoEndShifts);

console.log(
  '[Auto End Shifts] Scheduler running - will auto-end shifts at midnight daily'
);

module.exports = { autoEndShifts };

