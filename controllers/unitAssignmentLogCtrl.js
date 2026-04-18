const Truck = require('../models/Truck');
const { getUnitAssignmentLogsByDate } = require('../services/unitAssignmentLogService');

/**
 * GET /api/unit-assignment-logs?date=YYYY-MM-DD
 * Optional query: truckId — limit to one truck (must exist).
 */
async function getLogsByDate(req, res) {
  try {
    const { date, truckId } = req.query;
    if (!date) {
      return res.status(400).json({ message: 'Query parameter "date" is required (YYYY-MM-DD)' });
    }

    let truckIdFilter;
    if (truckId) {
      const truck = await Truck.findById(truckId);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }
      truckIdFilter = truckId;
    }

    const { logs, startOfDay, endOfDay } = await getUnitAssignmentLogsByDate({
      truckId: truckIdFilter,
      date,
    });

    return res.status(200).json({
      date,
      startOfDay,
      endOfDay,
      truckId: truckIdFilter || null,
      count: logs.length,
      logs,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to get unit assignment logs', error: error.message });
  }
}

module.exports = { getLogsByDate };
